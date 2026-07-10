# Editar ítems de OC enviada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Administrador, Secretaría, and Jefa Dpto. Prevención edit the items (quantity, price, add/remove lines) of a purchase order that's already `sent` or `supplier_confirmed`, as long as nothing has been received yet — so a supplier-rejected OC can be corrected in place instead of anulada + re-created.

**Architecture:** New service function `updateSentOrderItems` in the existing `lib/services/purchasing-module/` layer, gated by a pure `isOrderItemsEditable(status, totalReceived)` guard added to `lib/services/purchasing.constants.ts`. A new Server Action + a new route `/compras/[id]/editar` reuse the existing `ProductPicker` combobox (from `app/(app)/solicitudes/`) for adding free-form lines. A new permission `purchasing:edit_sent_order` is granted to the three roles via the module manifest.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Drizzle ORM (Postgres), Zod, Vitest + PGlite for integration tests.

## Global Constraints

- Business logic lives in `lib/` + `app/`, never recreate `modules/*/{services,actions,schema,validation}` (AGENTS.md).
- Never hand-edit `db/migrations/meta/_journal.json`; this plan adds no schema changes, so no migration is needed.
- RBAC changes go in `modules/purchasing/manifest.ts` and are applied to an already-seeded DB with `npm run db:sync-rbac` (NOT `db:seed` — that only runs at first-user bootstrap).
- New pages under `app/(app)/` must use `<PageHeader>` + `<PageContainer>`, no standalone `<h1>`, no extra padding wrappers, no standalone search `<input>` (see AGENTS.md page-layout rules).
- Editable scope (per approved spec `docs/superpowers/specs/2026-07-10-editar-items-oc-enviada-design.md`): quantity/price/discount/notes editable on existing lines; existing lines' product identity is NOT editable (remove + re-add as a new free line instead); new lines are free-form (catalog or free text), never linked to a request (`requestItemId: null`); editable only in `sent`/`supplier_confirmed` with zero reception; motivo obligatorio; audit logged; no re-notification to recepción.

---

### Task 1: Service layer — `isOrderItemsEditable` guard + `updateSentOrderItems`

**Files:**
- Modify: `lib/services/purchasing.constants.ts`
- Create: `lib/services/purchasing-module/purchase-orders-edit.ts`
- Modify: `lib/services/purchasing-module/purchase-orders.ts`
- Modify: `tests/pglite-files.ts`
- Create: `lib/__tests__/purchase-order-edit-items.test.ts`

**Interfaces:**
- Produces: `isOrderItemsEditable(status: string, totalReceived: number): boolean`, `EDITABLE_ITEM_ORDER_STATUSES: readonly string[]`, `EditableItemOrderStatus` type — exported from `@/lib/services/purchasing.constants` and re-exported via `@/lib/services/purchasing`.
- Produces: `updateSentOrderItems(orderId: string, items: EditableOrderItemInput[], reason: string, userId: string, worksiteIds?: string[] | "all", opts?: { userEmail?: string }): Promise<void>` and `EditableOrderItemInput` type — exported from `@/lib/services/purchasing`.
- Consumes: `computeOrderTotals` from `@/lib/order-totals`, `recordAudit` from `@/lib/audit`, `nanoid` from `@/lib/id` (all pre-existing).

- [ ] **Step 1: Write the failing test file**

Create `lib/__tests__/purchase-order-edit-items.test.ts`:

