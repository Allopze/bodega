# Auditoría de Módulos — Funcionamiento y Lógica

**Proyecto:** CHOME / Bodega (Next.js + Drizzle + Postgres, RBAC por faena)
**Fecha:** 2026-06-26
**Alcance:** Funcionamiento y lógica de los módulos del sistema, con foco especial en el **ecosistema de Vehículos** (`flota` + `combustibles` + `mantenciones` + imputaciones de costo).
**Naturaleza:** Reporte de hallazgos (read-only). No se aplicaron cambios al código.

> Nota: ya existen varias auditorías previas (`AUDITORIA_CODIGO.md`,
> `AUDITORIA_INTEGRAL_CHOME.md`, `AUDITORIA_LOGICA_BUGS_FUNCIONALIDADES.md`, etc.).
> Este documento **no las reemplaza**; se enfoca en la lógica de los módulos y,
> en particular, en el clúster de Vehículos, que es el código más reciente y el
> menos cubierto por las salvaguardas (transacciones, scoping, tests) que sí usa
> el resto del sistema.

---

## Resumen ejecutivo

El núcleo maduro del sistema (solicitudes, compras, recepción, entregas, stock,
trazabilidad, SST, PPA) está **bien construido**: usa transacciones de BD, aplica
*scoping* por faena de forma consistente (`worksiteFilter` / `visibleWorksiteIds`)
y tiene una batería de pruebas amplia (unitarias, de concurrencia contra Postgres
y E2E). El código es limpio (1 solo `TODO`, 1 solo `as any` en `app/ + lib/ + modules/`).

El **clúster de Vehículos** (`flota`, `mantenciones`, y las server actions de
`combustibles`) es el borde inmaduro del sistema. Reutiliza el esquema y los
helpers correctos, pero **se salta tres disciplinas que el resto del código sí
respeta**:

1. **No aplica scoping por faena** en el módulo de Combustibles (lecturas y escrituras).
2. **No usa transacciones** en los flujos financieros (cuenta corriente y pagos).
3. **No tiene pruebas** de servicio/acción (sólo hay unit tests de cálculo e importación).

Además, el modelo de costo de flota depende de una tabla (`vehicle_cost_allocations`)
que **ningún código puebla** y que dos rutas distintas agregan de forma inconsistente
(doble conteo latente).

| Severidad | Cantidad | Temas |
|-----------|----------|-------|
| 🔴 Alta   | 3 | Scoping ausente en Combustibles · Flujos financieros sin transacción · Borrado rompe cuenta corriente |
| 🟠 Media  | 4 | Tabla de imputaciones muerta + doble conteo · Importación sin validación financiera/dedupe · Total de mantención desacoplado · Permisos/CRUD incompletos |
| 🔵 Baja   | 4 | Duplicación de queries · Doble auth en pagos · Notificaciones en GET · Vehículos sin faena invisibles |
| ⚪ General | — | Brecha de tests en Vehículos · Sprawl de documentos de auditoría |

**Recomendación:** Antes de habilitar Combustibles/Flota para roles operativos de
faena, cerrar **V1, V2 y V3**. Son los que tienen impacto de aislamiento de datos
y de integridad financiera.

---

## Mapa del ecosistema de Vehículos

```
fuel_vehicles ──┬── fuel_loads ───── fuel_monthly_statements ── fuel_payments
  (catálogo)     │     (cargas)          (cuenta corriente)         (pagos)
                 ├── maintenance_records (mantenciones)
                 └── vehicle_cost_allocations  ← NUNCA se escribe (tabla muerta)

UI / lógica:
  /flota          → lib/services/fleet.ts        (overview agregado)      [scoped ✔]
  /mantenciones   → lib/services/maintenance.ts  (+ app/.../actions.ts)   [scoped ✔]
  /combustibles   → app/(app)/combustibles/page.tsx + actions.ts         [scoped �’ NO]
  /analitica      → lib/services/analytics.ts    (lee fuel+maint+alloc)   [scoped ✔]
```

