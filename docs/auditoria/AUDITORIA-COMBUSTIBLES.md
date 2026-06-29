# Auditoría del módulo de Combustibles

**Fecha:** 2026-06-28
**Alcance:** Flujo completo del módulo `combustibles` — schema, server actions, ruta API de importación, librería de cálculos/queries/validación/reportes/notificaciones, páginas y formularios, RBAC y aislamiento por faena.
**Branch auditada:** `feat/sst-prevencion-module`

## Resumen ejecutivo

El módulo está bien estructurado en su "camino feliz": el aislamiento por faena tiene un punto único de verdad (`buildFuelLoadsWhere`), los pagos y la creación de resúmenes usan transacciones con `SELECT ... FOR UPDATE` correctamente (el driver es `postgres-js`, que sí soporta locking), y el `paidAmount` se recalcula desde la suma real de pagos en vez de acumular.

Sin embargo, la auditoría encontró **un patrón sistemático de erosión de garantías**: las rutas realmente conectadas a la UI (queries inline en `page.tsx` y la ruta API de importación) **reimplementan** la lógica que ya existía con salvaguardas en los server actions, pero **sin** esas salvaguardas. El resultado es que las versiones seguras de varias operaciones son **código muerto** y las versiones en uso tienen huecos de aislamiento, de integridad financiera y de deduplicación.

### Hallazgos por severidad

| # | Severidad | Hallazgo |
|---|-----------|----------|
| H1 | 🔴 Alta | Fuga de datos entre faenas en Cuenta Corriente y en lecturas por-ID (explotable hoy por roles con scope) |
| H2 | 🔴 Alta | La ruta API de importación confía en montos financieros del cliente sin validar coherencia |
| H3 | 🔴 Alta | La ruta API de importación no deduplica contra la BD → cargas duplicadas y costos doblados al re-importar |
| H4 | 🟠 Media | Editar una carga recalcula el IEC a 0 en el cliente y corrompe el desglose impositivo importado |
| H5 | 🟠 Media | Los totales del resumen mensual no se recalculan al editar una carga ya asignada → desfase financiero |
| H6 | 🟠 Media | `updateFuelLoadAction` / `deleteFuelLoadAction` / `registerFuelLoadAction` no validan acceso a la faena |
| H7 | 🟠 Media | Importación crea faenas (catálogo global compartido) y entidades sin transacción ni scope |
| H8 | 🟠 Media | Sin registro de auditoría en un módulo financiero (pagos, resúmenes, cargas) |
| H9 | 🟡 Baja | ~8 server actions y el `importFuelLoadsAction` completo son código muerto (las versiones *seguras*) |
| H10 | 🟡 Baja | Estados muertos (`reconciled`, `overdue`, `cancelled` de resumen) y columna muerta (`costCenterId`) |
| H11 | 🟡 Baja | Bug de zona horaria al parsear fechas de Excel (`toISOString`) → posible corrimiento de un día |
| H12 | 🟡 Baja | Inconsistencias menores de validación y de UX (coherencia en alta manual, dropdowns sin scope) |

---

## 🔴 Hallazgos de severidad alta

### H1 — Fuga de datos entre faenas (Cuenta Corriente y lecturas por ID)

El aislamiento por faena se aplica de forma consistente en las consultas de **lista/agregado** (vía `buildFuelLoadsWhere`), pero está **ausente en todas las lecturas por ID** y en **todo el flujo de cuenta corriente**.