```ts
/**
 * Tests for lib/services/purchasing.ts — updateSentOrderItems (correcting the
 * items of a sent/supplier_confirmed OC) and the isOrderItemsEditable guard.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest"
import path from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

import {
  createOrder,
  issueOrder,
  markOrderSent,
  updateSentOrderItems,
  isOrderItemsEditable,
} from "@/lib/services/purchasing"

const now    = new Date().toISOString()
const userId = "u-edit"

describe("isOrderItemsEditable", () => {
  it("allows sent orders with no reception", () => {
    expect(isOrderItemsEditable("sent", 0)).toBe(true)
  })

  it("allows supplier_confirmed orders with no reception", () => {
    expect(isOrderItemsEditable("supplier_confirmed", 0)).toBe(true)
  })

  it("rejects orders outside sent/supplier_confirmed", () => {
    expect(isOrderItemsEditable("draft", 0)).toBe(false)
    expect(isOrderItemsEditable("closed", 0)).toBe(false)
  })

  it("rejects orders with any reception recorded", () => {
    expect(isOrderItemsEditable("sent", 1)).toBe(false)
  })
})

describe("updateSentOrderItems", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Editora", email: "editora@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-edit", name: "Faena Edit", code: "F-EDIT",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({
      id: "sup-edit", name: "Proveedor Edit", rut: "76.000.002-2",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-edit", name: "Cat Edit", slug: "cat-edit", sortOrder: 1,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-edit", sku: "P-EDIT-001", name: "Producto Edit",
      categoryId: "cat-edit", unitOfMeasure: "unidad", isActive: true,
      createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  async function createSentOrder(key: string, quantity: number, unitPrice: number) {
    const requestId     = `req-${key}`
    const requestItemId = `item-${key}`
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-${key}`, worksiteId: "ws-edit",
      requesterId: userId, requestType: "epp", urgency: "normal",
      status: "approved", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: requestItemId, requestId, productId: "prod-edit",
      quantity, unitOfMeasure: "unidad", status: "pending_purchase",
      createdAt: now, updatedAt: now,
    })
    const orderId = await createOrder({
      worksiteId: "ws-edit", supplierId: "sup-edit", createdBy: userId,
      items: [{
        requestItemId, productId: "prod-edit", productNameFree: null,
        quantity, unitOfMeasure: "unidad", unitPrice,
      }],
    })
    await issueOrder(orderId, userId)
    await markOrderSent(orderId, userId)
    return { orderId, requestItemId }
  }

  it("updates quantity and price of an existing item and recalculates totals", async () => {
    const { orderId } = await createSentOrder("qty-price", 5, 1000)
    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await updateSentOrderItems(orderId, [{
      id: existingItem!.id,
      productId: "prod-edit",
      productNameFree: null,
      quantity: 8,
      unitOfMeasure: "unidad",
      unitPrice: 1200,
    }], "Proveedor rechazó por cantidad incorrecta", userId)

    const updatedItem = await inMemoryDb.query.purchaseOrderItems.findFirst({
      where: eq(schema.purchaseOrderItems.id, existingItem!.id),
    })
    expect(updatedItem?.quantity).toBe(8)
    expect(updatedItem?.unitPrice).toBe(1200)
    expect(updatedItem?.subtotal).toBe(9600)

    const order = await inMemoryDb.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, orderId),
    })
    expect(order?.netAmount).toBe(9600)
    expect(order?.taxAmount).toBe(1824)
    expect(order?.totalAmount).toBe(11424)
  })

  it("removing an item linked to a request reverts it to pending_purchase", async () => {
    const requestId  = "req-remove"
    const keepItemId = "item-remove-keep"
    const dropItemId = "item-remove-drop"
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: "SOL-REMOVE", worksiteId: "ws-edit",
      requesterId: userId, requestType: "epp", urgency: "normal",
      status: "approved", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      { id: keepItemId, requestId, productId: "prod-edit", quantity: 2, unitOfMeasure: "unidad", status: "pending_purchase", createdAt: now, updatedAt: now },
      { id: dropItemId, requestId, productId: "prod-edit", quantity: 3, unitOfMeasure: "unidad", status: "pending_purchase", createdAt: now, updatedAt: now },
    ])
    const orderId = await createOrder({
      worksiteId: "ws-edit", supplierId: "sup-edit", createdBy: userId,
      items: [
        { requestItemId: keepItemId, productId: "prod-edit", productNameFree: null, quantity: 2, unitOfMeasure: "unidad", unitPrice: 1000 },
        { requestItemId: dropItemId, productId: "prod-edit", productNameFree: null, quantity: 3, unitOfMeasure: "unidad", unitPrice: 1000 },
      ],
    })
    await issueOrder(orderId, userId)
    await markOrderSent(orderId, userId)

    const orderItems = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })
    const keepOrderItem = orderItems.find((i) => i.requestItemId === keepItemId)!

    await updateSentOrderItems(orderId, [
      { id: keepOrderItem.id, productId: "prod-edit", productNameFree: null, quantity: 2, unitOfMeasure: "unidad", unitPrice: 1000 },
    ], "proveedor rechazó uno de los ítems", userId)

    const dropRequestItem = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, dropItemId),
    })
    expect(dropRequestItem?.status).toBe("pending_purchase")

    const remainingOrderItems = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })
    expect(remainingOrderItems).toHaveLength(1)
    expect(remainingOrderItems[0]?.id).toBe(keepOrderItem.id)
  })

  it("adds a new free-text item not linked to any request", async () => {
    const { orderId } = await createSentOrder("add-free", 2, 1500)
    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await updateSentOrderItems(orderId, [
      { id: existingItem!.id, productId: "prod-edit", productNameFree: null, quantity: 2, unitOfMeasure: "unidad", unitPrice: 1500 },
      { productId: null, productNameFree: "Repuesto urgente", quantity: 1, unitOfMeasure: "unidad", unitPrice: 3000 },
    ], "faltaba un repuesto en la OC original", userId)

    const items = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })
    const newItem = items.find((i) => i.productNameFree === "Repuesto urgente")
    expect(newItem).toBeDefined()
    expect(newItem?.requestItemId).toBeNull()
    expect(newItem?.status).toBe("issued")
    expect(newItem?.quantityReceived).toBe(0)
  })

  it("throws if the order is not in sent or supplier_confirmed status", async () => {
    const { orderId } = await createSentOrder("bad-status", 1, 1000)
    await inMemoryDb
      .update(schema.purchaseOrders)
      .set({ status: "draft" })
      .where(eq(schema.purchaseOrders.id, orderId))

    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await expect(
      updateSentOrderItems(orderId, [
        { id: existingItem!.id, productId: "prod-edit", productNameFree: null, quantity: 1, unitOfMeasure: "unidad", unitPrice: 1000 },
      ], "test", userId)
    ).rejects.toThrow("No se pueden editar")
  })

  it("throws if the order already has reception recorded", async () => {
    const { orderId } = await createSentOrder("has-reception", 4, 1000)
    await inMemoryDb
      .update(schema.purchaseOrderItems)
      .set({ quantityOfficeReceived: 2 })
      .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))

    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await expect(
      updateSentOrderItems(orderId, [
        { id: existingItem!.id, productId: "prod-edit", productNameFree: null, quantity: 4, unitOfMeasure: "unidad", unitPrice: 1000 },
      ], "test", userId)
    ).rejects.toThrow("No se pueden editar")
  })

  it("rejects orders outside the provided worksite scope", async () => {
    const { orderId } = await createSentOrder("scope", 1, 1000)
    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await expect(
      updateSentOrderItems(orderId, [
        { id: existingItem!.id, productId: "prod-edit", productNameFree: null, quantity: 1, unitOfMeasure: "unidad", unitPrice: 1000 },
      ], "test", userId, ["ws-other"])
    ).rejects.toThrow("No tienes acceso")
  })

  it("records an audit entry with the edit reason", async () => {
    const { orderId } = await createSentOrder("audit", 1, 1000)
    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await updateSentOrderItems(orderId, [
      { id: existingItem!.id, productId: "prod-edit", productNameFree: null, quantity: 1, unitOfMeasure: "unidad", unitPrice: 1000 },
    ], "corrección por rechazo del proveedor", userId)

    const auditRows = await inMemoryDb.query.auditLog.findMany({
      where: eq(schema.auditLog.entityId, orderId),
    })
    const updateEntry = auditRows.find((r) => r.action === "update")
    expect(updateEntry).toBeDefined()
    expect(updateEntry?.reason).toBe("corrección por rechazo del proveedor")
  })
})
```

- [ ] **Step 2: Register the new file as a PGlite test**

Edit `tests/pglite-files.ts`, add `"lib/__tests__/purchase-order-edit-items.test.ts"` to the `pgliteTestFiles` array (keep alphabetical position, after `"lib/__tests__/purchasing-service.test.ts"`).

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/purchase-order-edit-items.test.ts`
Expected: FAIL — `isOrderItemsEditable`/`updateSentOrderItems` are not exported from `@/lib/services/purchasing`.

- [ ] **Step 4: Add the pure guard to `purchasing.constants.ts`**

Replace the full contents of `lib/services/purchasing.constants.ts`:

```ts
export const DELETABLE_ORDER_STATUSES = ["draft", "issued", "sent"] as const
export type DeletableOrderStatus = typeof DELETABLE_ORDER_STATUSES[number]

export function isOrderDeletable(status: string): status is DeletableOrderStatus {
  return (DELETABLE_ORDER_STATUSES as readonly string[]).includes(status)
}

export const EDITABLE_ITEM_ORDER_STATUSES = ["sent", "supplier_confirmed"] as const
export type EditableItemOrderStatus = typeof EDITABLE_ITEM_ORDER_STATUSES[number]

/**
 * An OC's items can only be corrected while nothing has been received yet.
 * The status check alone is close to sufficient — registerReceipt() rolls the
 * order status forward off "sent"/"supplier_confirmed" the moment any item
 * gets a nonzero quantityOfficeReceived/quantityReceived — but totalReceived
 * is checked explicitly too, matching the "sin recepción" requirement literally.
 */
export function isOrderItemsEditable(status: string, totalReceived: number): boolean {
  return (EDITABLE_ITEM_ORDER_STATUSES as readonly string[]).includes(status) && totalReceived === 0
}
```

