import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = db
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
const { loadInvoiceLineAllocationsTx, replaceInvoiceLineAllocationsTx } = await import("@/lib/services/purchasing-module/invoice-line-allocations")

async function fixture(id: string, creditNote = false) {
  await db.insert(schema.purchaseOrders).values({ id, code: `QA-${id}`, worksiteId: "ws-alloc", supplierId: "sup-alloc", createdBy: "user-alloc" })
  await db.insert(schema.purchaseOrderItems).values(["a", "b"].map(suffix => ({ id: `${id}-${suffix}`, purchaseOrderId: id, productNameFree: "QA allocations", quantity: 10, unitOfMeasure: "unidad" })))
  await db.insert(schema.purchaseOrderInvoices).values({ id: `${id}-invoice`, purchaseOrderId: id, invoiceNumber: `QA-${id}`, documentKind: creditNote ? "credit_note" : "invoice", amount: creditNote ? -100_000 : 100_000, fileName: "QA.pdf", filePath: "QA.pdf", uploadedBy: "user-alloc" })
  await db.insert(schema.purchaseOrderInvoiceItems).values({ id: `${id}-line`, invoiceId: `${id}-invoice`, purchaseOrderItemId: `${id}-a`, productName: "QA allocation line", quantity: creditNote ? -10 : 10, subtotal: creditNote ? -100_000 : 100_000, unitPrice: 10_000, unitOfMeasure: "unidad" })
  const scope = { purchaseOrderId: id, invoiceItemId: `${id}-line`, worksiteScope: ["ws-alloc"] }
  const evidence = await db.transaction(tx => loadInvoiceLineAllocationsTx(tx, scope))
  return { ...scope, expectedFingerprint: evidence.fingerprint, actor: { userId: "user-alloc", userEmail: "qa-alloc@test.local" }, source: "operator" as const, coverage: "complete" as const, allocations: [
    { purchaseOrderItemId: `${id}-b`, quantity: creditNote ? -4 : 4, subtotal: creditNote ? -40_000 : 40_000 },
    { purchaseOrderItemId: `${id}-a`, quantity: creditNote ? -6 : 6, subtotal: creditNote ? -60_000 : 60_000 },
  ] }
}
const read = (input: Awaited<ReturnType<typeof fixture>>) => db.transaction(tx => loadInvoiceLineAllocationsTx(tx, input))
const replace = (input: Parameters<typeof replaceInvoiceLineAllocationsTx>[1]) => db.transaction(tx => replaceInvoiceLineAllocationsTx(tx, input))
const audit = (invoiceItemId: string) => db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, invoiceItemId))