El punto clave: **tres rutas distintas calculan "costo operacional por vehículo"**
(`fleet.ts`, `analytics.ts` y, parcialmente, la página de combustibles) y **no
coinciden** en cómo agregan ni en cómo aplican el scoping.

---

## Hallazgos — Ecosistema de Vehículos

### 🔴 V1 — Combustibles no aplica *scoping* por faena

**Severidad:** Alta (latente; hoy mitigada sólo por los grants por defecto).

A diferencia del resto del sistema, ninguna lectura ni escritura del módulo de
Combustibles filtra por las faenas visibles de la sesión:

- `app/(app)/combustibles/page.tsx:29-110` — captura `_session` (con guion bajo,
  marcado como no usado) y construye el `where` **sólo** a partir de filtros de la
  URL. Las KPIs, los gráficos "Top faenas por gasto" / "Top vehículos por gasto" y
  la tabla muestran **todas las faenas**.
- `app/(app)/combustibles/actions.ts`:
  - `getFuelLoadsAction` (`:226`), `getFuelReportAction` (`:741`),
    `getFuelChartDataAction` (`:879`), `exportFuelLoadsXlsxAction` (`:785`) — lecturas sin scope.
  - `createFuelLoadAction` (`:48`) e `importFuelLoadsAction` (`:285`) — escrituras sin
    validar que la faena destino esté en el alcance del usuario.

Comparar con el patrón correcto que sí siguen `lib/services/fleet.ts:12-18`,
`lib/services/maintenance.ts:39-49`, `lib/services/analytics.ts:213-215` y el helper
dedicado `lib/auth/scope.ts:62-67` (`worksiteScopeSql`).

**Por qué importa:** El control de acceso del sistema asume que el aislamiento por
faena se aplica en la capa de query. Combustibles es la excepción. Hoy
`combustibles:view` sólo se concede por defecto a roles globales
(`administrador`, `jefa_chome` — ver `modules/combustibles/manifest.ts:37-49`), así
que no es explotable *out of the box*. Pero en el momento en que un admin conceda
`combustibles:view` (o `:create`/`:import`) a un rol de faena vía RBAC, ese usuario
verá —y podrá crear/importar— datos de combustible de **todas** las faenas, en
silencio.

**Recomendación:** Aplicar `worksiteScopeSql(session, fuelLoads.worksiteId)` en
todas las lecturas y validar `canAccessWorksite(session, worksiteId)` en
create/import, igual que hace `createMaintenanceRecord` (`maintenance.ts:90-93`).

---

### 🔴 V2 — Flujos financieros sin transacción

**Severidad:** Alta.

Los dos flujos que más necesitan atomicidad —crear cuenta corriente y registrar
pagos— hacen múltiples escrituras **sin** `db.transaction`, en contraste con stock,
purchasing, receiving, deliveries, requests y sst, que sí transaccionan.

1. **`createMonthlyStatementAction`** (`combustibles/actions.ts:580-644`):
   - Inserta el `fuel_monthly_statement` (`:623`) y luego, en una operación separada,
     asigna las cargas con un `UPDATE ... SET statementId` (`:631`). Si lo segundo
     falla, queda un resumen sin cargas (o a medio asignar).
   - **Race condition:** `calculateStatementTotals(loads)` (`:620`) totaliza el set
     leído en `:610`, pero el `UPDATE` de `:631` re-selecciona con el mismo `WHERE`.
     Una carga insertada entre ambos pasos se **asigna** al statement pero **no se
     suma** a sus totales → totales desincronizados.

2. **`addPaymentAction`** (`:684-735`): inserta el `fuel_payment` (`:714`) y luego
   actualiza `paidAmount`/`status` del statement (`:724`) en otra operación. Un fallo
   intermedio deja el pago registrado sin reflejarse en el saldo.

**Recomendación:** Envolver ambos flujos en `db.transaction(async (tx) => { ... })`
y bloquear las filas relevantes (`SELECT ... FOR UPDATE`) al recalcular totales.

---

### 🔴 V3 — Borrar una carga rompe la integridad de la cuenta corriente

**Severidad:** Alta.

`deleteFuelLoadAction` (`combustibles/actions.ts:194-205`) hace **hard delete** sin
verificar el estado ni la pertenencia a un statement:

- No comprueba `existing.status` (permite borrar una carga `reconciled`), aunque
  `updateFuelLoadAction:145` sí bloquea editar cargas conciliadas. Asimetría.
- No comprueba `statementId`: al borrar una carga ya asignada a una cuenta corriente,
  los totales del statement (`totalAmount`, `totalLiters`, `totalIec`, `totalIva`)
  **no se recalculan** → el resumen queda inflado respecto a sus cargas reales, y los
  pagos/saldo se calculan sobre un total incorrecto.

**Recomendación:** Bloquear el borrado si `statementId != null` o `status` ∈
{`reconciled`} (o, alternativamente, recalcular el statement dentro de una
transacción tras el borrado). Idealmente usar *soft delete* / estado `cancelled`,
como ya se hace con vehículos y proveedores (`:466`, `:568`).

---

### 🟠 V4 — Tabla de imputaciones muerta + doble conteo latente

**Severidad:** Media.

- **Nadie escribe `vehicle_cost_allocations`.** No existe ningún `insert` sobre esa
  tabla en `app/`, `lib/`, `modules/`, `db/seed*` ni `scripts/`. La columna
  "Imputaciones" de `/flota` (`flota/page.tsx:100`) y los FK a
  `purchaseOrderItems` / `fuelLoads` / `maintenanceRecords`
  (`db/schema/vehicle-cost-allocations.ts:16-18`) son **funcionalidad incompleta**:
  hay esquema y rutas de lectura, pero ninguna ruta de escritura. Hoy esa columna
  siempre muestra $0.

- **Doble conteo latente.** `fleet.ts:54` suma **todas** las `amount` de
  imputaciones sin filtrar `costCategory`, mientras `analytics.ts:553` filtra
  explícitamente a `('parts','service','other')` para **evitar** contar dos veces lo
  que ya se suma desde `fuel_loads` y `maintenance_records`. Si algún día se pueblan
  imputaciones de categoría `'fuel'` o `'maintenance'`, `getFleetOverview` las
  contará dos veces en `totalOperationalCost` (`fleet.ts:85`), mientras Analítica no.
  Dos cálculos del mismo concepto que ya divergen por diseño.

**Recomendación:** Decidir si la imputación de costos se implementa o se elimina del
esquema/UI. Si se mantiene, unificar la lógica de agregación (un único helper) y que
`fleet.ts` aplique el mismo filtro de categorías que `analytics.ts`.

---

### 🟠 V5 — Importación de combustible: sin validación financiera ni dedupe contra BD

**Severidad:** Media.

`importFuelLoadsAction` (`combustibles/actions.ts:285-389`) + `lib/combustibles/import.ts`:

- **Confía 100% en los montos del Excel.** No recalcula ni valida coherencia
  (`totalAmount ≈ baseAmount + iecTotal + ivaAmount`). A diferencia de la carga
  manual, que sí puede auto-calcular con `calculateFuelAmounts`
  (`actions.ts:67-86`), la importación inserta los montos crudos con status
  `'registered'` (`:357`). Datos financieros potencialmente inconsistentes entran
  directo a producción.
- **Duplicados sólo dentro del archivo.** `parseFuelExcel` detecta duplicados por
  `receiptNumber` con un `Set` local (`import.ts:121-124`) y los **reporta** en
  `duplicates`, pero `toInsert` igual los incluye → se insertan. No hay verificación
  contra la BD ni restricción `unique` sobre `receiptNumber` (`fuel-invoices.ts`), por
  lo que **re-importar el mismo archivo duplica todas las cargas**.
- Sin scoping de faena (ver **V1**): el matching es por nombre de faena
  (`actions.ts:317,335`), sin validar que pertenezca al alcance del usuario.

**Recomendación:** Validar coherencia de montos al importar; deduplicar contra la BD
(o agregar índice único parcial sobre `receiptNumber`); excluir las filas marcadas
como duplicadas; aplicar scoping.

---

### 🟠 V6 — Total de mantención desacoplado de Neto + IVA

**Severidad:** Media-baja.

