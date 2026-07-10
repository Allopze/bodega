# Editar ítems de una orden de compra ya enviada

**Fecha:** 2026-07-10
**Estado:** Diseño aprobado, pendiente de plan de implementación

## Problema

Cuando el proveedor rechaza una OC por un error (una cantidad mal, un precio, una
línea de más o de menos), hoy la única salida es **anular** la OC completa y crear
una nueva. No existe forma de corregir ítems de una OC ya enviada — de hecho no
existe edición de ítems en **ninguna** OC, ni siquiera en borrador: el formulario
de ítems (`app/(app)/compras/oc-form.tsx`) solo se usa al **crear** en
`/compras/nueva`, y los ítems se generan desde la solicitud aprobada.

Se quiere permitir editar ítems de una OC ya enviada, restringido a tres perfiles:
Jefa Dpto. Prevención, Secretaría y Administrador.

## Alcance (decisiones tomadas)

- **Qué se puede editar:** edición completa — cambiar cantidad, precio unitario y
  descuento de ítems existentes; **quitar** líneas; **agregar** líneas nuevas.
- **Ítems nuevos:** líneas libres (producto del catálogo o texto no catalogado),
  **sin** vínculo a solicitud aprobada (`requestItemId = null`).
- **Estados permitidos:** solo `sent` y `supplier_confirmed`, y únicamente si
  **ningún ítem tiene recepción** registrada.
- **Al guardar:** se registra en auditoría y se **exige un motivo** obligatorio.
- **NO** se re-notifica a recepción.
- **Fuera de alcance:** al editar la cantidad de una línea vinculada a una
  solicitud, **no** se sincroniza la cantidad de la solicitud (solo se toca la OC).

## Contexto del código

- Ciclo de vida de la OC (`db/schema/purchasing.ts:41`):
  `draft → issued → sent → supplier_confirmed → …recepción… → closed`, más
  `cancelled`. **No** hay estado `rejected`.
- La recepción mueve el estado a `partially_office_received` / `office_received` /
  `partially_received` / `received`. Por eso, si el estado es exactamente `sent` o
  `supplier_confirmed`, no ha habido recepción a nivel de orden; el chequeo de
  `SUM(quantityReceived) = 0` es defensa adicional.
- RBAC (`lib/auth/system-rbac.ts:19-22`): roles ya existentes
  `rol-admin` (administrador), `rol-sec` (secretaria),
  `rol-prev` (slug `prevencionista`, label "Jefa Dpto. Prevención de riesgos").
  El rol `administrador` recibe **todos** los permisos automáticamente
  (`system-rbac.ts:67`).
- Permisos por módulo se declaran en el manifest vía `defaultGrants`
  (`modules/purchasing/manifest.ts`). RBAC se sincroniza con
  `npm run db:sync-rbac` (`scripts/sync-rbac.ts` → `ensureSystemRbac`),
  **nunca** en migraciones (AGENTS.md).
- Reutilizables: `computeOrderTotals` (`lib/order-totals.ts`) para recalcular
  net/tax/total; `recordAudit` y `recordStatusChange` para auditoría; el patrón de
  transacción de `cancelOrder` (`lib/services/purchasing-module/purchase-orders-status.ts`)
  para devolver una solicitud a `pending_purchase`.

## Diseño

### 1. Permiso y roles

Nuevo permiso `purchasing:edit_sent_order` en `modules/purchasing/manifest.ts`:

- Agregar a `permissions`.
- `permissionMeta`: `{ id: "p-pur-editsent", description: "Editar ítems de OC ya enviada" }`.
- `defaultGrants` para `administrador`, `secretaria` y `prevencionista`.
- Se aplica con `npm run db:sync-rbac` (no `db:seed` — ese comando solo carga
  roles/permisos en el bootstrap del primer usuario; los cambios a manifests en
  una BD ya poblada requieren `db:sync-rbac`, ver `scripts/sync-rbac.ts`).

### 2. Guard de edición

Helper `isOrderItemsEditable(order, hasReception)` (en la capa de servicio de
purchasing) que retorna `true` solo si:

- `order.status ∈ {"sent", "supplier_confirmed"}`, y
- no hay recepción (`SUM(quantityReceived) = 0` sobre los ítems de la OC).

El permiso se valida por separado en la action (`requirePermission`) y el acceso a
la faena con el patrón existente (`assertOrderAccess` / `serviceWorksiteScope`).

### 3. Servicio `updateSentOrderItems` (nuevo)

Ubicación: `lib/services/purchasing-module/` (exportado por `index.ts` y
re-exportado por `lib/services/purchasing.ts` según el patrón actual).

Firma aproximada:

```ts
updateSentOrderItems(
  orderId: string,
  items: EditableOrderItem[],
  reason: string,
  userId: string,
  scope: WorksiteScope,
  opts?: { userEmail?: string },
): Promise<void>
```

Dentro de una transacción:

1. Cargar la OC y sus ítems; re-verificar el guard (estado + sin recepción) y el
   acceso a faena. Lanzar error si no aplica.
2. **Diff** de `items` contra los ítems actuales (por `id`):
   - **Quitados** (existían y ya no vienen): si tienen `requestItemId`, devolver esa
     solicitud a `pending_purchase` (mismo patrón que `cancelOrder`); borrar la
     línea de `purchaseOrderItems`.
   - **Nuevos** (sin `id`): insertar como línea libre —
     `requestItemId = null`, `status: "issued"`, `quantityReceived: 0`,
     `subtotal` recalculado.
   - **Editados**: actualizar `quantity` / `unitPrice` / `discount` / `notes` y
     recalcular `subtotal = round(quantity * unitPrice * (1 - discount/100))`.
3. Recalcular totales con `computeOrderTotals(items)` y actualizar
   `netAmount` / `taxAmount` / `totalAmount` en `purchaseOrders`.
4. `recordAudit({ action: "update", entityType: "purchase_order", entityId,
   entityCode, oldState, newState: { items, totals, reason } })` — el motivo queda
   en la auditoría.
5. No re-notificar a recepción.

### 4. UI

- **Ruta nueva** `app/(app)/compras/[id]/editar/page.tsx`: server page que carga la
  OC, valida `isOrderItemsEditable` + permiso, y precarga `oc-form.tsx` con los
  ítems actuales. Añade un campo **motivo obligatorio**.
- **Botón "Editar ítems"** en `app/(app)/compras/[id]/oc-actions.tsx`, visible solo
  cuando el guard se cumple y el usuario tiene `purchasing:edit_sent_order`.
- **Action** `editSentOrderItemsAction` (en `app/(app)/compras/actions/`): valida
  `requirePermission("purchasing:edit_sent_order")`, acceso a faena, motivo no
  vacío; llama a `updateSentOrderItems`; revalida `/compras` y `/compras/[id]`.

### 5. Tests

- **Servicio** (`lib/services` o `app/(app)/compras`, según el patrón de tests de
  purchasing existente):
  - Editar cantidad/precio → totales recalculados correctamente.
  - Quitar una línea vinculada a solicitud → la solicitud vuelve a
    `pending_purchase`.
  - Agregar una línea libre → se inserta con `requestItemId = null`.
  - Rechaza si la OC tiene recepción registrada.
  - Rechaza si el estado no es `sent` ni `supplier_confirmed`.
  - Rechaza sin el permiso `purchasing:edit_sent_order`.

## Preguntas abiertas

Ninguna. Las dos que quedaban (nombre del permiso y no-sincronizar la cantidad de
la solicitud) fueron confirmadas.
