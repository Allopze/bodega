# Auditoría del módulo Bodega — 2026-08-04

> **Alcance:** análisis de funcionalidad e integración del módulo de bodega con el resto de la webapp.
> **Método:** lectura de páginas, acciones, servicios, esquema, manifests, tests unitarios/integración/e2e y puntos de consumo de stock (dashboard, analítica, trazabilidad, cola operacional, alertas).

---

## Veredicto general

**El módulo está bien integrado y cumple su función correctamente, con una arquitectura sólida.** Es uno de los módulos mejor diseñados del sistema:

- ✅ Punto único de mutación de stock atómico (`applyMovement`).
- ✅ RBAC por faena en todas las capas (página, server actions y servicios).
- ✅ Trazabilidad completa con folios (`AJU-*`, `DEV-*`, `CON-*`, `ENT-*`, `REC-*`) y auditoría.
- ✅ Tests en todos los niveles, incluida concurrencia sobre PostgreSQL real.
- ⚠️ **1 brecha de integración real**: `dispatchAction` (entrega a faena) no está conectada a ninguna UI.
- 🔸 3 observaciones menores (enum crudo en kardex, alertas sin scope en dashboard, kardex móvil incompleto).

---

## 1. ¿Cumple su función? — SÍ ✅

### 1.1 Punto único de mutación (invariante arquitectónica)

`applyMovement()` / `applyMovementTx()` (`lib/services/stock-movement.ts`) es **el único lugar donde se muta stock**. Verificado por búsqueda exhaustiva: todos los ingresos y egresos pasan por ahí:

| Origen | Tipo de movimiento | Archivo |
|---|---|---|
| Recepción de OC en faena | `ingreso_oc` (+) | `lib/services/receiving.ts` |
| Entrega a faena | `egreso_entrega` (−) | `lib/services/deliveries-worksite.ts` |
| Entrega de EPP a trabajador | `egreso_entrega` (−) + `retiro_epp_trabajador` (0) | `lib/services/deliveries-worker-epp.ts` |
| Devolución de entrega a faena | `ingreso_devolucion` (+) | `lib/services/stock-movement.ts` |
| Ajuste manual | `ajuste` (±) | `lib/services/stock-movement.ts` |
| Cierre de conteo físico | `ajuste` (±) | `lib/services/physical-inventory.ts` |

### 1.2 Invariantes en base de datos (`db/schema/stock.ts`)

- `worksite_stock`: stock y mínimo **nunca negativos** (CHECK) + índice único `(worksite_id, product_id)`.
- `inventory_movements`: tipo validado por CHECK contra el set canónico, `stock_before`/`stock_after` no negativos, índices `(worksite, performed_at)`, `(product, performed_at)` y `(worksite, product, type)`.
- Documentos trazables con folio único: `stock_adjustments` (AJU), `stock_returns` (DEV), `physical_inventory_counts` (CON).

### 1.3 Ante-condiciones y serialización

- Bloquea stock negativo con mensaje claro (`Stock insuficiente: disponible X, solicitado Y`).
- Ajuste exige motivo; desecho exige cantidad > 0.
- Devolución valida saldo contra la línea de entrega usando `SELECT ... FOR UPDATE` sobre `delivery_items` (punto de serialización).
- Cierre de conteo bloquea producto y stock antes de calcular diferencias (evita carreras).

### 1.4 Cobertura de tests

- **Unitarios/integración:** `stock-service.test.ts`, `stock-movement.test.ts`, `bodega-actions.test.ts`, `bodega-filters.test.ts`, `physical-inventory.test.ts`, `physical-inventory-service.test.ts`, `stock-export.test.ts`, `stock-alerts.test.ts`, `stock-epp-alerts.test.ts`.
- **Concurrencia real (PostgreSQL):** `stock-concurrency-postgres.test.ts`, `deliveries-concurrency-postgres.test.ts`.
- **Flujo completo:** `full-flow-integration.test.ts` (solicitud → OC → recepción → stock → entrega), `receiving-two-stage.test.ts`.
- **E2E:** `bodega-conteo-fisico.spec.ts` (carga de página), más presencia de `/bodega` en `dashboard.spec.ts`, `accessibility.spec.ts`, `keyboard-navigation.spec.ts`, `reflow-anchos.spec.ts`, `rsc-payload.spec.ts`, `perceived-latency.spec.ts`, `zoom-200.spec.ts`.

---

## 2. ¿Está bien integrado con el resto de módulos? — SÍ ✅ (con 1 salvedad)

| Punto de integración | Cómo | Estado |
|---|---|---|
| **Compras → Recepción → Bodega** | `registerReceipt` inyecta stock (`ingreso_oc`) al recibir en faena; notifica al solicitante | ✅ |
| **Bodega → Entregas** | `registerWorksiteDelivery` / `registerWorkerEppDelivery` descuentan stock (`egreso_entrega`) | ✅ (ver brecha §3) |
| **Bodega → Prevención** | Entregas EPP alimentan la matriz de cobertura preventiva; alertas de stock EPP (`stock-epp-alerts`) | ✅ |
| **Bodega → Dashboard** | Sección "Bodega y entregas" (stock crítico, alertas, rotación, EPP entregado); badge nav `/bodega` con conteo de stock crítico; quick actions | ✅ |
| **Bodega → Analítica** | Rotación de bodega y EPP entregado por trabajador (`analytics-module/dashboard.ts`) | ✅ |
| **Bodega → Trazabilidad** | Movimientos de inventario en la ficha del ítem (`trazabilidad-item`) | ✅ |
| **Bodega → Cola operacional / Pendientes** | Genera trabajo "registrar entrega a faena/trabajador" (`operational-work-queue`) | ✅ (ver brecha §3) |
| **Exports** | Excel (regla del repo) en `/api/bodega/stock/export` y `/api/bodega/kardex/export` | ✅ |
| **Permisos / navegación** | Módulo registrado en `modules/registry.ts`; manifest con 3 permisos y `defaultGrants` coherentes; área `bodega` en sidebar | ✅ |
| **Caché / revalidación** | `revalidateOperationalViews` tras cada mutación (dashboard, pendientes, badges) | ✅ |