En `maintenance-form.tsx:130-143` y `lib/validation/maintenance.ts:16-18`, los tres
montos (`netAmount`, `taxAmount`, `totalAmount`) son inputs libres independientes;
sólo se valida `>= 0` (zod + el `CHECK maintenance_records_amounts_non_negative` de
`db/schema/maintenance.ts:35-39`). **No se valida ni se deriva** `total = neto + iva`.

Se puede registrar Total = 100.000 con Neto = 0 e IVA = 0. Los agregados de flota y
analítica suman `totalAmount`, así que el costo total es consistente, pero el desglose
tributario puede ser incoherente (problemático si luego se reporta IVA recuperable).

**Recomendación:** Auto-derivar `totalAmount` desde `neto + iva` (o validar la
igualdad con tolerancia de redondeo) en el schema/acción.

---

### 🟠 V7 — Permisos y CRUD incompletos en Vehículos

**Severidad:** Media.

- **Grants por defecto incoherentes con los roles del negocio:**
  - `flota:view` se concede sólo a `administrador` (`modules/flota/manifest.ts:27-29`).
    `jefa_chome` —rol global— puede **registrar mantenciones** pero **no puede ver
    `/flota`**. El rol `jefe_mantencion`, declarado como global en
    `lib/auth/scope.ts:9-15`, **no recibe** `flota:view` ni `mantenciones:*` por
    defecto. Los grants no reflejan a quién va dirigido el módulo.
- **Mantenciones es CRUD incompleto:** sólo `view` + `create`
  (`modules/mantenciones/manifest.ts`). No hay update, delete ni cambio de estado.
  El estado `cancelled` existe en el esquema y tanto `fleet.ts:47` como
  `analytics.ts:252` lo excluyen de los totales, pero **no hay forma de cancelar ni
  cerrar** una mantención desde la app. Un registro mal ingresado no se puede corregir.

**Recomendación:** Revisar la matriz de grants por defecto contra los roles reales
(jefe_mantencion, jefa_chome) y completar el CRUD mínimo de mantenciones
(editar/cancelar) con su transición de estado.

---

### 🔵 V8 — Duplicación de queries entre página y acciones

`combustibles/page.tsx:50-110` reimplementa la misma lógica de filtros, conteo y
gráficos que ya existe en `getFuelLoadsAction` y `getFuelChartDataAction`
(`actions.ts:226-279`, `:879-897`). Doble mantenimiento y, en la práctica, la causa
directa de que el scoping (V1) se haya quedado fuera en un lado.

---

### 🔵 V9 — Doble `requirePermission` y sobrepago en pagos

`addPaymentAction` (`combustibles/actions.ts:684-735`) llama
`requirePermission("combustibles:create")` dos veces: en `:688` y de nuevo en `:717`
sólo para obtener `user.id` (debería capturar la sesión una vez). Además, no valida
el saldo: `newPaidAmount` (`:721`) puede superar `totalAmount` y el estado pasa a
`'paid'` igual → **se permite sobrepago** sin advertencia.

---

### 🔵 V10 — Efecto secundario en GET (notificaciones)

`combustibles/page.tsx:34` dispara `checkFuelStatementNotifications().catch(()=>{})`
en **cada render** de la página (un GET), creando/recalculando notificaciones como
efecto secundario y tragándose cualquier error. Debería moverse a un job/cron o a un
disparo explícito, no ejecutarse en cada visita.

---

### 🔵 V11 — Vehículos sin faena invisibles para roles *scoped*

El scoping usa `inArray(worksiteId, ids)` (`fleet.ts:17`, `maintenance.ts:48`), que
**excluye `NULL`**. Un vehículo con `worksiteId = null` (permitido por
`fuel-vehicles.ts:14`) no aparece para usuarios de faena en `/flota` ni
`/mantenciones`, y no se le puede registrar mantención. Edge case a definir
(¿los vehículos sin faena son "de todos" o "de nadie"?).

---

## Hallazgos — Resto de módulos (visión general)

El resto del sistema está sano y consistente; los puntos a continuación son
observaciones, no defectos de la misma gravedad que el clúster de Vehículos.

