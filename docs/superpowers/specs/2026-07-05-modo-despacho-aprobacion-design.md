# Diseño: modo de despacho elegido en aprobación (vía oficina / directo a faena)

## Contexto

Hoy toda orden de compra (OC) pasa obligatoriamente por dos etapas de recepción: primero `office` (llegada a oficina Chome, checkpoint sin stock) y luego `faena` (recepción en terreno, genera stock). El código en `lib/services/receiving.ts:70-71` bloquea explícitamente recibir en faena si la OC no pasó antes por oficina, y el comentario en la línea 108 deja constancia de que el camino directo a faena fue cerrado a propósito.

La invariante que sostiene ese bloqueo está a nivel de base de datos: el CHECK constraint `purchase_order_items_numeric_integrity` (`db/schema/purchasing.ts:81-91`) exige `quantityReceived ≤ quantityOfficeReceived ≤ quantity`.

El negocio necesita reabrir el camino directo a faena para ciertos casos, pero como decisión que toma **secretaria (o jefa_chome/administrador) al aprobar la solicitud**, no el solicitante. La solicitud no tiene hoy ningún campo de destino de envío (`db/schema/requests.ts`).

## Objetivos

- Agregar un campo `delivery_mode` (`via_oficina` | `directo_faena`) elegible solo por roles aprobadores, en la pantalla `/aprobaciones`.
- Propagar ese modo a la OC que se genera desde la solicitud aprobada.
- Que la recepción respete el modo: `directo_faena` permite recibir en faena sin pasar por oficina; `via_oficina` mantiene el comportamiento actual sin cambios.
- Mantener el invariante de integridad sin duplicar la máquina de estados: no se agregan valores nuevos al enum de `status` de OC/ítems.

## No objetivos

- No se agrega ningún campo ni input al formulario de solicitud (`app/(app)/solicitudes/`). El solicitante no opina.
- No se reescribe el flujo de recepción existente para `via_oficina`; solo se hace condicional donde haga falta.
- No se permite mezclar en una misma OC ítems de solicitudes con `delivery_mode` distinto — se bloquea con error, no se decide automáticamente.
- No se toca `deliveries` (entrega faena/trabajador) ni el módulo de compras más allá de la copia del campo.

## Modelo de datos

Dos columnas nuevas, mismo enum en ambas, default `via_oficina` (comportamiento actual, cero impacto en filas existentes):

```ts
// db/schema/requests.ts — purchaseRequests
deliveryMode: text("delivery_mode").notNull().default("via_oficina"),
// CHECK: delivery_mode IN ('via_oficina', 'directo_faena')

// db/schema/purchasing.ts — purchaseOrders
deliveryMode: text("delivery_mode").notNull().default("via_oficina"),
// CHECK: delivery_mode IN ('via_oficina', 'directo_faena')
```

`purchaseOrders.deliveryMode` es una **copia (snapshot)** tomada al crear la OC, no un join en vivo a `purchase_requests` — igual que `worksiteId`/`costCenterId` ya se copian hoy.

**Constraint relajado** en `purchase_order_items` (`purchase_order_items_numeric_integrity`): se elimina la cláusula cruzada `quantityReceived ≤ quantityOfficeReceived` y se reemplaza por cotas independientes:

```sql
quantity > 0
AND unitPrice >= 0 AND discount >= 0 AND discount <= 100 AND subtotal >= 0
AND quantityOfficeReceived >= 0 AND quantityOfficeReceived <= quantity
AND quantityReceived >= 0 AND quantityReceived <= quantity
```

El orden office-antes-que-faena deja de ser una regla de tabla incondicional y pasa a ser una regla de aplicación condicionada por `delivery_mode` (para `via_oficina` se sigue enforzando exactamente igual que hoy, solo que en código en vez de en el constraint).

## Flujo de aprobación (`/aprobaciones`)

