# Modo de despacho en aprobación (vía oficina / directo a faena) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let approver roles (secretaría/jefatura/admin) choose, per request in `/aprobaciones`, whether goods ship `via_oficina` (current two-stage flow) or `directo_faena` (skip the office checkpoint), and have that choice flow into the OC and the receiving logic.

**Architecture:** A new `delivery_mode` column on `purchase_requests` (chosen at approval) is snapshot-copied onto `purchase_orders` at OC creation. The DB check constraint that forced `quantityReceived ≤ quantityOfficeReceived` is relaxed to independent bounds; office-before-faena becomes an application rule applied only when `delivery_mode = via_oficina`. The receiving service and UI branch on the OC's `delivery_mode`.

**Tech Stack:** Next.js (custom fork — read `node_modules/next/dist/docs/` before touching framework APIs), Drizzle ORM + drizzle-kit migrations, PostgreSQL, Vitest + PGlite for DB-backed tests.

## Global Constraints

- **Never hand-edit `db/migrations/meta/_journal.json`.** Let `drizzle-kit generate` produce timestamps.
- **Never edit an already-created migration `.sql`.** Only the migration you generate in Task 1 may be appended to (custom SQL, idempotent, separated by `--> statement-breakpoint`).
- Use `npm run db:generate` to create migrations; after generating, re-run it and confirm it reports **"No schema changes"**.
- Enum values are exactly `'via_oficina'` and `'directo_faena'`. Default is `'via_oficina'` everywhere.
- All business-logic changes go in `lib/` + `app/`. Do not touch `core/` or `modules/*/{services,actions,schema}`.
- Test runner: `npx vitest run <path>`. Do not add new test frameworks.
- Spec: `docs/superpowers/specs/2026-07-05-modo-despacho-aprobacion-design.md`.

---

## File Structure

- `db/schema/requests.ts` — add `deliveryMode` column + `purchase_requests_delivery_mode_valid` check on `purchaseRequests`.
- `db/schema/purchasing.ts` — add `deliveryMode` column + `purchase_orders_delivery_mode_valid` check on `purchaseOrders`; relax `purchase_order_items_numeric_integrity`.
- `db/migrations/00XX_*.sql` (generated) — the single migration for all schema changes.
- `lib/services/receiving.ts` — branch guard, `remaining`, and `rollupOrderReceiptStatus` on `delivery_mode`.
- `lib/services/purchasing-module/purchase-orders.ts` — thread `deliveryMode` into OC insert.
- `app/(app)/compras/actions.ts` — mixing guard + pass `deliveryMode` to `createOrdersBySupplier`.
- `app/(app)/aprobaciones/actions.ts` — new `updateDeliveryModeAction`.
- `app/(app)/aprobaciones/types.ts` — add `deliveryMode` to `ApprovalRequest`.
- `app/(app)/aprobaciones/page.tsx` — select + thread `deliveryMode`.
- `app/(app)/aprobaciones/request-group.tsx` — delivery-mode selector UI.
- `app/(app)/recepcion/nueva/page.tsx` — gate `canOffice`, pass `deliveryMode`.
- `app/(app)/recepcion/receipt-form.tsx` — `deliveryMode` prop + `getRemaining` branch.
- Tests: `lib/__tests__/receiving-two-stage.test.ts`, `lib/__tests__/aprobaciones-actions.test.ts`, `lib/__tests__/compras-actions-extra.test.ts`, `app/(app)/recepcion/receipt-form.test.tsx`.

---

## Task 1: Schema columns + relaxed constraint + migration

**Files:**
- Modify: `db/schema/requests.ts:28-34` (add column) and `db/schema/requests.ts:34-47` (add check)
- Modify: `db/schema/purchasing.ts:34-37` (add column), `db/schema/purchasing.ts:38-55` (add check), `db/schema/purchasing.ts:81-91` (relax check)
- Create: `db/migrations/00XX_*.sql` + `db/migrations/meta/00XX_snapshot.json` (generated)

**Interfaces:**
- Produces: `purchaseRequests.deliveryMode` and `purchaseOrders.deliveryMode` columns, both `text NOT NULL DEFAULT 'via_oficina'`, values in `('via_oficina','directo_faena')`. Relaxed `purchase_order_items_numeric_integrity` no longer cross-checks `quantityReceived ≤ quantityOfficeReceived`.

- [ ] **Step 1: Add `deliveryMode` to `purchaseRequests`**

In `db/schema/requests.ts`, inside the `purchaseRequests` column object (right after the `notes:` line at 31), add:

```ts
  deliveryMode: text("delivery_mode").notNull().default("via_oficina"), // via_oficina | directo_faena
```

Then, in the same table's constraints array (the `(table) => [ ... ]` block starting at line 34), add a new check right after the existing `purchase_requests_type_urgency_status_valid` check (after line 43):

```ts
  check("purchase_requests_delivery_mode_valid", sql`
    ${table.deliveryMode} IN ('via_oficina', 'directo_faena')
  `),
```

- [ ] **Step 2: Add `deliveryMode` to `purchaseOrders`**

In `db/schema/purchasing.ts`, inside the `purchaseOrders` column object right after `supplierNotes:` (line 35), add:

```ts
  deliveryMode:      text("delivery_mode").notNull().default("via_oficina"), // via_oficina | directo_faena — snapshot from request
```

Then in that table's constraints array (starting line 38), after the `purchase_orders_amounts_non_negative` check (after line 51), add:

```ts
  check("purchase_orders_delivery_mode_valid", sql`
    ${table.deliveryMode} IN ('via_oficina', 'directo_faena')
  `),
```

- [ ] **Step 3: Relax `purchase_order_items_numeric_integrity`**

In `db/schema/purchasing.ts`, in the `purchaseOrderItems` check at lines 81-91, change ONLY the final cross-check line. Replace:

```ts
    AND ${table.quantityReceived} <= ${table.quantityOfficeReceived}
```

with:

```ts
    AND ${table.quantityReceived} <= ${table.quantity}
```

Leave every other line of that check untouched.

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new `db/migrations/00XX_*.sql` appears (00XX = next number, likely `0023`) and `_journal.json` gains one entry. Do NOT edit the journal by hand.

- [ ] **Step 5: Verify the generated SQL covers all three changes**

Run: `git status --porcelain db/migrations` then open the new `.sql`.
Expected to contain (names exact):
- `ALTER TABLE "purchase_requests" ADD COLUMN "delivery_mode" text DEFAULT 'via_oficina' NOT NULL;`
- `ALTER TABLE "purchase_orders" ADD COLUMN "delivery_mode" text DEFAULT 'via_oficina' NOT NULL;`
- `ADD CONSTRAINT "purchase_requests_delivery_mode_valid" ...`
- `ADD CONSTRAINT "purchase_orders_delivery_mode_valid" ...`
- A DROP + ADD of `purchase_order_items_numeric_integrity`.

**If the DROP/ADD of `purchase_order_items_numeric_integrity` is missing** (drizzle-kit sometimes fails to detect changed check *expressions*), append it to the end of the same generated `.sql` (this is the one migration you may append to), separated by a breakpoint:

```sql
--> statement-breakpoint
ALTER TABLE "purchase_order_items" DROP CONSTRAINT IF EXISTS "purchase_order_items_numeric_integrity";--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_numeric_integrity" CHECK (
  "purchase_order_items"."quantity" > 0
  AND "purchase_order_items"."unit_price" >= 0
  AND "purchase_order_items"."discount" >= 0
  AND "purchase_order_items"."discount" <= 100
  AND "purchase_order_items"."subtotal" >= 0
  AND "purchase_order_items"."quantity_office_received" >= 0
  AND "purchase_order_items"."quantity_received" >= 0
  AND "purchase_order_items"."quantity_office_received" <= "purchase_order_items"."quantity"
  AND "purchase_order_items"."quantity_received" <= "purchase_order_items"."quantity"
);
```

- [ ] **Step 6: Confirm no drift**

Run: `npm run db:generate`
Expected: `No schema changes, nothing to generate`.

- [ ] **Step 7: Confirm existing DB-backed tests still migrate + pass**

Run: `npx vitest run lib/__tests__/receiving-two-stage.test.ts`
Expected: PASS (the relaxed constraint does not change `via_oficina` behavior).

- [ ] **Step 8: Commit**

```bash
git add db/schema/requests.ts db/schema/purchasing.ts db/migrations
git commit -m "feat(db): add delivery_mode to requests/orders, relax OC item constraint"
```

---

## Task 2: Receiving service branches on `delivery_mode`

**Files:**
- Modify: `lib/services/receiving.ts:70-72` (guard), `:107-114` (remaining), `:168` (rollup call), `:195-234` (rollup fn)
- Test: `lib/__tests__/receiving-two-stage.test.ts`