- [ ] **Step 5: Create the service file**

Create `lib/services/purchasing-module/purchase-orders-edit.ts`:

```ts
/**
 * Correct the items of a purchase order that's already sent/supplier_confirmed
 * (e.g. the supplier rejected it for a quantity/price error) without going
 * through anular + re-create.
 */

import { eq, and, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderItems, purchaseRequestItems } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { computeOrderTotals } from "@/lib/order-totals"
import { isOrderItemsEditable } from "@/lib/services/purchasing.constants"

export interface EditableOrderItemInput {
  id?:             string
  productId:       string | null
  productNameFree: string | null
  quantity:        number
  unitOfMeasure:   string
  unitPrice:       number
  discount?:       number
  notes?:          string | null
}

export async function updateSentOrderItems(
  orderId: string,
  items: EditableOrderItemInput[],
  reason: string,
  userId: string,
  worksiteIds: string[] | "all" = "all",
  opts?: { userEmail?: string },
): Promise<void> {
  if (items.length === 0) throw new Error("La orden debe tener al menos un ítem")

  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== "all" && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    const currentItems = await tx
      .select({
        id:                     purchaseOrderItems.id,
        requestItemId:          purchaseOrderItems.requestItemId,
        quantityReceived:       purchaseOrderItems.quantityReceived,
        quantityOfficeReceived: purchaseOrderItems.quantityOfficeReceived,
      })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const totalReceived = currentItems.reduce(
      (sum, i) => sum + i.quantityReceived + i.quantityOfficeReceived,
      0,
    )
    if (!isOrderItemsEditable(order.status, totalReceived)) {
      throw new Error(`No se pueden editar los ítems de una orden en estado '${order.status}'`)
    }

    const currentById = new Map(currentItems.map((i) => [i.id, i]))
    for (const item of items) {
      if (item.id && !currentById.has(item.id)) {
        throw new Error(`El ítem ${item.id} no pertenece a esta orden`)
      }
    }

    const incomingIds = new Set(items.flatMap((i) => (i.id ? [i.id] : [])))
    const removedItems = currentItems.filter((i) => !incomingIds.has(i.id))
    const removedRequestItemIds = removedItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)

    const now = new Date().toISOString()

    if (removedRequestItemIds.length > 0) {
      await tx
        .update(purchaseRequestItems)
        .set({ status: "pending_purchase", updatedAt: now })
        .where(
          and(
            inArray(purchaseRequestItems.id, removedRequestItemIds),
            inArray(purchaseRequestItems.status, ["in_purchase_order", "purchased"]),
          ),
        )
    }
    for (const removed of removedItems) {
      await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.id, removed.id))
    }

    for (const [i, item] of items.entries()) {
      const discount = item.discount ?? 0
      const subtotal = Math.round(item.quantity * item.unitPrice * (1 - discount / 100))

      if (item.id) {
        await tx
          .update(purchaseOrderItems)
          .set({
            productId:       item.productId,
            productNameFree: item.productNameFree,
            quantity:        item.quantity,
            unitOfMeasure:   item.unitOfMeasure,
            unitPrice:       item.unitPrice,
            discount,
            subtotal,
            notes:           item.notes ?? null,
            sortOrder:       i,
          })
          .where(eq(purchaseOrderItems.id, item.id))
      } else {
        await tx.insert(purchaseOrderItems).values({
          id:               nanoid(),
          purchaseOrderId:  orderId,
          requestItemId:    null,
          productId:        item.productId,
          productNameFree:  item.productNameFree,
          quantity:         item.quantity,
          unitOfMeasure:    item.unitOfMeasure,
          unitPrice:        item.unitPrice,
          discount,
          subtotal,
          quantityReceived: 0,
          status:           "issued",
          sortOrder:        i,
          notes:            item.notes ?? null,
        })
      }
    }

    const totals = computeOrderTotals(items)
    await tx
      .update(purchaseOrders)
      .set({
        netAmount:   totals.netAmount,
        taxAmount:   totals.taxAmount,
        totalAmount: totals.totalAmount,
        updatedAt:   now,
      })
      .where(eq(purchaseOrders.id, orderId))

    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "update",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { totalAmount: order.totalAmount, itemCount: currentItems.length },
      newState:   { totalAmount: totals.totalAmount, itemCount: items.length },
      reason,
    }, tx)
  })
}
```

- [ ] **Step 6: Wire the barrel export**

Edit `lib/services/purchasing-module/purchase-orders.ts` — replace the final export block:

```ts
export {
  DELETABLE_ORDER_STATUSES,
  isOrderDeletable,
} from "@/lib/services/purchasing.constants"
export type { DeletableOrderStatus } from "@/lib/services/purchasing.constants"
```

with:

```ts
export {
  DELETABLE_ORDER_STATUSES,
  isOrderDeletable,
  EDITABLE_ITEM_ORDER_STATUSES,
  isOrderItemsEditable,
} from "@/lib/services/purchasing.constants"
export type { DeletableOrderStatus, EditableItemOrderStatus } from "@/lib/services/purchasing.constants"

export {
  updateSentOrderItems,
} from "./purchase-orders-edit"
export type {
  EditableOrderItemInput,
} from "./purchase-orders-edit"
```

Also update the file's header comment (top of `purchase-orders.ts`) to mention the new sub-module, appending a line:
```
 *   - purchase-orders-edit      (updateSentOrderItems + types)
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run lib/__tests__/purchase-order-edit-items.test.ts`
Expected: PASS (11 tests: 4 for `isOrderItemsEditable`, 7 for `updateSentOrderItems`).

- [ ] **Step 8: Commit**

```bash
git add lib/services/purchasing.constants.ts lib/services/purchasing-module/purchase-orders-edit.ts lib/services/purchasing-module/purchase-orders.ts tests/pglite-files.ts lib/__tests__/purchase-order-edit-items.test.ts
git commit -m "feat(purchasing): add service to edit items of a sent/supplier_confirmed OC"
```

---

### Task 2: Permission + role grants

**Files:**
- Modify: `modules/purchasing/manifest.ts`

**Interfaces:**
- Produces: permission literal `"purchasing:edit_sent_order"`, now part of the derived `Permission` union type from `@/modules/permissions` — consumed by Task 3's `requirePermission("purchasing:edit_sent_order")` call.

- [ ] **Step 1: Add the permission, its metadata, and grants**

Replace the full contents of `modules/purchasing/manifest.ts`:

```ts
import type { ModuleManifest } from "@/modules/manifest-types"

export const purchasingModule = {
  id: "purchasing",
  permissions: [
    "purchasing:view",
    "purchasing:create_order",
    "purchasing:send_order",
    "purchasing:manage_suppliers",
    "purchasing:delete_order",
    "purchasing:edit_sent_order",
  ] as const,

  permissionMeta: {
    "purchasing:view":            { id: "p-pur-view",  description: "Ver módulo de órdenes de compra" },
    "purchasing:create_order":    { id: "p-pur-create", description: "Crear órdenes de compra" },
    "purchasing:send_order":      { id: "p-pur-send",  description: "Enviar OC a proveedor" },
    "purchasing:manage_suppliers": { id: "p-pur-sup",  description: "Administrar proveedores" },
    "purchasing:delete_order":    { id: "p-pur-delete", description: "Eliminar órdenes de compra no recibidas" },
    "purchasing:edit_sent_order": { id: "p-pur-editsent", description: "Editar ítems de una OC ya enviada" },
  },
  nav: [
    {
      areaId: "adquisiciones",
      items: [
        {
          label:       "Compras",
          href:        "/compras",
          iconName:    "ShoppingCart",
          permissions: ["purchasing:view", "purchasing:create_order"],
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",  permission: "purchasing:view" },
    { roleSlug: "administrador",  permission: "purchasing:create_order" },
    { roleSlug: "administrador",  permission: "purchasing:send_order" },
    { roleSlug: "administrador",  permission: "purchasing:manage_suppliers" },
    { roleSlug: "administrador",  permission: "purchasing:delete_order" },
    { roleSlug: "administrador",  permission: "purchasing:edit_sent_order" },
    { roleSlug: "jefa_chome",     permission: "purchasing:view" },
    { roleSlug: "jefa_chome",     permission: "purchasing:delete_order" },
    { roleSlug: "secretaria",     permission: "purchasing:view" },
    { roleSlug: "secretaria",     permission: "purchasing:create_order" },
    { roleSlug: "secretaria",     permission: "purchasing:send_order" },
    { roleSlug: "secretaria",     permission: "purchasing:manage_suppliers" },
    { roleSlug: "secretaria",     permission: "purchasing:delete_order" },
    { roleSlug: "secretaria",     permission: "purchasing:edit_sent_order" },
    { roleSlug: "jefe_mantencion", permission: "purchasing:view" },
    { roleSlug: "prevencionista", permission: "purchasing:view" },
    { roleSlug: "prevencionista", permission: "purchasing:edit_sent_order" },
  ],
} as const satisfies ModuleManifest
```

Note: `prevencionista` (Jefa Dpto. Prevención de riesgos, `rol-prev`) had **zero** purchasing permissions before this change — she also needs `purchasing:view` to reach `/compras` and `/compras/[id]` at all (both pages gate on `requirePermission("purchasing:view")`); without it, granting only `edit_sent_order` would be unreachable. This is a required prerequisite, not scope creep.

- [ ] **Step 2: Run the existing RBAC parity test to confirm no referential-integrity break**

Run: `npx vitest run lib/__tests__/auth-bootstrap-permissions.test.ts`
Expected: PASS — every grant still references an existing roleId/permissionId (both come from the same manifest source, so this can't fail from this change, but confirms nothing else was disturbed).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (confirms `"purchasing:edit_sent_order"` is now a valid `Permission` literal wherever it's used).

- [ ] **Step 4: Commit**

```bash
git add modules/purchasing/manifest.ts
git commit -m "feat(purchasing): add purchasing:edit_sent_order permission and role grants"
```

---

### Task 3: Zod schema + Server Action

**Files:**
- Modify: `lib/validation/operations.ts`
- Create: `app/(app)/compras/actions/edit-items.ts`
- Modify: `app/(app)/compras/actions/index.ts`
- Create: `lib/__tests__/edit-order-items-action.test.ts`

**Interfaces:**
- Consumes: `updateSentOrderItems` and `EditableOrderItemInput` from `@/lib/services/purchasing` (Task 1); `"purchasing:edit_sent_order"` permission (Task 2); `assertOrderAccess` from `../actions.helpers`; `dbErrMsg`, `serviceWorksiteScope` from `./helpers`; `REVALIDATE` from `./revalidate`.
- Produces: `editSentOrderItemsAction(_prev: ActionState, formData: FormData): Promise<ActionState>` exported from `@/app/(app)/compras/actions` — consumed by Task 4's UI form. Expected `FormData` fields: `orderId`, `reason`, `itemsJson` (JSON array of `{ id?, productId, productNameFree, quantity, unitOfMeasure, unitPrice, discount?, notes? }`).

- [ ] **Step 1: Write the failing action test**

Create `lib/__tests__/edit-order-items-action.test.ts`:

```ts
/**
 * Unit tests for editSentOrderItemsAction — access control, validation, and execution.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"
import { editSentOrderItemsAction } from "@/app/(app)/compras/actions"

const mockState = vi.hoisted(() => ({
  orderResult: undefined as { id: string; code: string; worksiteId: string; status: string } | undefined,
}))

const mockAuthFn = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))

vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseOrders: {
        findFirst: vi.fn(() => mockState.orderResult),
      },
    },
  },
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }),
}))

const mockUpdateSentOrderItems = vi.hoisted(() => vi.fn())
vi.mock("@/lib/services/purchasing", () => ({
  updateSentOrderItems: mockUpdateSentOrderItems,
}))

function buildFormData(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.append(key, value)
  return fd
}

const validItemsJson = JSON.stringify([
  { id: "oi-1", productId: "prod-1", productNameFree: null, quantity: 2, unitOfMeasure: "unidad", unitPrice: 1000, discount: 0, notes: null },
])

describe("editSentOrderItemsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.orderResult = undefined
  })

  it("returns error if user lacks permission", async () => {
    mockAuthFn.mockResolvedValueOnce(null)

    const formData = buildFormData({ orderId: "oc-123", reason: "motivo", itemsJson: validItemsJson })
    const res = await editSentOrderItemsAction({ ok: false, message: "" }, formData)

    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
    expect(mockUpdateSentOrderItems).not.toHaveBeenCalled()
  })

  it("returns error if orderId is missing", async () => {
    mockAuthFn.mockResolvedValueOnce({
      user: { id: "usr-1", permissions: ["purchasing:edit_sent_order"] },
    } as Session)

    const formData = buildFormData({ reason: "motivo", itemsJson: validItemsJson })
    const res = await editSentOrderItemsAction({ ok: false, message: "" }, formData)

    expect(res.ok).toBe(false)
    expect(res.message).toBe("Orden no especificada")
  })

  it("returns error if order is not found", async () => {
    mockAuthFn.mockResolvedValueOnce({
      user: { id: "usr-1", permissions: ["purchasing:edit_sent_order"] },
    } as Session)
    mockState.orderResult = undefined

    const formData = buildFormData({ orderId: "oc-missing", reason: "motivo", itemsJson: validItemsJson })
    const res = await editSentOrderItemsAction({ ok: false, message: "" }, formData)

    expect(res.ok).toBe(false)
    expect(res.message).toBe("Orden no encontrada")
  })

  it("returns error if user has no access to the worksite", async () => {
    mockAuthFn.mockResolvedValueOnce({
      user: { id: "usr-1", permissions: ["purchasing:edit_sent_order"], worksiteIds: ["ws-allowed"] },
    } as unknown as Session)
    mockState.orderResult = { id: "oc-123", code: "OC-2026-0001", worksiteId: "ws-restricted", status: "sent" }

    const formData = buildFormData({ orderId: "oc-123", reason: "motivo", itemsJson: validItemsJson })
    const res = await editSentOrderItemsAction({ ok: false, message: "" }, formData)

    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes acceso")
  })

  it("returns validation error if reason is missing", async () => {
    mockAuthFn.mockResolvedValueOnce({
      user: { id: "usr-1", permissions: ["purchasing:edit_sent_order"], worksiteIds: ["ws-1"] },
    } as unknown as Session)
    mockState.orderResult = { id: "oc-123", code: "OC-2026-0001", worksiteId: "ws-1", status: "sent" }

    const formData = buildFormData({ orderId: "oc-123", reason: "", itemsJson: validItemsJson })
    const res = await editSentOrderItemsAction({ ok: false, message: "" }, formData)

    expect(res.ok).toBe(false)
    expect(mockUpdateSentOrderItems).not.toHaveBeenCalled()
  })

  it("returns validation error if itemsJson is malformed", async () => {
    mockAuthFn.mockResolvedValueOnce({
      user: { id: "usr-1", permissions: ["purchasing:edit_sent_order"], worksiteIds: ["ws-1"] },
    } as unknown as Session)
    mockState.orderResult = { id: "oc-123", code: "OC-2026-0001", worksiteId: "ws-1", status: "sent" }

    const formData = buildFormData({ orderId: "oc-123", reason: "motivo", itemsJson: "{not json" })
    const res = await editSentOrderItemsAction({ ok: false, message: "" }, formData)

    expect(res.ok).toBe(false)
    expect(res.message).toBe("Error al procesar los ítems")
  })

  it("calls updateSentOrderItems and redirects on success", async () => {
    mockAuthFn.mockResolvedValueOnce({
      user: { id: "usr-1", email: "editora@chome.cl", permissions: ["purchasing:edit_sent_order"], worksiteIds: ["ws-1"] },
    } as unknown as Session)
    mockState.orderResult = { id: "oc-123", code: "OC-2026-0001", worksiteId: "ws-1", status: "sent" }

    const formData = buildFormData({ orderId: "oc-123", reason: "proveedor rechazó por error", itemsJson: validItemsJson })

    await expect(editSentOrderItemsAction({ ok: false, message: "" }, formData)).rejects.toThrow("NEXT_REDIRECT")

    expect(mockUpdateSentOrderItems).toHaveBeenCalledWith(
      "oc-123",
      expect.arrayContaining([expect.objectContaining({ id: "oi-1", quantity: 2 })]),
      "proveedor rechazó por error",
      "usr-1",
      ["ws-1"],
      { userEmail: "editora@chome.cl" },
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/edit-order-items-action.test.ts`
Expected: FAIL — `editSentOrderItemsAction` is not exported from `@/app/(app)/compras/actions`.

- [ ] **Step 3: Add the Zod schema**

Edit `lib/validation/operations.ts` — insert immediately after the `CreateOrderItemFormData` type export (after the line `export type CreateOrderItemFormData = z.infer<typeof createOrderItemSchema>`, before the `// ── Receipt` section comment):

```ts

// ── Purchase order — edit items on a sent/supplier_confirmed order ───────────
export const updateOrderItemsItemSchema = z.object({
  id:              z.string().optional(),
  productId:       z.string().nullable().optional(),
  productNameFree: z.string().nullable().optional(),
  quantity:        positiveQuantitySchema,
  unitOfMeasure:   z.string().min(1, "Unidad requerida").max(20),
  unitPrice:       finiteMoneySchema,
  discount:        z.coerce.number().refine(Number.isFinite, "Descuento inválido").min(0).max(100).default(0),
  notes:           z.string().max(300).nullable().optional().or(z.literal("")),
}).refine(
  (d) => !!d.productId || !!d.productNameFree?.trim(),
  { message: "Selecciona un producto del catálogo o describe el ítem", path: ["productId"] },
)

export const updateOrderItemsSchema = z.object({
  reason: z.string().min(1, "El motivo de edición es obligatorio").max(500),
  items:  z.array(updateOrderItemsItemSchema).min(1, "La orden debe tener al menos un ítem"),
})

export type UpdateOrderItemsFormData     = z.infer<typeof updateOrderItemsSchema>
export type UpdateOrderItemsItemFormData = z.infer<typeof updateOrderItemsItemSchema>
```

- [ ] **Step 4: Create the Server Action**

Create `app/(app)/compras/actions/edit-items.ts`:

```ts
"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { updateSentOrderItems } from "@/lib/services/purchasing"
import { logger } from "@/lib/logger"
import { updateOrderItemsSchema, type ActionState } from "@/lib/validation/operations"
import { assertOrderAccess } from "../actions.helpers"
import { dbErrMsg, serviceWorksiteScope } from "./helpers"
import { REVALIDATE } from "./revalidate"

export async function editSentOrderItemsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:edit_sent_order")
  } catch {
    return { ok: false, message: "Sin permisos para editar ítems de esta orden" }
  }

  const orderId = formData.get("orderId") as string | null
  if (!orderId) return { ok: false, message: "Orden no especificada" }
  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  let itemsRaw: unknown[] = []
  try {
    itemsRaw = JSON.parse((formData.get("itemsJson") as string) ?? "[]")
  } catch {
    return { ok: false, message: "Error al procesar los ítems", fieldErrors: { items: ["Formato de ítems inválido"] } }
  }

  const parsed = updateOrderItemsSchema.safeParse({
    reason: formData.get("reason"),
    items:  itemsRaw,
  })
  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    return {
      ok: false,
      message: "Revisa los datos de la orden",
      fieldErrors: {
        ...flattened.fieldErrors,
        items: flattened.fieldErrors.items ?? flattened.formErrors,
      },
    }
  }

  try {
    await updateSentOrderItems(
      orderId,
      parsed.data.items,
      parsed.data.reason,
      session.user.id,
      serviceWorksiteScope(session),
      { userEmail: session.user.email ?? undefined },
    )
  } catch (e) {
    logger.error("[editSentOrderItemsAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al editar los ítems de la orden") }
  }

  revalidatePath(REVALIDATE)
  revalidatePath(`/compras/${orderId}`)
  redirect(`/compras/${orderId}?actualizada=items`)
}
```