### 2.1 RBAC correcto en todas las capas

- La página filtra faenas, stock y movimientos por `visibleWorksiteIds` / `isGlobalRole`.
- Las server actions validan `canAccessWorksite` antes de operar.
- Los servicios reciben el scope resuelto (`string[] | "all"`) y lo revalidan (defensa en profundidad).
- El badge `/bodega` usa `getCriticalStockAlertCount(wsIds)` con el scope del usuario.

---

## 3. Brecha encontrada: `dispatchAction` sin UI conectada ⚠️

`dispatchAction` en `app/(app)/bodega/actions.ts` (que registra la **"entrega a faena"** vía `registerWorksiteDelivery`, `destinationType: "faena"`) está definida, validada con `dispatchSchema` y cubierta por tests, **pero ninguna vista la invoca**:

- `BodegaMovementSheet` (`movement-sheet.tsx`) solo expone 3 opciones: **devolución, conteo físico y ajuste**. No hay opción de despacho/entrega.
- `/entregas` solo gestiona entregas a **trabajador** (`destinationType: "worker"` — la página lo filtra explícitamente).
- La cola operacional declara *"Bodega debe registrar la entrega a faena"* (`lib/work-queue-labels.ts:97`), pero **no existe formulario que ejecute ese paso** → el usuario llega a un estado de trabajo que no puede completar desde la UI.

**Impacto:** el flujo "ítem recibido → entregar a faena" queda huérfano. Solo se puede completar vía entrega de EPP a trabajador (que sí tiene UI) o mediante ajustes manuales de stock.

**Opciones de remediación:**

1. **Conectar la acción existente**: agregar una opción "Entrega a faena" al `BodegaMovementSheet` (o al módulo `/entregas`) reutilizando `dispatchAction` tal como está (ya valida saldo pendiente del ítem de solicitud y scope).
2. **Retirar la acción muerta**: si el flujo quedó obsoleto a propósito (la entrega nominal EPP lo reemplaza), eliminar `dispatchAction` y ajustar el label de la cola operacional para no anunciar un paso inexistente.

---

## 4. Observaciones menores 🔸

### 4.1 Kardex muestra el enum crudo (regla A6)

`app/(app)/bodega/kardex-table.tsx`: `MOVEMENT_TYPE_LABELS` no incluye `retiro_epp_trabajador`, así que cualquier entrega EPP con retiro de equipo usado renderiza **"retiro_epp_trabajador"** tal cual en la UI (viola la regla A6: estados siempre mapeados a español). Adicionalmente el label de `egreso_desecho` es "Retiro", ambiguo frente a ese tipo.

**Fix sugerido:** agregar `retiro_epp_trabajador: "Retiro EPP usado"` (o similar) al mapa de labels.

### 4.2 Dashboard consulta alertas sin scope

`WarehouseSection` (`dashboard-domain-sections.tsx`) llama `getStockAlerts()` sin scope y filtra en JS (`alerts.filter(alert => alert.worksiteId === worksiteId)`). Consulta el stock de **todas** las faenas aunque el usuario tenga faena única. Impacto menor en volumen hoy, pero `getStockAlerts()` debería aceptar scope de faenas (como ya hace `getCriticalStockAlertCount`).

### 4.3 Kardex móvil incompleto

En mobile, `KardexTable` renderiza `movements.slice(0, 10)` mientras el desktop muestra los 25 de la página (`KARDEX_PAGE_SIZE = 25`). Inconsistencia menor desktop/móvil.

---

## 5. Resumen ejecutivo

| Dimensión | Estado |
|---|---|
| Funcionalidad del módulo | ✅ Cumple (stock, kardex, devoluciones, ajustes, conteo físico, exports) |
| Integración con otros módulos | ✅ Alta (compras, recepción, entregas, prevención, dashboard, analítica, trazabilidad, cola, badges) |
| Seguridad / RBAC | ✅ Sólido (scope por faena en página, acciones y servicios) |
| Consistencia de datos | ✅ Punto único de mutación + invariantes en DB + serialización |
| Cobertura de tests | ✅ Amplia, incluye concurrencia real |
| Brechas funcionales | ⚠️ 1 (entrega a faena sin UI) |
| Deuda menor | 🔸 3 (enum crudo, alerts sin scope, kardex móvil) |

**Prioridad recomendada:** resolver la brecha de `dispatchAction` (§3) — conectar la acción existente o retirarla — y luego los fixes menores de §4.

---

## Addendum de remediación — 2026-08-11

La alternativa 2 de §3 quedó aplicada:

- Se retiraron `dispatchAction`, `dispatchSchema` y `registerWorksiteDelivery`, que no tenían consumidor de UI y duplicaban el traslado real por guía interna.
- El traslado Oficina → Faena permanece exclusivamente en el flujo de guía interna, iniciado desde Compras/Recepción. La ruta técnica histórica `/bodega/guias` se conserva para enlaces y documentos existentes, pero no tiene ítem de navegación en Bodega.
- Las entregas nuevas se registran desde `/entregas` contra stock físico, con una cabecera por trabajador y múltiples productos; cada línea produce su movimiento `egreso_entrega` en una única transacción.
- La cola operacional ahora indica la entrega al trabajador, no una inexistente entrega manual a faena.