describe("invoice line allocation transactions", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await db.insert(schema.users).values({ id: "user-alloc", name: "QA allocations", email: "qa-alloc@test.local", hashedPassword: "hash" })
    await db.insert(schema.worksites).values({ id: "ws-alloc", name: "QA allocations", code: "QA-ALLOC" })
    await db.insert(schema.suppliers).values({ id: "sup-alloc", name: "QA allocations" })
  })
  afterAll(async () => { await pg.close() })

  it("persists canonical 6 + 4, clears legacy FK, and audits old/new arrays", async () => {
    const input = await fixture("split")
    const result = await replace(input)
    expect(result.allocations.map(row => row.quantity)).toEqual([6, 4])
    expect(result.legacyPurchaseOrderItemId).toBeNull()
    expect(result.fingerprint).not.toBe(input.expectedFingerprint)
    expect(await read(input)).toEqual(result)
    const [entry] = await audit(input.invoiceItemId)
    expect(entry).toMatchObject({ entityType: "purchase_order_invoice_item_allocation", action: "update", userId: "user-alloc" })
    expect(JSON.parse(entry!.oldState!)).toMatchObject({ allocations: [], legacyPurchaseOrderItemId: "split-a" })
    expect(JSON.parse(entry!.newState!).allocations).toMatchObject([{ purchaseOrderItemId: "split-a", quantity: 6 }, { purchaseOrderItemId: "split-b", quantity: 4 }])
  })
  it("mirrors only one complete allocation; partial and cleared sets null the FK", async () => {
    const input = await fixture("mirror")
    const one = [{ purchaseOrderItemId: "mirror-a", quantity: 10, subtotal: 100_000 }]
    const complete = await replace({ ...input, allocations: one })
    expect(complete.legacyPurchaseOrderItemId).toBe("mirror-a")
    const partial = await replace({ ...input, allocations: one, coverage: "partial", expectedFingerprint: complete.fingerprint })
    expect(partial.legacyPurchaseOrderItemId).toBeNull()
    const cleared = await replace({ ...input, allocations: [], coverage: "partial", expectedFingerprint: partial.fingerprint })
    expect(cleared.allocations).toEqual([])
    expect(cleared.legacyPurchaseOrderItemId).toBeNull()
    const [line] = await db.select().from(schema.purchaseOrderInvoiceItems).where(eq(schema.purchaseOrderInvoiceItems.id, input.invoiceItemId))
    expect(line!.purchaseOrderItemId).toBeNull()
  })
  it("keeps negative NC portions and allows deliberate partial coverage", async () => {
    const input = await fixture("credit", true)
    const result = await replace({ ...input, coverage: "partial", allocations: [input.allocations[1]!] })
    expect(result.allocations).toMatchObject([{ quantity: -6, subtotal: -60_000 }])
    expect(result.legacyPurchaseOrderItemId).toBeNull()
  })
  it.each([{ worksiteScope: [] }, { worksiteScope: ["other"] }])("rejects out-of-scope reads and writes $worksiteScope", async ({ worksiteScope }) => {
    const input = await fixture(`scope-${worksiteScope.length}`)
    await expect(replace({ ...input, worksiteScope })).rejects.toMatchObject({ code: "OUT_OF_SCOPE" })
    await expect(db.transaction(tx => loadInvoiceLineAllocationsTx(tx, { ...input, worksiteScope }))).rejects.toMatchObject({ code: "OUT_OF_SCOPE" })
    expect(await audit(input.invoiceItemId)).toEqual([])
  })
  it("all scope does not bypass invoice-to-order ownership", async () => {
    const input = await fixture("wrong-order")
    await expect(replace({ ...input, purchaseOrderId: "another-order", worksiteScope: "all" })).rejects.toMatchObject({ code: "CROSS_ORDER_TARGET" })
  })
  it("rejects stale allocation evidence and preserves the committed set", async () => {
    const input = await fixture("stale")
    const first = await replace(input)
    await expect(replace(input)).rejects.toMatchObject({ code: "STALE_EVIDENCE" })
    expect(await read(input)).toEqual(first)
    expect(await audit(input.invoiceItemId)).toHaveLength(1)
  })
  it.each(["invoice", "target"])("invalidates the fingerprint when trusted %s evidence changes", async (target) => {
    const input = await fixture(`edited-${target}`)
    if (target === "invoice") await db.update(schema.purchaseOrderInvoiceItems).set({ subtotal: 99_999 }).where(eq(schema.purchaseOrderInvoiceItems.id, input.invoiceItemId))
    else await db.update(schema.purchaseOrderItems).set({ unitOfMeasure: "kg" }).where(eq(schema.purchaseOrderItems.id, `edited-${target}-a`))
    await expect(replace(input)).rejects.toMatchObject({ code: "STALE_EVIDENCE" })
  })
  it("rejects cross-order destinations even under all scope", async () => {
    const input = await fixture("cross-target")
    await fixture("foreign-target")
    await expect(replace({ ...input, worksiteScope: "all", allocations: [{ purchaseOrderItemId: "foreign-target-a", quantity: 10, subtotal: 100_000 }] })).rejects.toMatchObject({ code: "CROSS_ORDER_TARGET" })
    expect(await audit(input.invoiceItemId)).toEqual([])
  })
  it("reloads missing UOM without replacing it from OC", async () => {
    const input = await fixture("missing-uom")
    await db.update(schema.purchaseOrderInvoiceItems).set({ unitOfMeasure: null }).where(eq(schema.purchaseOrderInvoiceItems.id, input.invoiceItemId))
    const current = await read(input)
    await expect(replace({ ...input, expectedFingerprint: current.fingerprint })).rejects.toMatchObject({ code: "MISSING_UNIT" })
  })
  it("rejects a line whose sign contradicts the parent document kind", async () => {
    const input = await fixture("parent-sign")
    await db.update(schema.purchaseOrderInvoices).set({ documentKind: "credit_note", amount: -100_000 }).where(eq(schema.purchaseOrderInvoices.id, "parent-sign-invoice"))
    const current = await read(input)
    await expect(replace({ ...input, expectedFingerprint: current.fingerprint })).rejects.toMatchObject({ code: "SIGN_MISMATCH" })
  })
  it("leaves existing allocations and mirror intact on validation failure", async () => {
    const input = await fixture("invalid")
    const before = await replace({ ...input, allocations: [{ purchaseOrderItemId: "invalid-a", quantity: 10, subtotal: 100_000 }] })
    await expect(replace({ ...input, expectedFingerprint: before.fingerprint, allocations: [{ purchaseOrderItemId: "invalid-b", quantity: 11, subtotal: 100_000 }] })).rejects.toMatchObject({ code: "QUANTITY_OVERFLOW" })
    expect(await read(input)).toEqual(before)
    expect(await audit(input.invoiceItemId)).toHaveLength(1)
  })
  it("rolls back replacement, mirror and audit when the enclosing transaction aborts", async () => {
    const input = await fixture("rollback")
    const before = await read(input)
    await expect(db.transaction(async tx => {
      await replaceInvoiceLineAllocationsTx(tx, input)
      throw new Error("downstream failure")
    })).rejects.toThrow("downstream failure")
    expect(await read(input)).toEqual(before)
    expect(await audit(input.invoiceItemId)).toEqual([])
  })
  it("does not let database rounding turn a valid proposal into a subtotal overflow", async () => {
    const input = await fixture("rounding")
    const before = await read(input)
    await expect(replace({ ...input, allocations: [
      { purchaseOrderItemId: "rounding-a", quantity: 6, subtotal: 60_000.005 },
      { purchaseOrderItemId: "rounding-b", quantity: 4, subtotal: 40_000.995 },
    ] })).rejects.toMatchObject({ code: "SUBTOTAL_OVERFLOW" })
    expect(await read(input)).toEqual(before)
    expect(await audit(input.invoiceItemId)).toEqual([])
  })
})