**Evidencia:**
- [cuenta-corriente/page.tsx:11-21](app/(app)/combustibles/cuenta-corriente/page.tsx#L11-L21): sólo `requirePermission("combustibles:view")`, luego `findMany` de **todos** los resúmenes sin filtro de faena.
- [cuenta-corriente/[id]/page.tsx:15-29](app/(app)/combustibles/cuenta-corriente/[id]/page.tsx#L15-L29): carga el resumen con `loads: { with: { vehicle, worksite } }` — expone **todas** las cargas del resumen, de cualquier faena.
- [[id]/page.tsx:15-30](app/(app)/combustibles/[id]/page.tsx#L15-L30): la página de detalle/edición de una carga hace `findFirst({ where: eq(fuelLoads.id, id) })` **sin** scope. Cualquier usuario con `combustibles:view` puede ver cualquier carga navegando a `/combustibles/<id>`.
- Los actions huérfanos `getMonthlyStatementsAction` / `getMonthlyStatementByIdAction` ([actions.ts:728-760](app/(app)/combustibles/actions.ts#L728-L760)) tampoco aplican scope.

**Por qué es explotable hoy:** `combustibles:view` se concede a roles con scope —`solicitante_faena`, `prevencionista_faena`, `admin_contrato`— en [manifest.ts:54-59](modules/combustibles/manifest.ts#L54-L59). Esos usuarios ven la lista principal correctamente acotada, pero pueden abrir `/combustibles/cuenta-corriente`, cualquier `/combustibles/cuenta-corriente/<id>` y cualquier `/combustibles/<id>` y leer montos, litros, proveedores y patentes de faenas fuera de su alcance.

**Matiz de diseño:** un resumen mensual es por `proveedor + mes` y **agrega cargas de todas las faenas** (el proveedor factura a la empresa completa), así que la cuenta corriente es intrínsecamente global. La corrección correcta no es "filtrar por faena el resumen", sino **restringir la cuenta corriente a roles globales** (o a un permiso dedicado tipo `combustibles:manage_statements`), y **acotar por faena la lectura por-ID de cargas** igual que la lista.

**Recomendación:**
1. En `/combustibles/<id>` y en el action de lectura por ID, aplicar `buildFuelLoadsWhere(session, {})` o validar `canAccessWorksite(session, load.worksiteId)` tras el `findFirst` y devolver `notFound()` si no aplica.
2. Gatear el área de cuenta corriente detrás de un permiso/rol global y revisar a qué roles corresponde realmente `combustibles:view`.

---

### H2 — La importación confía en montos financieros del cliente sin validar

El parseo del Excel ocurre **en el navegador** ([import-fuel-modal.tsx:113-123](app/(app)/combustibles/import-fuel-modal.tsx#L113-L123) llama a `parseFuelExcel`) y luego el cliente envía el JSON ya parseado a la ruta API. La ruta API **inserta los montos tal cual**, sin Zod y sin verificar coherencia.

**Evidencia:** [app/api/combustibles/import/route.ts:80-132](app/api/combustibles/import/route.ts#L80-L132) toma `load.baseAmount`, `load.iecTotal`, `load.ivaAmount`, `load.totalAmount`, `load.liters` directamente de `req.json()` y los inserta. No hay validación de que `totalAmount ≈ baseAmount + iecTotal + ivaAmount`.

**Contraste:** el server action huérfano **sí** hacía esa verificación (±1 CLP) en [actions.ts:379-384](app/(app)/combustibles/actions.ts#L379-L384). Esa garantía se perdió al migrar el flujo real a la ruta API.

**Impacto:** un cliente manipulado (o un Excel adulterado) puede insertar cargas con totales arbitrarios e incoherentes que luego alimentan KPIs, gráficos, reportes y los totales de la cuenta corriente. Es una vía de corrupción de datos financieros sin barrera de servidor.

**Recomendación:** validar el payload de la ruta API con un schema Zod (un `z.array(parsedFuelLoadSchema)`) y re-aplicar la verificación de coherencia financiera ±1 CLP por fila antes de insertar. No confiar nunca en montos parseados en el cliente.

---

### H3 — La importación no deduplica contra la base de datos

La ruta API **no tiene** deduplicación: ni dentro del mismo archivo ni contra cargas ya existentes en la BD.

**Evidencia:** [route.ts:80-136](app/api/combustibles/import/route.ts#L80-L136) construye `toInsert` e inserta sin comparar contra nada existente.

**Contraste:** el action huérfano deduplicaba por **clave natural** (`proveedor::factura::vehículo::fecha::litros`) contra las cargas del mismo mes ([actions.ts:333-393](app/(app)/combustibles/actions.ts#L333-L393)), con un comentario explícito de que una misma factura cubre varias cargas. Esa lógica, cuidada, es la que quedó muerta.

**Impacto:** **re-importar el mismo Excel duplica todas las cargas**, doblando litros y costos en KPIs, reportes y resúmenes. Es un error operativo muy probable (los usuarios re-suben archivos).

**Recomendación:** portar la deduplicación por clave natural del action a la ruta API (consulta única por `inArray(month, monthsInFile)` + `Set` de claves), descartando filas ya presentes y reportándolas como omitidas.

---

## 🟠 Hallazgos de severidad media

### H4 — Editar una carga corrompe el desglose de IEC

En el formulario de edición, un `useEffect` recalcula IEC/IVA/Total cada vez que cambian litros o base, **siempre con tasas `null`** (IEC = 0), y publica esos valores en inputs ocultos que se envían al server action.

**Evidencia:** [edit-fuel-load-form.tsx:59-66](app/(app)/combustibles/[id]/edit-fuel-load-form.tsx#L59-L66) y los `<input type="hidden">` de [líneas 114-118](app/(app)/combustibles/[id]/edit-fuel-load-form.tsx#L114-L118). A diferencia del alta, el formulario de edición **no** envía `autoCalc`, por lo que `updateFuelLoadAction` no recalcula desde `system_settings` y persiste los ceros del cliente.

**Impacto:** una carga importada con IEC real (p. ej. desde el Excel de Copec) **pierde su IEC** (queda en 0) y su total se recalcula apenas se guarda cualquier edición, aunque el usuario sólo haya tocado una nota. Pérdida silenciosa de datos impositivos.

**Recomendación:** que el formulario de edición preserve los valores de IEC existentes (o que el cálculo respete las tasas configuradas), y que `updateFuelLoadAction` recalcule en el servidor o exija coherencia, en vez de confiar en campos ocultos del cliente.

---

### H5 — Los totales del resumen mensual se desfasan al editar cargas asignadas

`createMonthlyStatementAction` calcula los totales **una sola vez** ([actions.ts:703-711](app/(app)/combustibles/actions.ts#L703-L711)). Ningún otro camino recalcula `totalLiters/totalBaseAmount/totalIec/totalIva/totalAmount` del resumen (sólo `addPaymentAction` toca `paidAmount`).

Pero `updateFuelLoadAction` **permite editar una carga ya asignada a un resumen**: sólo bloquea `status === "reconciled"` ([actions.ts:157](app/(app)/combustibles/actions.ts#L157)), no la pertenencia a un `statementId`. (En cambio `deleteFuelLoadAction` sí bloquea borrar cargas asignadas — inconsistente.)

**Impacto:** editar montos de una carga que ya está dentro de un resumen deja los totales del resumen obsoletos, y por lo tanto el saldo pendiente y la lógica de pagos/notificaciones operan sobre cifras incorrectas.

**Recomendación:** bloquear la edición de montos de cargas con `statementId` (igual que el borrado), o recalcular los totales del resumen dentro de una transacción cuando una carga asignada cambie.

---

### H6 — `update`/`delete`/`register` de cargas no validan acceso a la faena

`createFuelLoadAction` valida `canAccessWorksite(session, parsed.data.worksiteId)` ([actions.ts:125](app/(app)/combustibles/actions.ts#L125)), pero las demás mutaciones de carga **no**:

- [updateFuelLoadAction:145-198](app/(app)/combustibles/actions.ts#L145-L198): no verifica la faena del registro existente **ni** la nueva `worksiteId` (se puede mover una carga a cualquier faena).
- [deleteFuelLoadAction:206-226](app/(app)/combustibles/actions.ts#L206-L226): borra por ID sin scope.
- [registerFuelLoadAction:228-243](app/(app)/combustibles/actions.ts#L228-L243): cambia estado sin scope.

Compárese con `updateFuelVehicleAction`, que **sí** valida tanto el registro existente como la nueva faena ([actions.ts:512-519](app/(app)/combustibles/actions.ts#L512-L519)).

**Mitigación actual:** `combustibles:create`/`delete` hoy sólo se conceden a roles globales (`administrador`, `jefa_chome`, `jefe_mantencion`), por lo que no es explotable de inmediato. Es un hueco de defensa en profundidad que se vuelve vulnerabilidad en cuanto se conceda `create` a un rol con scope.

**Recomendación:** replicar el patrón de `updateFuelVehicleAction` en las tres acciones (validar faena del registro existente y de la nueva, cuando aplique).

---

### H7 — La importación crea faenas (catálogo global) y entidades sin transacción

[route.ts:66-106](app/api/combustibles/import/route.ts#L66-L106): con `createMissing`/mapeo, la importación inserta en el catálogo **compartido** `worksites`, además de `fuelVehicles` (tipo `"camion"` hardcodeado, sin faena) y `fuelSuppliers`, todo gatado sólo por `combustibles:import`.

Problemas:
1. **Frontera de privilegios:** crear faenas globales desde un permiso del módulo de combustibles. Las faenas son catálogo administrado en otra área.
2. **Sin scope:** no se valida `canAccessWorksite` para ninguna fila importada (el action huérfano sí lo hacía, [actions.ts:374-377](app/(app)/combustibles/actions.ts#L374-L377)).
3. **Sin transacción:** las inserciones de entidades y de cargas son `await` sueltos en bucle (N+1). Si algo falla a mitad, quedan faenas/vehículos/proveedores creados sin las cargas → datos parciales.
4. **Carrera de unicidad:** dos importaciones concurrentes con la misma patente pueden chocar con el índice único de `plate` y abortar con 500.

**Recomendación:** envolver toda la importación en `db.transaction`, validar scope por faena, y mover la creación de faenas a un flujo administrativo (o exigir un permiso explícito); como mínimo, registrar/limitar quién puede crear faenas vía import.

---

### H8 — Sin auditoría en un módulo financiero

El módulo no escribe ninguna entrada de auditoría. Otros módulos sensibles sí usan `lib/audit.ts` (p. ej. `admin/usuarios`, `admin/productos`, `admin/faenas`, `admin/proveedores`). Aquí, crear/editar/borrar cargas, crear resúmenes y **registrar pagos** no dejan rastro.

**Impacto:** trazabilidad nula sobre dinero (pagos, ajustes de montos, eliminaciones). Difícil investigar discrepancias o atribuir cambios.

**Recomendación:** registrar en `lib/audit.ts` al menos: alta/edición/borrado de cargas, creación de resúmenes y registro de pagos (quién, qué, antes/después).

---

## 🟡 Hallazgos de severidad baja

### H9 — Código muerto: las versiones seguras quedaron huérfanas

Server actions exportados sin **ninguna** referencia desde UI/tests (verificado por grep): `getFuelLoadsAction`, `getFuelReportAction`, `getFuelChartDataAction`, `getFuelVehiclesAction`, `getFuelSuppliersAction`, `getMonthlyStatementsAction`, `getMonthlyStatementByIdAction` y el `importFuelLoadsAction` completo ([actions.ts:298-444](app/(app)/combustibles/actions.ts#L298-L444)).

Las páginas reimplementan esas queries inline (p. ej. la data de gráficos en [page.tsx:88-110](app/(app)/combustibles/page.tsx#L88-L110) duplica `getFuelChartDataAction`; `reportes` usa `lib/combustibles/reports.ts` en vez del action). El caso más grave es que **el import seguro (con scope, dedupe y coherencia) es el que está muerto**, mientras el import en uso (la ruta API) carece de esas salvaguardas (H2, H3, H7).

**Recomendación:** decidir una sola fuente por operación. O bien borrar los actions huérfanos, o bien hacer que las páginas y la ruta API los usen. Reusar evita que las salvaguardas se pierdan en cada reimplementación.

### H10 — Estados y columnas muertos

- **`reconciled`**: ningún camino de escritura asigna este estado; sólo se chequea para bloquear edición/borrado y se muestra en UI. Es inalcanzable. ([fuel-invoices.ts:43-45](db/schema/fuel-invoices.ts#L43-L45))
- **`overdue`** (resumen): nunca se asigna; el vencimiento se infiere de `dueDate` en notificaciones. Estado muerto.
- **`cancelled`** (resumen): no existe acción para cancelar ni borrar resúmenes; el estado es inalcanzable y, además, **no hay forma de desasignar cargas ni de revertir un resumen** una vez creado.
- **`costCenterId`**: columna + índice + relación en [fuel-invoices.ts:25](db/schema/fuel-invoices.ts#L25) que **ningún** camino de alta/import/edición rellena. Columna muerta.

**Recomendación:** implementar las transiciones faltantes (conciliación, marcar vencido, cancelar resumen) o eliminar los estados/columnas no usados para que el modelo refleje el comportamiento real.

### H11 — Bug de zona horaria al parsear fechas de Excel

[import.ts:81-89](lib/combustibles/import.ts#L81-L89) convierte fechas con `rawDate.toISOString().split("T")[0]`. Las fechas de Excel se interpretan como medianoche local; al pasar a ISO (UTC) en un servidor con offset negativo, la fecha puede **retroceder un día**, corriendo además el `month` derivado.

**Recomendación:** extraer Y/M/D con métodos locales (`getFullYear`/`getMonth`/`getDate`) o normalizar a mediodía UTC antes de formatear.

### H12 — Inconsistencias menores de validación y UX

- **Coherencia en alta manual:** `createFuelLoadAction`/`updateFuelLoadAction` no validan `total ≈ base + IEC + IVA` (sólo el import lo hacía). Misma clase de problema que H2 en el camino manual.
- **`baseAmount`:** el alta acepta `min(0)` ([validation.ts:18](lib/combustibles/validation.ts#L18)) mientras el import exige `> 0` ([import.ts:136](lib/combustibles/import.ts#L136)). Inconsistente.
- **Dropdowns sin scope:** [nueva/page.tsx](app/(app)/combustibles/nueva/page.tsx) y [[id]/page.tsx](app/(app)/combustibles/[id]/page.tsx) cargan **todas** las faenas/vehículos sin acotar por sesión, a diferencia de la lista principal que sí usa `buildFuelVehiclesWhere`. Hoy sólo lo ven roles globales, pero es inconsistente.
- **Preview de IEC engañosa:** el formulario de alta siempre muestra IEC = 0 (tasas `null`), pero el servidor con `autoCalc=true` recalcula desde `system_settings`; lo que el usuario ve puede no ser lo que se guarda.
- **Notificaciones sin `dueDate`:** los resúmenes sin fecha de vencimiento nunca disparan alerta de vencido, aunque queden impagos indefinidamente ([notifications.ts:26-41](lib/combustibles/notifications.ts#L26-L41)).

---

## Lo que está correcto (no tocar)

- **Concurrencia de pagos y resúmenes:** `addPaymentAction` y `createMonthlyStatementAction` usan `db.transaction` + `.for("update")` para bloquear el resumen/las cargas, y `paidAmount` se recalcula desde `SUM(payments)` en vez de acumular. El driver `postgres-js` ([db/index.ts](db/index.ts)) soporta este locking correctamente. Sólido.
- **Punto único de scope para listas/agregados:** `buildFuelLoadsWhere` / `worksiteScopeSql` centralizan el aislamiento por faena en lista, KPIs, gráficos y export. El problema (H1) es que las lecturas por-ID y la cuenta corriente no lo usan, no el helper en sí.
- **Validación tolerante del Excel:** la normalización de encabezados (`normKey`) y el auto-match de faenas son robustos ante variaciones del archivo de Copec.
- **Export en XLSX:** `exportFuelLoadsXlsxAction` respeta scope, exige `combustibles:export` y cumple la regla del proyecto (XLSX, no CSV).
- **Cron de notificaciones:** correctamente extraído a `/api/cron/...` protegido por `CRON_SECRET`, en vez de ejecutarse como efecto secundario en cada render.

---

## Prioridad de remediación sugerida

1. **H1** (fuga entre faenas) — acotar lecturas por-ID y gatear cuenta corriente. *Explotable hoy.*
2. **H2 + H3** (import: coherencia + dedupe) — validar el payload de la ruta API y deduplicar. *Corrupción/duplicación de datos financieros, alta probabilidad operativa.*
3. **H4 + H5** (corrupción de IEC al editar y desfase de totales de resumen).
4. **H6 + H7** (scope en mutaciones y atomicidad/privilegios del import).
5. **H8** (auditoría financiera).
6. **H9–H12** (limpieza de código muerto, estados/columnas muertos, TZ, validaciones menores) — idealmente junto a 1–4, ya que reusar las versiones seguras huérfanas resuelve varios huecos de una sola vez.