**Interfaces:**
- Consumes: `order.deliveryMode` (from Task 1) — `order` is already loaded at `receiving.ts:60-62`.
- Produces: `directo_faena` OCs accept `stage:"faena"` directly from `sent`; reject `stage:"office"`; status rolls `sent → partially_received → received` off `quantityReceived` alone.

- [ ] **Step 1: Add failing tests for direct-to-faena**

In `lib/__tests__/receiving-two-stage.test.ts`, change the `makeOrder` helper (line 59) signature to accept a mode, and pass it into the OC insert. Replace lines 59-76 with:

```ts
async function makeOrder(
  quantities: number[],
  deliveryMode: "via_oficina" | "directo_faena" = "via_oficina",
): Promise<{ orderId: string; itemIds: string[] }> {
  const orderId = `oc-${++ocCounter}`
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.purchaseOrders).values({
    id: orderId, code: `OC-TEST-${ocCounter}`, worksiteId: WS_ID, supplierId: SUP_ID,
    createdBy: USER_ID, status: "sent", deliveryMode, createdAt: now, updatedAt: now,
  })
  const itemIds: string[] = []
  for (let i = 0; i < quantities.length; i++) {
    const id = nanoid()
    itemIds.push(id)
    await inMemoryDb.insert(schema.purchaseOrderItems).values({
      id, purchaseOrderId: orderId, quantity: quantities[i]!, unitOfMeasure: "unidad", sortOrder: i,
    })
  }
  return { orderId, itemIds }
}
```

Then add a new describe block at the end of the file (after line 179):

```ts
describe("direct-to-faena receiving", () => {
  it("faena reception on a 'sent' directo_faena OC is accepted (no office needed)", async () => {
    const { orderId, itemIds } = await makeOrder([10], "directo_faena")
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 4 }],
    })
    expect(await status(orderId)).toBe("partially_received")
  })

  it("full faena reception on directo_faena → received", async () => {
    const { orderId, itemIds } = await makeOrder([10], "directo_faena")
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 }],
    })
    expect(await status(orderId)).toBe("received")
  })

  it("faena reception caps at ordered quantity (not at office)", async () => {
    const { orderId, itemIds } = await makeOrder([10], "directo_faena")
    await expect(registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 11 }],
    })).rejects.toThrow(/exceeds pending/i)
  })

  it("office reception on a directo_faena OC is rejected", async () => {
    const { orderId, itemIds } = await makeOrder([10], "directo_faena")
    await expect(registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 5 }],
    })).rejects.toThrow(/directo a faena/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/receiving-two-stage.test.ts -t "direct-to-faena"`
Expected: FAIL — the `sent` directo_faena faena reception throws the office-first error; office reception is not yet rejected.

- [ ] **Step 3: Update the stage guard**

In `lib/services/receiving.ts`, replace lines 70-72:

```ts
    if (input.stage === "faena" && order.status === "sent") {
      throw new Error("Debes registrar primero la llegada a oficina antes de recibir en faena")
    }
```

with:

```ts
    const directFaena = order.deliveryMode === "directo_faena"
    if (directFaena && input.stage === "office") {
      throw new Error("Esta OC es de despacho directo a faena; no registra llegada a oficina")
    }
    if (!directFaena && input.stage === "faena" && order.status === "sent") {
      throw new Error("Debes registrar primero la llegada a oficina antes de recibir en faena")
    }
```

- [ ] **Step 4: Update the `remaining` calculation**

In `lib/services/receiving.ts`, replace the `remaining` assignment at lines 112-114:

```ts
      const remaining = input.stage === "office"
        ? lockedOcItem.quantity - (lockedOcItem.quantityOfficeReceived ?? 0)
        : (lockedOcItem.quantityOfficeReceived ?? 0) - (lockedOcItem.quantityReceived ?? 0)
```

with:

```ts
      const remaining = input.stage === "office"
        ? lockedOcItem.quantity - (lockedOcItem.quantityOfficeReceived ?? 0)
        : directFaena
          ? lockedOcItem.quantity - (lockedOcItem.quantityReceived ?? 0)
          : (lockedOcItem.quantityOfficeReceived ?? 0) - (lockedOcItem.quantityReceived ?? 0)
```

(`directFaena` is now in scope from Step 3.)

- [ ] **Step 5: Pass `delivery_mode` into the rollup**

In `lib/services/receiving.ts` at line 168, replace:

```ts
    await rollupOrderReceiptStatus(input.purchaseOrderId, tx)
```

with:

```ts
    await rollupOrderReceiptStatus(input.purchaseOrderId, tx, order.deliveryMode)
```

- [ ] **Step 6: Branch the rollup on `delivery_mode`**

In `lib/services/receiving.ts`, replace the `rollupOrderReceiptStatus` signature and status-decision block (lines 195-223) so it takes `deliveryMode` and short-circuits for direct faena. Change the signature (lines 195-198):

```ts
async function rollupOrderReceiptStatus(
  orderId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  deliveryMode: string,
): Promise<void> {
```

Then replace the decision block at lines 210-223:

```ts
  const allFaena  = ocItems.every((i) => (i.quantityReceived       ?? 0) >= i.quantity)
  const anyFaena  = ocItems.some( (i) => (i.quantityReceived       ?? 0) > 0)

  let newStatus: string
  if (deliveryMode === "directo_faena") {
    // Direct-to-faena OCs never pass through the office checkpoint; status is
    // derived purely from faena-received quantities.
    if (allFaena)      newStatus = "received"
    else if (anyFaena) newStatus = "partially_received"
    else return
  } else {
    const allOffice = ocItems.every((i) => (i.quantityOfficeReceived ?? 0) >= i.quantity)
    const anyOffice = ocItems.some( (i) => (i.quantityOfficeReceived ?? 0) > 0)
    if (allFaena)        newStatus = "received"
    else if (anyFaena)   newStatus = "partially_received"
    else if (allOffice)  newStatus = "office_received"
    else if (anyOffice)  newStatus = "partially_office_received"
    else return
  }
```