- `RequestGroup` (`app/(app)/aprobaciones/request-group.tsx`) agrega un selector `Modo de despacho` en el header, junto al badge de tipo y la faena.
- Visible solo si el rol del usuario está en `EPP_APPROVER_ROLES` (`administrador`, `jefa_chome`, `secretaria`, `prevencionista` — mismo set que ya aprueba EPP en `aprobaciones/actions.ts:17`).
- Nueva server action `updateDeliveryModeAction(requestId, mode)` en `aprobaciones/actions.ts`: valida permiso `approvals:approve` + `canAccessWorksite`, hace `UPDATE purchase_requests SET delivery_mode = ...`. No afecta items ni sus decisiones (`approvalDecisions`) — es un atributo de la solicitud, no una decisión de ítem.
- Sin valor elegido, la solicitud queda en `via_oficina` (default), idéntico al comportamiento actual. No se fuerza a secretaria a decidir.

## Creación de OC (`app/(app)/compras/actions.ts`)

Al armar los ítems de la nueva OC (ya agrupa por `worksiteId` vía `dbItem.request...`, línea ~101-105):

- Se consulta `delivery_mode` de cada solicitud de origen de los ítems seleccionados.
- Si hay más de un valor distinto entre las solicitudes involucradas → error: *"Los ítems seleccionados pertenecen a solicitudes con modo de despacho distinto. Crea órdenes separadas."*
- Si es homogéneo, ese valor se copia a `purchaseOrders.deliveryMode` al insertar la OC.

## Recepción (`lib/services/receiving.ts`)

- El guard de la línea 70-71 (`"Debes registrar primero la llegada a oficina..."`) solo aplica si `order.deliveryMode === "via_oficina"`.
- `remaining` para `stage: "faena"` (línea 112-114): si `order.deliveryMode === "directo_faena"`, se calcula `quantity - currentReceived` (igual fórmula que ya usa `office`), ignorando `quantityOfficeReceived` por completo.
- Se rechaza explícitamente `stage: "office"` cuando `order.deliveryMode === "directo_faena"` (ese checkpoint no aplica; evita registrar datos sin sentido).
- `rollupOrderReceiptStatus` (línea 195+): rama nueva — si `directo_faena`, el status se decide solo con `quantityReceived` vs `quantity` (`received` / `partially_received`), sin mirar `quantityOfficeReceived` en ningún momento. La rama `via_oficina` no cambia.

## UI de recepción (`app/(app)/recepcion/`)

- `ReceiptForm` recibe `deliveryMode` como prop nueva.
- El botón "Recepción en oficina" deja de renderizarse para OCs `directo_faena` (el caller pasa `canOffice={false}` cuando `order.deliveryMode === "directo_faena"`, reusando el gate `canOffice && (...)` que ya existe en el JSX — sin rama nueva dentro del componente).
- `getRemaining` para `"faena"`: si `directo_faena`, usa `item.quantity - item.quantityReceived` en vez de `item.quantityOfficeReceived - item.quantityReceived`.
- `TwoStageProgress` (indicador de 2 pasos) no se muestra para `directo_faena` — ya se oculta automáticamente porque exige `canOffice && canFaena` (línea 44-45) y `canOffice` viene en `false`.

## Testing

- `lib/__tests__/receiving-two-stage.test.ts`: agregar casos para `directo_faena` — recibir en faena sin recepción de oficina previa; status salta de `sent` directo a `partially_received`/`received`; rechazo de `stage: "office"` en una OC `directo_faena`.
- `lib/__tests__/compras-actions-extra.test.ts`: caso de error al mezclar ítems de solicitudes con `delivery_mode` distinto en una misma OC.
- `lib/__tests__/aprobaciones-actions.test.ts`: `updateDeliveryModeAction` — solo roles aprobadores, persiste el valor, no toca `approvalDecisions`.
- `app/(app)/recepcion/receipt-form.test.tsx`: OC `directo_faena` no ofrece opción de oficina y arranca directo en `stage: "faena"`.

## Alcance de implementación

Una sola migración (`npm run db:generate`) para las 2 columnas nuevas + el constraint relajado. Sin backfill manual: el default `via_oficina` cubre las filas existentes. No se toca `db/migrations/meta/_journal.json` a mano — lo genera drizzle-kit.