- [ ] **Step 5: Export the action from the barrel**

Edit `app/(app)/compras/actions/index.ts`, add after the `// ── Item state` block:

```ts

// ── Item edits on a sent/supplier_confirmed order ───────────────────────────
export { editSentOrderItemsAction } from "./edit-items"
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run lib/__tests__/edit-order-items-action.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/validation/operations.ts app/\(app\)/compras/actions/edit-items.ts app/\(app\)/compras/actions/index.ts lib/__tests__/edit-order-items-action.test.ts
git commit -m "feat(purchasing): add editSentOrderItemsAction server action"
```

---

### Task 4: `/compras/[id]/editar` route (types + form + page)

**Files:**
- Create: `app/(app)/compras/[id]/editar/edit-oc-items.types.ts`
- Create: `app/(app)/compras/[id]/editar/edit-oc-items-form.tsx`
- Create: `app/(app)/compras/[id]/editar/page.tsx`

**Interfaces:**
- Consumes: `editSentOrderItemsAction` from `@/app/(app)/compras/actions` (Task 3); `isOrderItemsEditable` from `@/lib/services/purchasing` (Task 1); `ProductPicker` component and `ProductOption` type from `@/app/(app)/solicitudes/product-picker` / `@/app/(app)/solicitudes/request-form.types` (pre-existing); `computeOrderTotals` from `@/lib/order-totals`; `formatCLP` from `@/lib/utils`.
- Produces: `EditOcItemRow` type, `<EditOcItemsForm orderId products initialItems />` component, page at route `/compras/[id]/editar` — consumed by Task 5's link from `oc-actions.tsx`.

- [ ] **Step 1: Create the row type**

Create `app/(app)/compras/[id]/editar/edit-oc-items.types.ts`:

```ts
export interface EditOcItemRow {
  id?:             string
  productId:       string | null
  productNameFree: string | null
  displayName:     string
  productSku:      string | null
  quantity:        number
  unitOfMeasure:   string
  unitPrice:       number
  discount:        number
  notes:           string
}
```

- [ ] **Step 2: Create the client form component**

Create `app/(app)/compras/[id]/editar/edit-oc-items-form.tsx`:

```tsx
"use client"

import * as React from "react"
import { useActionState } from "react"
import Link from "next/link"
import { Trash, Warning } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SubmitButton } from "@/components/admin/submit-button"
import { ProductPicker } from "@/app/(app)/solicitudes/product-picker"
import { computeOrderTotals } from "@/lib/order-totals"
import { formatCLP } from "@/lib/utils"
import { editSentOrderItemsAction } from "@/app/(app)/compras/actions"
import type { ActionState } from "@/lib/validation/operations"
import type { ProductOption } from "@/app/(app)/solicitudes/request-form.types"
import type { EditOcItemRow } from "./edit-oc-items.types"

let rowKeySeq = 0
function nextRowKey() {
  rowKeySeq += 1
  return `row-${rowKeySeq}`
}

interface RowState extends EditOcItemRow {
  _key: string
}

export function EditOcItemsForm({
  orderId,
  initialItems,
  products,
}: {
  orderId:      string
  initialItems: EditOcItemRow[]
  products:     ProductOption[]
}) {
  const [rows, setRows] = React.useState<RowState[]>(
    () => initialItems.map((item) => ({ ...item, _key: nextRowKey() })),
  )
  const [reason, setReason] = React.useState("")
  const [state, action] = useActionState<ActionState, FormData>(editSentOrderItemsAction, INITIAL_STATE)

  React.useEffect(() => {
    if (!state.ok && state.message && state !== INITIAL_STATE) toast.error(state.message)
  }, [state])

  function updateRow(key: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((row) => (row._key === key ? { ...row, ...patch } : row)))
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row._key !== key) : prev))
  }

  function addProduct(productId: string) {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    setRows((prev) => [...prev, {
      _key:            nextRowKey(),
      id:              undefined,
      productId:       product.id,
      productNameFree: null,
      displayName:     product.name,
      productSku:      product.sku,
      quantity:        1,
      unitOfMeasure:   product.unitOfMeasure,
      unitPrice:       product.referencePrice ?? 0,
      discount:        0,
      notes:           "",
    }])
  }

  function addFreeText(name: string) {
    setRows((prev) => [...prev, {
      _key:            nextRowKey(),
      id:              undefined,
      productId:       null,
      productNameFree: name,
      displayName:     name,
      productSku:      null,
      quantity:        1,
      unitOfMeasure:   "unidad",
      unitPrice:       0,
      discount:        0,
      notes:           "",
    }])
  }

  const totals = computeOrderTotals(rows)
  const itemsJson = JSON.stringify(rows.map((row) => ({
    id:              row.id,
    productId:       row.productId,
    productNameFree: row.productNameFree,
    quantity:        row.quantity,
    unitOfMeasure:   row.unitOfMeasure,
    unitPrice:       row.unitPrice,
    discount:        row.discount,
    notes:           row.notes || null,
  })))

  return (
    <form action={action} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="itemsJson" value={itemsJson} />

      <div className="space-y-6">
        <div className="border border-[var(--color-border)] rounded-[var(--radius)] divide-y divide-[var(--color-border)] overflow-hidden">
          {rows.map((row) => {
            const subtotal = row.quantity * row.unitPrice * (1 - row.discount / 100)
            return (
              <div key={row._key} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {row.productSku && (
                      <span className="font-mono text-[11px] text-[var(--color-text-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">
                        {row.productSku}
                      </span>
                    )}
                    <span className="text-sm font-medium text-[var(--color-text)]">{row.displayName}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Field label="Cantidad" htmlFor={`qty-${row._key}`}>
                      <Input
                        id={`qty-${row._key}`}
                        type="number" min="0.01" step="any"
                        value={row.quantity}
                        onChange={(e) => updateRow(row._key, { quantity: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-sm tabular-nums"
                      />
                    </Field>
                    <Field label="Precio unit." htmlFor={`price-${row._key}`}>
                      <Input
                        id={`price-${row._key}`}
                        type="number" min="0" step="1"
                        value={row.unitPrice}
                        onChange={(e) => updateRow(row._key, { unitPrice: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-sm tabular-nums"
                      />
                    </Field>
                    <Field label="Desc. %" htmlFor={`disc-${row._key}`}>
                      <Input
                        id={`disc-${row._key}`}
                        type="number" min="0" max="100" step="0.1"
                        value={row.discount}
                        onChange={(e) => updateRow(row._key, { discount: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-sm tabular-nums"
                      />
                    </Field>
                    <div className="flex flex-col gap-1 justify-end text-right">
                      <span className="text-[10px] text-[var(--color-text-subtle)]">Subtotal</span>
                      <span className="text-sm tabular-nums font-medium text-[var(--color-text)]">{formatCLP(subtotal)}</span>
                    </div>
                  </div>
                  <div className="mt-2">
                    <Field label="Notas" htmlFor={`notes-${row._key}`}>
                      <Input
                        id={`notes-${row._key}`}
                        value={row.notes}
                        onChange={(e) => updateRow(row._key, { notes: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="Observación opcional"
                      />
                    </Field>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(row._key)}
                  disabled={rows.length <= 1}
                  className="mt-0.5 p-1 rounded text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-2)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={`Quitar ${row.displayName}`}
                >
                  <Trash size={14} />
                </button>
              </div>
            )
          })}
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Agregar ítem</h2>
          <ProductPicker
            products={products}
            onSelectProduct={addProduct}
            onSelectFreeText={addFreeText}
          />
        </div>

        <Field label="Motivo de la edición" required htmlFor="editReason">
          <Textarea
            id="editReason"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ej: proveedor rechazó la OC por error de cantidad en el ítem X..."
            required
          />
        </Field>

        {!state.ok && state.message && state !== INITIAL_STATE && (
          <p className="text-sm text-[var(--color-danger)] flex items-center gap-1.5">
            <Warning size={14} /> {state.message}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--color-border)]">
          <Link href={`/compras/${orderId}`} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            Cancelar
          </Link>
          <SubmitButton
            label="Guardar cambios"
            loadingLabel="Guardando..."
            variant="primary"
            disabled={rows.length === 0 || !reason.trim()}
          />
        </div>
      </div>

      <aside className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 h-fit space-y-2 text-sm">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Totales</h2>
        <div className="flex items-center justify-between text-[var(--color-text-muted)]">
          <span>Neto</span><span className="font-mono tabular-nums">{formatCLP(totals.netAmount)}</span>
        </div>
        <div className="flex items-center justify-between text-[var(--color-text-subtle)]">
          <span>IVA (19%)</span><span className="font-mono tabular-nums">{formatCLP(totals.taxAmount)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-2 font-semibold text-[var(--color-text)]">
          <span>Total</span><span className="font-mono tabular-nums">{formatCLP(totals.totalAmount)}</span>
        </div>
      </aside>
    </form>
  )
}
```