(Delete the old `allOffice`/`anyOffice` declarations at lines 215-216 and the old `if/else` chain at 218-223 — they are replaced by the block above.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/receiving-two-stage.test.ts`
Expected: PASS (both the new `direct-to-faena` block and all pre-existing `via_oficina` tests).

- [ ] **Step 8: Commit**

```bash
git add lib/services/receiving.ts lib/__tests__/receiving-two-stage.test.ts
git commit -m "feat(receiving): honor directo_faena delivery mode (skip office stage)"
```

---

## Task 3: Propagate `delivery_mode` onto the OC at creation

**Files:**
- Modify: `lib/services/purchasing-module/purchase-orders.ts:41-60` (input types), `:64-79` (createOrder wrapper), `:109-125` (OC insert)
- Modify: `app/(app)/compras/actions.ts:98-114` (mixing guard), `:146-168` (pass mode)
- Test: `lib/__tests__/compras-actions-extra.test.ts`

**Interfaces:**
- Consumes: `dbItem.request.deliveryMode` (loaded via `with: { request: true }` at `actions.ts:90-93`).
- Produces: `createOrdersBySupplier` accepts optional `deliveryMode?: "via_oficina" | "directo_faena"` (default `"via_oficina"`) and stamps it on every OC it inserts.

- [ ] **Step 1: Add failing test for the mixing guard**

In `lib/__tests__/compras-actions-extra.test.ts`, add a test that drives `createOrderAction` with two request items whose parent requests have different `deliveryMode`. First confirm the file imports `createOrderAction` (add to the existing import from `@/app/(app)/compras/actions` if absent). Then add:

```ts
describe("createOrderAction delivery-mode mixing guard", () => {
  beforeEach(() => {
    mockRequirePermission.mockResolvedValue({
      user: { id: "u1", email: "a@b.cl", roles: ["administrador"], worksiteIds: ["ws-1"] },
    })
    mockCanAccessWorksite.mockReturnValue(true)
  })

  it("rejects an OC mixing via_oficina and directo_faena items", async () => {
    const { db } = await import("@/db")
    ;(db.query.purchaseRequestItems.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "ri-1", status: "approved", quantity: 2, unitOfMeasure: "unidad",
        request: { worksiteId: "ws-1", deliveryMode: "via_oficina" } },
      { id: "ri-2", status: "approved", quantity: 2, unitOfMeasure: "unidad",
        request: { worksiteId: "ws-1", deliveryMode: "directo_faena" } },
    ])

    const fd = new FormData()
    fd.set("worksiteId", "ws-1")
    fd.set("supplierId", "sup-1")
    fd.set("itemsJson", JSON.stringify([
      { requestItemId: "ri-1", quantity: 2, unitOfMeasure: "unidad", unitPrice: 100, supplierId: "sup-1" },
      { requestItemId: "ri-2", quantity: 2, unitOfMeasure: "unidad", unitPrice: 100, supplierId: "sup-1" },
    ]))

    const res = await createOrderAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/modo de despacho distinto/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/compras-actions-extra.test.ts -t "mixing guard"`
Expected: FAIL — no guard exists yet, so it proceeds past the check.

- [ ] **Step 3: Add the mixing guard in the action**

In `app/(app)/compras/actions.ts`, immediately after the per-item validation loop (after line 114, before the `supplierIdsByItem` block at line 116), add:

```ts
  const deliveryModes = new Set(dbItems.map((i) => i.request.deliveryMode))
  if (deliveryModes.size > 1) {
    return { ok: false, message: "Los ítems seleccionados pertenecen a solicitudes con modo de despacho distinto. Crea órdenes separadas." }
  }
  const deliveryMode = deliveryModes.values().next().value ?? "via_oficina"
```

- [ ] **Step 4: Thread `deliveryMode` into the service input types**

In `lib/services/purchasing-module/purchase-orders.ts`, add to `CreateOrderInput` (after line 49, before `items:`):

```ts
  deliveryMode?:      "via_oficina" | "directo_faena"
```

`CreateOrdersBySupplierInput` extends `CreateOrderInput` (Omit of supplierId/items) at line 58, so it inherits `deliveryMode` automatically — no separate edit needed.

- [ ] **Step 5: Pass `deliveryMode` through `createOrder` wrapper**

In `lib/services/purchasing-module/purchase-orders.ts`, in the `createOrder` wrapper's `createOrdersBySupplier` call (after line 72 `notes:`), add:

```ts
    deliveryMode:       input.deliveryMode,
```

- [ ] **Step 6: Stamp `deliveryMode` on the OC insert**

In `lib/services/purchasing-module/purchase-orders.ts`, in the `tx.insert(purchaseOrders).values({...})` at lines 109-125, after the `status: "draft",` line (line 115), add:

```ts
        deliveryMode:      input.deliveryMode ?? "via_oficina",
```

- [ ] **Step 7: Pass the mode from the action to the service**

In `app/(app)/compras/actions.ts`, in the `createOrdersBySupplier({...})` call, after the `notes: notes || null,` line (line 153), add:

```ts
      deliveryMode,
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/compras-actions-extra.test.ts lib/__tests__/purchasing-service.test.ts lib/__tests__/create-order-action.test.ts`
Expected: PASS (new guard test + existing purchasing tests unaffected by the optional field).

- [ ] **Step 9: Commit**

```bash
git add lib/services/purchasing-module/purchase-orders.ts "app/(app)/compras/actions.ts" lib/__tests__/compras-actions-extra.test.ts
git commit -m "feat(compras): snapshot delivery_mode onto OC, reject mixed-mode orders"
```

---

## Task 4: `updateDeliveryModeAction` server action

**Files:**
- Modify: `app/(app)/aprobaciones/actions.ts:1-25` (imports + role set), append new action at end
- Test: `lib/__tests__/aprobaciones-actions.test.ts`

**Interfaces:**
- Produces: `updateDeliveryModeAction(_prev: ActionState, formData: FormData): Promise<ActionState>`. Reads `requestId` and `mode` from the form. Gated to roles `administrador | jefa_chome | secretaria` and `canAccessWorksite`. Persists `purchase_requests.delivery_mode`. Does NOT write `approvalDecisions`.

- [ ] **Step 1: Add failing tests**

In `lib/__tests__/aprobaciones-actions.test.ts`, extend the `@/db` mock to expose `purchaseRequests.findFirst` and `db.update`. In the `vi.mock("@/db", ...)` block, change it to:

```ts
const mockFindFirstRequest = vi.hoisted(() => vi.fn())
const mockDbUpdate = vi.hoisted(() => vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })))

vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseRequestItems: { findFirst: mockFindFirstItem },
      purchaseRequests: { findFirst: mockFindFirstRequest },
    },
    update: mockDbUpdate,
  },
}))
```

Add `updateDeliveryModeAction` to the import from `@/app/(app)/aprobaciones/actions`. Then add:

```ts
describe("updateDeliveryModeAction", () => {
  beforeEach(() => {
    mockRequirePermission.mockResolvedValue(makeSession())
    mockCanAccessWorksite.mockReturnValue(true)
    mockFindFirstRequest.mockResolvedValue({ id: "req-1", worksiteId: "ws-1" })
    mockDbUpdate.mockClear()
  })

  it("persists directo_faena for an approver role", async () => {
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("mode", "directo_faena")
    const res = await updateDeliveryModeAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockDbUpdate).toHaveBeenCalled()
  })

  it("rejects an invalid mode", async () => {
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("mode", "bogus")
    const res = await updateDeliveryModeAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it("rejects a non-dispatch role (e.g. prevencionista only)", async () => {
    mockRequirePermission.mockResolvedValue(makeSession({ roles: ["prevencionista"] }))
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("mode", "directo_faena")
    const res = await updateDeliveryModeAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/aprobaciones-actions.test.ts -t "updateDeliveryModeAction"`
Expected: FAIL — `updateDeliveryModeAction` is not exported.

- [ ] **Step 3: Implement the action**

In `app/(app)/aprobaciones/actions.ts`, update the imports at the top: change line 6 to also import `purchaseRequests`:

```ts
import { purchaseRequestItems, purchaseRequests } from "@/db/schema"
```

Add a role set constant near line 17 (after `EPP_APPROVER_ROLES`):

```ts
// Delivery mode (dispatch route) is a logistics call: secretaría / jefatura / admin only.
const DISPATCH_DECIDER_ROLES = new Set(["administrador", "jefa_chome", "secretaria"])
```

Append this action at the end of the file:

```ts
// ── Set delivery mode (dispatch route) on a request ───────────────────────────

export async function updateDeliveryModeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("approvals:approve") }
  catch { return { ok: false, message: "Sin permisos" } }

  if (!session.user.roles.some((r) => DISPATCH_DECIDER_ROLES.has(r))) {
    return { ok: false, message: "Solo Secretaría o Jefatura pueden definir el modo de despacho" }
  }

  const requestId = formData.get("requestId") as string | null
  const mode      = formData.get("mode") as string | null
  if (!requestId) return { ok: false, message: "Solicitud no especificada" }
  if (mode !== "via_oficina" && mode !== "directo_faena") {
    return { ok: false, message: "Modo de despacho inválido" }
  }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
    columns: { id: true, worksiteId: true },
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }

  await db.update(purchaseRequests).set({ deliveryMode: mode }).where(eq(purchaseRequests.id, requestId))
  revalidatePath(REVALIDATE)
  return {
    ok: true,
    message: mode === "directo_faena" ? "Despacho directo a faena" : "Despacho vía oficina",
  }
}
```

(`eq` is already imported at line 4; `canAccessWorksite`, `requirePermission`, `revalidatePath`, `db`, `REVALIDATE`, `ActionState` are all already in scope.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/aprobaciones-actions.test.ts`
Expected: PASS (new block + all pre-existing approval-action tests).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/aprobaciones/actions.ts" lib/__tests__/aprobaciones-actions.test.ts
git commit -m "feat(aprobaciones): add updateDeliveryModeAction (dispatch-role gated)"
```

---

## Task 5: Delivery-mode selector in the approval UI

**Files:**
- Modify: `app/(app)/aprobaciones/types.ts:53-63` (`ApprovalRequest`)
- Modify: `app/(app)/aprobaciones/page.tsx:85-94` (select column), `:232-242` (map field)
- Modify: `app/(app)/aprobaciones/request-group.tsx` (selector UI)

**Interfaces:**
- Consumes: `updateDeliveryModeAction` (Task 4), `request.deliveryMode`, `canApproveEpp` prop (already passed to `RequestGroup`; for these routes it equals the dispatch-decider set `administrador|jefa_chome|secretaria`, see `page.tsx:271`).
- Produces: `ApprovalRequest.deliveryMode: "via_oficina" | "directo_faena"`.

- [ ] **Step 1: Add `deliveryMode` to the type**

In `app/(app)/aprobaciones/types.ts`, in the `ApprovalRequest` interface (lines 53-63), after `submittedAt: string | null` (line 60), add:

```ts
  deliveryMode:    "via_oficina" | "directo_faena"
```

- [ ] **Step 2: Select the column in the page query**

In `app/(app)/aprobaciones/page.tsx`, in the `visible` select object (lines 85-94), after `submittedAt: purchaseRequests.submittedAt,` (line 93), add:

```ts
      deliveryMode: purchaseRequests.deliveryMode,
```

- [ ] **Step 3: Map it into the row**

In `app/(app)/aprobaciones/page.tsx`, in the returned `ApprovalRequest` object (lines 232-242), after `submittedAt: r.submittedAt,` (line 239), add:

```ts
        deliveryMode:   r.deliveryMode,
```

- [ ] **Step 4: Add the selector to `RequestGroup`**

In `app/(app)/aprobaciones/request-group.tsx`:

Add imports at the top (after line 11):

```ts
import { useActionState } from "react"
import { updateDeliveryModeAction } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"
```

Inside the component body (after line 15, `const { bulkState, bulkAction } = useBulkApproveAction()`), add:

```ts
  const [modeState, modeAction] = useActionState(updateDeliveryModeAction, INITIAL_STATE)
```

Then surface a failed change with a toast (import `toast` from `@/lib/toast` at the top — per the repo convention, never from sonner). After the `modeAction` hook line, add:

```ts
  React.useEffect(() => {
    if (modeState.message && !modeState.ok) toast.error(modeState.message)
  }, [modeState])
```

Then, inside the right-hand controls `<div className="flex items-center gap-2 shrink-0">` (opening at line 46), before the `{!allApproved && canApproveThisRequest && (` block (line 59), insert the selector — only for dispatch-authority users (`canApproveEpp`, which on these routes is exactly the dispatch-decider set). The select is uncontrolled with `defaultValue={request.deliveryMode}`; after a successful change `updateDeliveryModeAction` calls `revalidatePath("/aprobaciones")`, so the server component re-renders `RequestGroup` with the updated `request.deliveryMode` and the default resets on its own — no client message-parsing needed:

```tsx
          {canApproveEpp && (
            <form action={modeAction} className="flex items-center gap-1">
              <input type="hidden" name="requestId" value={request.id} />
              <label className="sr-only" htmlFor={`mode-${request.id}`}>Modo de despacho</label>
              <select
                id={`mode-${request.id}`}
                name="mode"
                defaultValue={request.deliveryMode}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)]"
              >
                <option value="via_oficina">Vía oficina</option>
                <option value="directo_faena">Directo a faena</option>
              </select>
            </form>
          )}
```

- [ ] **Step 5: Lint the touched files**

Run: `npx eslint "app/(app)/aprobaciones/types.ts" "app/(app)/aprobaciones/page.tsx" "app/(app)/aprobaciones/request-group.tsx"`
Expected: no errors.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors related to these files (`deliveryMode` present on `ApprovalRequest`, action import resolves).

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/aprobaciones/types.ts" "app/(app)/aprobaciones/page.tsx" "app/(app)/aprobaciones/request-group.tsx"
git commit -m "feat(aprobaciones): delivery-mode selector on request card"
```

---

## Task 6: Receiving UI respects `delivery_mode`

**Files:**
- Modify: `app/(app)/recepcion/nueva/page.tsx:27-28` (gate canOffice), `:88-95` (pass prop)
- Modify: `app/(app)/recepcion/receipt-form.tsx:118-138` (prop + getRemaining)
- Test: `app/(app)/recepcion/receipt-form.test.tsx`

**Interfaces:**
- Consumes: `order.deliveryMode` (Task 1), `ReceiptForm` props.
- Produces: `ReceiptForm` accepts `deliveryMode: "via_oficina" | "directo_faena"`; for `directo_faena` the office button is not rendered (caller passes `canOffice={false}`) and faena `getRemaining` caps at `quantity - quantityReceived`.

- [ ] **Step 1: Add failing test**

In `app/(app)/recepcion/receipt-form.test.tsx`, add a test in the `describe("stage selection", ...)` block (near line 117):

```ts
    it("directo_faena OC does not render the office option and starts in faena", () => {
      const { container, queryByText } = render(
        <ReceiptForm
          purchaseOrderId="oc-1"
          orderCode="OC-1"
          orderWorksiteName="Faena X"
          items={[{ id: "i1", requestItemId: "ri1", productName: "P", productSku: null,
                    quantity: 10, quantityOfficeReceived: 0, quantityReceived: 0,
                    unitOfMeasure: "unidad", notes: null }]}
          canOffice={false}
          canFaena={true}
          deliveryMode="directo_faena"
        />,
      )
      expect(queryByText(/Recepción en oficina/i)).toBeNull()
      const stageInput = container.querySelector('input[name="stage"]') as HTMLInputElement
      expect(stageInput.value).toBe("faena")
    })
```

(If the existing tests don't yet pass `deliveryMode`, that's fine — Step 3 makes it optional-with-default so they keep compiling.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(app)/recepcion/receipt-form.test.tsx" -t "directo_faena"`
Expected: FAIL — `ReceiptForm` doesn't accept `deliveryMode` and faena `getRemaining` still reads `quantityOfficeReceived` (0), so nothing is receivable.

- [ ] **Step 3: Add the prop and branch `getRemaining`**

In `app/(app)/recepcion/receipt-form.tsx`, add `deliveryMode` to the props destructure and type (lines 118-132). Change the signature block:

```ts
export function ReceiptForm({
  purchaseOrderId,
  orderCode,
  orderWorksiteName,
  items,
  canOffice,
  canFaena,
  deliveryMode = "via_oficina",
}: {
  purchaseOrderId: string
  orderCode:       string
  orderWorksiteName: string
  items:           ReceiptOcItem[]
  canOffice:       boolean
  canFaena:        boolean
  deliveryMode?:   "via_oficina" | "directo_faena"
}) {
```

Then change `getRemaining` (lines 133-138) so the faena cap ignores the office checkpoint in direct mode:

```ts
  const getRemaining = React.useCallback((item: ReceiptOcItem, stage: ReceiptStage) => {
    if (stage === "office") return Math.max(0, item.quantity - item.quantityOfficeReceived)
    // Direct-to-faena: cap at the ordered quantity (goods never pass through office).
    if (deliveryMode === "directo_faena") return Math.max(0, item.quantity - item.quantityReceived)
    // Via-oficina: faena caps STRICTLY at what already arrived at office.
    return Math.max(0, item.quantityOfficeReceived - item.quantityReceived)
  }, [deliveryMode])
```

(The office `<button>` is already gated by `canOffice &&` at line 199, and `TwoStageProgress` already hides itself when `!canOffice` — no further JSX change needed once the caller passes `canOffice={false}`.)

- [ ] **Step 4: Gate `canOffice` and pass the prop from the page**

In `app/(app)/recepcion/nueva/page.tsx`, replace line 27:

```ts
  const canOffice = can(session, "receiving:register_office")
```

with (note: `order` is loaded below, so compute the effective value after `order` exists — move the gating next to the render). Keep line 27 as the raw permission, and change the `<ReceiptForm .../>` call (lines 88-95) to:

```tsx
      <ReceiptForm
        purchaseOrderId={order.id}
        orderCode={order.code}
        orderWorksiteName={order.worksite?.name ?? "faena de la OC"}
        items={items}
        canOffice={canOffice && order.deliveryMode !== "directo_faena"}
        canFaena={canFaena}
        deliveryMode={order.deliveryMode}
      />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run "app/(app)/recepcion/receipt-form.test.tsx"`
Expected: PASS (new directo_faena test + all existing receipt-form tests).

- [ ] **Step 6: Lint + typecheck**

Run: `npx eslint "app/(app)/recepcion/nueva/page.tsx" "app/(app)/recepcion/receipt-form.tsx"` and `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/recepcion/nueva/page.tsx" "app/(app)/recepcion/receipt-form.tsx" "app/(app)/recepcion/receipt-form.test.tsx"
git commit -m "feat(recepcion): hide office stage + cap faena at ordered qty for directo_faena"
```

---

## Final verification

- [ ] **Run the full affected suite**

Run: `npx vitest run lib/__tests__/receiving-two-stage.test.ts lib/__tests__/aprobaciones-actions.test.ts lib/__tests__/compras-actions-extra.test.ts "app/(app)/recepcion/receipt-form.test.tsx" lib/__tests__/purchasing-service.test.ts`
Expected: all PASS.

- [ ] **Lint the whole change**

Run: `npm run lint`
Expected: no new errors (a pre-existing warning in `app/(public)/ppa/ppa-form.tsx` is unrelated).

- [ ] **Confirm no migration drift**

Run: `npm run db:generate`
Expected: `No schema changes, nothing to generate`.

---

## Self-Review notes (coverage vs spec)

- Spec "Modelo de datos" (2 columns + relaxed constraint) → Task 1.
- Spec "Flujo de aprobación" (selector gated to dispatch roles + `updateDeliveryModeAction`) → Tasks 4 (action) + 5 (UI). Role set narrowed to `administrador|jefa_chome|secretaria` (matches `canApproveEpp` prop already on the card and "secretaria decide"; prevencionista excluded — logistics is not their call). Spec's broader `EPP_APPROVER_ROLES` phrasing superseded by this narrower, more correct gate.
- Spec "Creación de OC" (mixing guard + snapshot copy) → Task 3.
- Spec "Recepción" service (guard/remaining/rollup) → Task 2.
- Spec "UI de recepción" (hide office, faena cap) → Task 6.
- Spec "Testing" bullets → tests embedded in Tasks 2, 3, 4, 6.