- **Transacciones:** uso correcto y extendido de `db.transaction` en
  `lib/services/{stock,purchasing,receiving,deliveries,item-state,requests-delete,
  requests-draft,sst,notifications,password-reset}.ts` y en varias actions. El
  contraste con Combustibles (V2) es justamente lo que delata el problema.
- **Scoping:** patrón homogéneo vía `lib/auth/scope.ts` (`visibleWorksiteIds`,
  `isGlobalRole`, `worksiteScopeSql`) aplicado en analítica, dashboard, flota,
  mantenciones, trazabilidad, etc. — excepto Combustibles.
- **RBAC modular:** el registry (`modules/registry.ts`) deriva el tipo `Permission`
  y los grants automáticamente (`modules/permissions.ts`); es un buen diseño. Vale la
  pena auditar periódicamente que los `defaultGrants` reflejen los roles operativos
  (ver V7).
- **Exportaciones:** cumplen la regla del proyecto (XLSX vía `exceljs`,
  p.ej. `actions.ts:813`); no se detectó CSV.
- **Calidad general:** 1 `TODO`/`FIXME` y 1 `as any` en todo `app/+lib/+modules/`;
  manejo de errores con `logger` y Sentry configurado.

### Brecha de pruebas (transversal, relevante para Vehículos)

Hay 140+ archivos de test (incluyendo concurrencia contra Postgres y E2E), pero el
clúster de Vehículos está casi sin cubrir:

- **Con tests:** `lib/combustibles/__tests__/calculations.test.ts`,
  `import.test.ts`, `lib/__tests__/analytics-service.test.ts`, y el E2E
  `e2e/combustibles.spec.ts`.
- **Sin ningún test:** `lib/services/fleet.ts`, `lib/services/maintenance.ts`,
  `app/(app)/combustibles/actions.ts` (cuenta corriente, pagos, import, borrado),
  `app/(app)/mantenciones/actions.ts`.

Los flujos con mayor riesgo (V2, V3, V5) son precisamente los que no tienen pruebas.

### Higiene documental

La raíz acumula 6+ documentos de auditoría
(`AUDITORIA_CODIGO.md`, `AUDITORIA_FUNCIONES_FALTANTES.md`,
`AUDITORIA_INTEGRAL_CHOME.md`, `AUDITORIA_LOGICA_BUGS_FUNCIONALIDADES.md`,
`AUDITORIA_VISUAL.md`, `ANALITICA_TRANSVERSAL_CHOME.md`, y este). Están todos en `docs/auditoria/`. Conviene
consolidarlos en `docs/auditorias/` con un índice y fecha, para no perder
trazabilidad de qué hallazgo se cerró y cuándo.

---

## Acciones priorizadas

| # | Acción | Severidad | Esfuerzo aprox. |
|---|--------|-----------|-----------------|
| 1 | Aplicar scoping por faena en Combustibles (page + actions) — **V1** | 🔴 | M |
| 2 | Transaccionar `createMonthlyStatement` y `addPayment` — **V2** | 🔴 | S |
| 3 | Proteger `deleteFuelLoad` (estado/statement + recálculo) — **V3** | 🔴 | S |
| 4 | Decidir e implementar (o retirar) `vehicle_cost_allocations`; unificar agregación con Analítica — **V4** | 🟠 | M |
| 5 | Validación financiera + dedupe contra BD en import — **V5** | 🟠 | M |
| 6 | Derivar/validar `total = neto + iva` en mantención — **V6** | 🟠 | S |
| 7 | Revisar grants por defecto y completar CRUD de mantenciones — **V7** | 🟠 | M |
| 8 | Tests de servicio/acción para flota, mantenciones y combustibles | ⚪ | M |
| 9 | Limpiezas: V8–V11 + consolidar documentos de auditoría | 🔵 | S |

---

*Auditoría realizada sobre la rama `feat/sst-prevencion-module` el 2026-06-26.
Todas las referencias `archivo:línea` corresponden al estado del repo en esa fecha;
verificar vigencia antes de actuar sobre cada hallazgo.*