- [ ] **Step 3: Create the server page**

Create `app/(app)/compras/[id]/editar/page.tsx`:

```tsx
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { purchaseOrders, products } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { isOrderItemsEditable } from "@/lib/services/purchasing"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EditOcItemsForm } from "./edit-oc-items-form"
import type { EditOcItemRow } from "./edit-oc-items.types"
import type { ProductOption } from "@/app/(app)/solicitudes/request-form.types"

export const metadata: Metadata = { title: "Editar ítems de OC" }

export default async function EditarOcPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("purchasing:edit_sent_order") }
  catch { redirect("/forbidden") }

  const { id } = await params

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    with: { items: { orderBy: (i, { asc }) => [asc(i.sortOrder)] } },
  })
  if (!order) notFound()
  if (!canAccessWorksite(session, order.worksiteId)) notFound()

  const totalReceived = order.items.reduce(
    (sum, i) => sum + (i.quantityOfficeReceived ?? 0) + (i.quantityReceived ?? 0),
    0,
  )
  if (!isOrderItemsEditable(order.status, totalReceived)) redirect(`/compras/${id}`)

  const productIds = order.items
    .map((i) => i.productId)
    .filter((pid): pid is string => pid !== null)

  const [productRowsForItems, allProducts] = await Promise.all([
    productIds.length > 0
      ? db.query.products.findMany({
          where: (p, { inArray }) => inArray(p.id, productIds),
          columns: { id: true, sku: true, name: true },
        })
      : Promise.resolve([]),
    db
      .select({
        id: products.id, sku: products.sku, name: products.name,
        unitOfMeasure: products.unitOfMeasure, referencePrice: products.referencePrice,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name)),
  ])

  const productMap = Object.fromEntries(productRowsForItems.map((p) => [p.id, p]))

  const initialItems: EditOcItemRow[] = order.items.map((item) => {
    const product = item.productId ? productMap[item.productId] : null
    return {
      id:              item.id,
      productId:       item.productId,
      productNameFree: item.productNameFree,
      displayName:     product?.name ?? item.productNameFree ?? "(sin nombre)",
      productSku:      product?.sku ?? null,
      quantity:        item.quantity,
      unitOfMeasure:   item.unitOfMeasure,
      unitPrice:       item.unitPrice,
      discount:        item.discount,
      notes:           item.notes ?? "",
    }
  })

  const productOptions: ProductOption[] = allProducts.map((p) => ({
    id:                   p.id,
    sku:                  p.sku,
    name:                 p.name,
    isEpp:                false,
    unitOfMeasure:        p.unitOfMeasure,
    categoryName:         "",
    referencePrice:       p.referencePrice,
    preferredSupplierId:  null,
    attributes:           [],
  }))

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`Editar ítems — ${order.code}`}
        description="Corrige cantidades, precios o ítems de esta orden ya enviada."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Órdenes de compra", href: "/compras" },
            { label: order.code, href: `/compras/${order.id}` },
            { label: "Editar ítems" },
          ]} />
        }
      />
      <EditOcItemsForm orderId={order.id} initialItems={initialItems} products={productOptions} />
    </PageContainer>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no new errors (existing warnings elsewhere in the repo are pre-existing and unrelated).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/compras/[id]/editar/"
git commit -m "feat(purchasing): add /compras/[id]/editar route to correct sent OC items"
```

---

### Task 5: Wire the entry point (button + detail page guard)

**Files:**
- Modify: `app/(app)/compras/[id]/oc-actions.tsx`
- Modify: `app/(app)/compras/[id]/page.tsx`

**Interfaces:**
- Consumes: `isOrderItemsEditable` from `@/lib/services/purchasing` (Task 1).
- Produces: `<OcActions ... canEditItems={boolean} />` — a "Editar ítems" link visible only when the order is in `sent`/`supplier_confirmed`, has zero reception, and the current user has `purchasing:edit_sent_order`.

- [ ] **Step 1: Add the `canEditItems` prop and button to `oc-actions.tsx`**

Edit `app/(app)/compras/[id]/oc-actions.tsx`. Add the `Link` import — change:
```tsx
import { issueOrderAction, sendOrderAction, cancelOrderAction, confirmOrderAction, closeOrderAction, deleteOrderAction } from "../actions"
```
to:
```tsx
import Link from "next/link"
import { issueOrderAction, sendOrderAction, cancelOrderAction, confirmOrderAction, closeOrderAction, deleteOrderAction } from "../actions"
```

Add `canEditItems` to the props destructure and type — change:
```tsx
export function OcActions({
  orderId,
  orderCode,
  status,
  canManage,
  canSend,
  canDelete = false,
}: {
  orderId:    string
  orderCode:  string
  status:     string
  canManage:  boolean
  canSend:    boolean
  canDelete?: boolean
}) {
```
to:
```tsx
export function OcActions({
  orderId,
  orderCode,
  status,
  canManage,
  canSend,
  canDelete = false,
  canEditItems = false,
}: {
  orderId:       string
  orderCode:     string
  status:        string
  canManage:     boolean
  canSend:       boolean
  canDelete?:    boolean
  canEditItems?: boolean
}) {
```

Add the button in the main action bar. Find this exact block:

```tsx
      {/* sent → supplier_confirmed */}
      {status === "sent" && canManage && (
        <form action={confirmAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <SubmitButton label="Confirmar proveedor" loadingLabel="Confirmando..." variant="secondary" />
        </form>
      )}

      {/* supplier_confirmed / partially_received / received → closed */}
```

and replace it with:

```tsx
      {/* sent → supplier_confirmed */}
      {status === "sent" && canManage && (
        <form action={confirmAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <SubmitButton label="Confirmar proveedor" loadingLabel="Confirmando..." variant="secondary" />
        </form>
      )}

      {/* Editar ítems — canEditItems already encodes status (sent/supplier_confirmed)
          + zero-reception guard, computed server-side in page.tsx */}
      {canEditItems && (
        <Link
          href={`/compras/${orderId}/editar`}
          className="text-xs font-medium text-(--color-text) border border-(--color-border) hover:bg-surface-2 px-3.5 py-2 rounded-(--radius) transition-colors"
        >
          Editar ítems
        </Link>
      )}

      {/* supplier_confirmed / partially_received / received → closed */}
```

- [ ] **Step 2: Compute and pass `canEditItems` in `page.tsx`**

Edit `app/(app)/compras/[id]/page.tsx`. Add the import — change:
```tsx
import { getOcReconciliation } from "@/lib/services/oc-reconciliation"
```
to:
```tsx
import { getOcReconciliation } from "@/lib/services/oc-reconciliation"
import { isOrderItemsEditable } from "@/lib/services/purchasing"
```

Replace the `canShowOrderActions` block:
```tsx
  const canShowOrderActions =
    (order.status === "draft" && (canManage || canDeleteOrder)) ||
    (order.status === "issued" && (canManage || canSend || canDeleteOrder)) ||
    (order.status === "sent" && (canManage || canDeleteOrder)) ||
    (order.status === "supplier_confirmed" && canManage) ||
    (order.status === "partially_received" && canManage) ||
    (order.status === "received" && canManage)
```
with:
```tsx
  const totalReceivedForEditGuard = order.items.reduce(
    (total, item) => total + (item.quantityOfficeReceived ?? 0) + (item.quantityReceived ?? 0),
    0,
  )
  const canEditItems =
    session.user.permissions.includes("purchasing:edit_sent_order") &&
    isOrderItemsEditable(order.status, totalReceivedForEditGuard)

  const canShowOrderActions =
    (order.status === "draft" && (canManage || canDeleteOrder)) ||
    (order.status === "issued" && (canManage || canSend || canDeleteOrder)) ||
    (order.status === "sent" && (canManage || canDeleteOrder || canEditItems)) ||
    (order.status === "supplier_confirmed" && (canManage || canEditItems)) ||
    (order.status === "partially_received" && canManage) ||
    (order.status === "received" && canManage)
```

Pass the prop to `<OcActions>` — change:
```tsx
              <OcActions
                orderId={order.id}
                orderCode={order.code}
                status={order.status}
                canManage={canManage}
                canSend={canSend}
                canDelete={canDeleteOrder}
              />
```
to:
```tsx
              <OcActions
                orderId={order.id}
                orderCode={order.code}
                status={order.status}
                canManage={canManage}
                canSend={canSend}
                canDelete={canDeleteOrder}
                canEditItems={canEditItems}
              />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/compras/[id]/oc-actions.tsx" "app/(app)/compras/[id]/page.tsx"
git commit -m "feat(purchasing): surface 'Editar ítems' action on sent/supplier_confirmed OCs"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS, no regressions. Pay particular attention to `lib/__tests__/purchase-order-edit-items.test.ts`, `lib/__tests__/edit-order-items-action.test.ts`, `lib/__tests__/auth-bootstrap-permissions.test.ts`, `lib/__tests__/purchasing-service.test.ts`, `lib/__tests__/cancel-order-action.test.ts`, `lib/__tests__/create-order-action.test.ts`.

- [ ] **Step 2: Typecheck and lint the whole repo**

Run: `npm run typecheck && npm run lint`
Expected: no errors (pre-existing warnings unrelated to this change are fine).

- [ ] **Step 3: Sync RBAC on the local dev DB**

Run: `npm run db:sync-rbac`
Expected: "RBAC del sistema sincronizado (roles, permisos y grants)." — this actually grants `purchasing:edit_sent_order` (and, for prevencionista, `purchasing:view`) to real users in the local dev DB, needed for step 4.

- [ ] **Step 4: Manual browser walkthrough**

Start the dev server and, as a user with the `secretaria` or `administrador` role:
1. Open an OC in `sent` status (or send one via the existing flow) at `/compras/[id]`.
2. Confirm the "Editar ítems" button is visible in the Acciones card.
3. Click it, land on `/compras/[id]/editar`, confirm existing items are pre-populated with correct quantity/price/discount.
4. Edit an existing item's quantity and price, confirm the totals panel updates live.
5. Use the product picker to add a new free-text line, confirm it appears with quantity 1.
6. Remove an item (confirm the trash button disables when only one item remains).
7. Try submitting with an empty motivo — confirm the submit button stays disabled / the form doesn't submit.
8. Fill in a motivo and submit — confirm redirect to `/compras/[id]` and that the item list, totals, and (if inspecting the DB) the `audit_log` row reflect the change.
9. As a user WITHOUT `purchasing:edit_sent_order` (e.g. a `jefe_mantencion`), confirm the "Editar ítems" button does not appear and navigating directly to `/compras/[id]/editar` redirects to `/forbidden`.
10. On an order with `office_received`/`partially_received` status, confirm the button does not appear (reception already started).

Report any deviation before considering the feature done.
