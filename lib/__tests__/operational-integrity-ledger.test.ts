import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = db
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
const { scanOperationalIntegrity, listOperationalIntegrityCases, acknowledgeOperationalIntegrityCase, verifyOperationalIntegrityCase } = await import("@/lib/services/operational-integrity")
const { persistPurchaseOrderInvoiceReconciliationTx } = await import("@/lib/services/purchasing-module/invoice-reconciliation-service")

const permissions = ["warehouse:view_traceability", "warehouse:reconcile_integrity", "purchasing:view"]
function session(worksiteId: string, granted = permissions): Session {
  return { expires: "2099-01-01", user: { id: "oi-user", email: "oi@test.local", roles: [], isGlobal: false, isActive: true, worksiteIds: [worksiteId], primaryWorksiteId: worksiteId, avatarColor: null, permissions: granted } }
}
async function fixture(id: string) {
  await db.insert(schema.worksites).values({ id, code: `QA-${id}`, name: `QA ${id}` })
  await db.insert(schema.worksiteStock).values({ id, worksiteId: id, productId: "oi-product", quantity: 9 })
  await db.insert(schema.inventoryMovements).values({ id, worksiteId: id, productId: "oi-product", type: "ingreso_oc", quantity: 10, stockBefore: 0, stockAfter: 10, performedBy: "oi-user" })
  return session(id)
}
const list = (actor: Session) => listOperationalIntegrityCases(actor, {})
async function firstCase(actor: Session) {
  await scanOperationalIntegrity(actor, ["stock"])
  return (await list(actor))[0]!
}
const reason = "Revisado contra los documentos originales"

describe("operational integrity ledger", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await db.insert(schema.users).values({ id: "oi-user", name: "QA integrity", email: "oi@test.local", hashedPassword: "hash" })
    await db.insert(schema.productCategories).values({ id: "oi-category", name: "QA", slug: "qa-integrity" })
    await db.insert(schema.products).values({ id: "oi-product", sku: "QA-INT", name: "Guante", categoryId: "oi-category", unitOfMeasure: "unidad" })
    await db.insert(schema.productAttributes).values([{ id: "oi-size", productId: "oi-product", name: "Talla", type: "select", options: '["L"]' }, { id: "oi-color", productId: "oi-product", name: "Color", type: "select", options: '["Azul"]' }])
    await db.insert(schema.suppliers).values({ id: "oi-supplier", name: "QA supplier" })
  })
  afterAll(async () => { await pg.close() })

  it("deduplicates repeated scans and records changed evidence separately", async () => {
    const actor = await fixture("dedup")
    expect(await scanOperationalIntegrity(actor, ["stock", "stock"])).toEqual({ found: 1, recorded: 1 })
    expect(await scanOperationalIntegrity(actor, ["stock"])).toEqual({ found: 1, recorded: 0 })
    const original = (await list(actor))[0]!
    await db.update(schema.worksiteStock).set({ quantity: 8 }).where(eq(schema.worksiteStock.id, "dedup"))
    expect(await scanOperationalIntegrity(actor, ["stock"])).toEqual({ found: 1, recorded: 1 })
    const observations = await db.select().from(schema.operationalIntegrityObservations).where(eq(schema.operationalIntegrityObservations.caseId, original.id))
    expect(observations).toHaveLength(2)
    expect((await list(actor))[0]!.id).toBe(original.id)
  })
  it("acknowledges without closing and refuses verification while evidence remains", async () => {
    const actor = await fixture("ack")
    const finding = await firstCase(actor)
    await acknowledgeOperationalIntegrityCase(actor, finding.id, reason)
    expect(await listOperationalIntegrityCases(actor, { state: "active" })).toMatchObject([{ state: "acknowledged" }])
    expect(await verifyOperationalIntegrityCase(actor, finding.id)).toEqual({ resolved: false })
    expect(await list(actor)).toMatchObject([{ state: "acknowledged" }])
    const events = await db.select().from(schema.operationalIntegrityCaseEvents).where(eq(schema.operationalIntegrityCaseEvents.caseId, finding.id))
    expect(events.map(row => row.kind)).toEqual(["acknowledged"])
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, finding.id))
    expect(audit.some(row => row.reason === reason)).toBe(true)
  })
  it("resolves only after rereading the detector and audits verified evidence", async () => {
    const actor = await fixture("resolve")
    const finding = await firstCase(actor)
    await db.update(schema.worksiteStock).set({ quantity: 10 }).where(eq(schema.worksiteStock.id, "resolve"))
    expect(await verifyOperationalIntegrityCase(actor, finding.id)).toEqual({ resolved: true })
    expect(await listOperationalIntegrityCases(actor, { state: "active" })).toEqual([])
    expect(await list(actor)).toMatchObject([{ state: "verified_resolved" }])
    const events = await db.select().from(schema.operationalIntegrityCaseEvents).where(eq(schema.operationalIntegrityCaseEvents.caseId, finding.id))
    expect(events).toMatchObject([{ kind: "verified_resolved", evidence: { findingPresent: false, domain: "stock" } }])
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, finding.id))
    expect(audit.some(row => JSON.parse(row.newState!).kind === "verified_resolved")).toBe(true)
    await verifyOperationalIntegrityCase(actor, finding.id)
    expect(await db.select().from(schema.operationalIntegrityCaseEvents).where(eq(schema.operationalIntegrityCaseEvents.caseId, finding.id))).toHaveLength(1)
  })
  it("new evidence reopens a resolved case without erasing its events", async () => {
    const actor = await fixture("reopen")
    const finding = await firstCase(actor)
    await db.update(schema.worksiteStock).set({ quantity: 10 }).where(eq(schema.worksiteStock.id, "reopen"))
    await verifyOperationalIntegrityCase(actor, finding.id)
    await db.update(schema.worksiteStock).set({ quantity: 7 }).where(eq(schema.worksiteStock.id, "reopen"))
    await scanOperationalIntegrity(actor, ["stock"])
    expect(await list(actor)).toMatchObject([{ id: finding.id, state: "open" }])
  })
  it("verification records newly changed evidence and keeps the case active", async () => {
    const actor = await fixture("verify-changed")
    const finding = await firstCase(actor)
    await acknowledgeOperationalIntegrityCase(actor, finding.id, reason)
    await db.update(schema.worksiteStock).set({ quantity: 7 }).where(eq(schema.worksiteStock.id, "verify-changed"))
    expect(await verifyOperationalIntegrityCase(actor, finding.id)).toEqual({ resolved: false })
    expect(await list(actor)).toMatchObject([{ state: "open" }])
    expect(await db.select().from(schema.operationalIntegrityObservations).where(eq(schema.operationalIntegrityObservations.caseId, finding.id))).toHaveLength(2)
  })
  it("rolls back cases and observations if auditing cannot commit", async () => {
    const actor = await fixture("rollback")
    await pg.exec("ALTER TABLE audit_log ADD CONSTRAINT qa_integrity_audit_failure CHECK (entity_type <> 'operational_integrity_case') NOT VALID")
    try {
      await expect(scanOperationalIntegrity(actor, ["stock"])).rejects.toThrow()
      expect(await list(actor)).toEqual([])
    } finally { await pg.exec("ALTER TABLE audit_log DROP CONSTRAINT qa_integrity_audit_failure") }
    expect(await scanOperationalIntegrity(actor, ["stock"])).toEqual({ found: 1, recorded: 1 })
  })
  it("deduplicates concurrent scans and acknowledgement events", async () => {
    const actor = await fixture("concurrent")
    const results = await Promise.all([scanOperationalIntegrity(actor, ["stock"]), scanOperationalIntegrity(actor, ["stock"])])
    expect(results.map(result => result.recorded).sort()).toEqual([0, 1])
    const [finding] = await list(actor)
    await Promise.all([acknowledgeOperationalIntegrityCase(actor, finding!.id, reason), acknowledgeOperationalIntegrityCase(actor, finding!.id, reason)])
    expect(await db.select().from(schema.operationalIntegrityCaseEvents).where(eq(schema.operationalIntegrityCaseEvents.caseId, finding!.id))).toHaveLength(1)
  })
  it("returns no rows out of faena and masks forged case ids as nonexistent", async () => {
    const actor = await fixture("scope")
    const finding = await firstCase(actor)
    const stranger = session("not-authorized")
    expect(await list(stranger)).toEqual([])
    expect(await listOperationalIntegrityCases(stranger, { worksiteId: "scope" })).toEqual([])
    expect(await scanOperationalIntegrity(stranger, ["stock"])).toEqual({ found: 0, recorded: 0 })
    await expect(acknowledgeOperationalIntegrityCase(stranger, finding.id, reason)).rejects.toThrow("Caso no encontrado")
    await expect(verifyOperationalIntegrityCase(stranger, finding.id)).rejects.toThrow("Caso no encontrado")
    await expect(verifyOperationalIntegrityCase(stranger, "absent")).rejects.toThrow("Caso no encontrado")
  })
  it("enforces read/write permissions and reason validation in the service", async () => {
    const actor = await fixture("permissions")
    const finding = await firstCase(actor)
    expect(await list(session("permissions", []))).toEqual([])
    const reader = session("permissions", ["warehouse:view_traceability"])
    await expect(scanOperationalIntegrity(reader, ["stock"])).rejects.toThrow("Permiso insuficiente")
    await expect(acknowledgeOperationalIntegrityCase(reader, finding.id, reason)).rejects.toThrow("Permiso insuficiente")
    await expect(verifyOperationalIntegrityCase(reader, finding.id)).rejects.toThrow("Permiso insuficiente")
    for (const invalid of [" corto ", "x".repeat(2001)]) await expect(acknowledgeOperationalIntegrityCase(actor, finding.id, invalid)).rejects.toThrow("motivo")
  })
  it("returns a redacted DTO and complete concrete stock identity", async () => {
    const actor = await fixture("redacted")
    await firstCase(actor)
    const [dto] = await list(actor)
    expect(dto).not.toHaveProperty("snapshot")
    expect(dto).not.toHaveProperty("fingerprint")
    expect(dto).not.toHaveProperty("evidence")
    expect(dto).toMatchObject({ productId: "oi-product", sku: "QA-INT", href: "/bodega?vista=kardex&faena=redacted&producto=oi-product" })
    expect(dto!.productName).toContain("L")
    expect(dto!.productName).toContain("Azul")
  })
  it("scans purchasing from authoritative allocations and verifies current reconciliation", async () => {
    const actor = await fixture("purchasing")
    await db.insert(schema.purchaseOrders).values({ id: "oi-po", code: "QA-PO", worksiteId: "purchasing", supplierId: "oi-supplier", createdBy: "oi-user", status: "sent" })
    await db.insert(schema.purchaseOrderItems).values({ id: "oi-line", purchaseOrderId: "oi-po", productId: "oi-product", quantity: 10, unitOfMeasure: "unidad" })
    await db.insert(schema.purchaseOrderInvoices).values({ id: "oi-invoice", purchaseOrderId: "oi-po", invoiceNumber: "QA", amount: 100, fileName: "secret.pdf", filePath: "/private/secret.pdf", uploadedBy: "oi-user" })
    await db.insert(schema.purchaseOrderInvoiceItems).values({ id: "oi-invoice-line", invoiceId: "oi-invoice", productName: "QA", quantity: 10, subtotal: 100, unitPrice: 10, unitOfMeasure: "unidad" })
    await db.insert(schema.purchaseOrderInvoiceItemAllocations).values({ id: "oi-allocation", invoiceItemId: "oi-invoice-line", purchaseOrderItemId: "oi-line", quantity: 11, subtotal: 100, source: "operator" })
    expect(await scanOperationalIntegrity(actor, ["purchasing"])).toEqual({ found: 2, recorded: 2 })
    const restricted = session("purchasing", permissions.filter(permission => permission !== "purchasing:view"))
    expect(await list(restricted)).toEqual([])
    await expect(scanOperationalIntegrity(restricted, ["purchasing"])).rejects.toThrow("Permiso insuficiente")
    const cases = await list(actor)
    await expect(verifyOperationalIntegrityCase(restricted, cases[0]!.id)).rejects.toThrow("Caso no encontrado")
    await db.update(schema.purchaseOrderInvoiceItemAllocations).set({ quantity: 10 }).where(eq(schema.purchaseOrderInvoiceItemAllocations.id, "oi-allocation"))
    await db.transaction(tx => persistPurchaseOrderInvoiceReconciliationTx(tx, "oi-po"))
    for (const finding of cases) expect(await verifyOperationalIntegrityCase(actor, finding.id)).toEqual({ resolved: true })
    expect(JSON.stringify(await list(actor))).not.toContain("secret.pdf")
    await db.update(schema.purchaseOrderInvoices).set({ documentKind: "credit_note", amount: -100 }).where(eq(schema.purchaseOrderInvoices.id, "oi-invoice"))
    await scanOperationalIntegrity(actor, ["purchasing"])
    expect(await listOperationalIntegrityCases(actor, { state: "active" })).toEqual(expect.arrayContaining([expect.objectContaining({ code: "INVOICE_ALLOCATION_INVALID" })]))
  })
  it("scans receiving at final faena using office acceptance and verifies correction", async () => {
    const actor = await fixture("receiving")
    await db.insert(schema.purchaseOrders).values({ id: "oi-rec-po", code: "QA-REC-PO", worksiteId: "receiving", supplierId: "oi-supplier", createdBy: "oi-user", deliveryMode: "via_oficina", status: "sent" })
    await db.insert(schema.purchaseOrderItems).values({ id: "oi-rec-line", purchaseOrderId: "oi-rec-po", productId: "oi-product", quantity: 10, unitOfMeasure: "unidad" })
    await db.insert(schema.receipts).values([{ id: "oi-office", code: "QA-OFFICE", purchaseOrderId: "oi-rec-po", receivedBy: "oi-user", locationType: "office" }, { id: "oi-faena", code: "QA-FAENA", purchaseOrderId: "oi-rec-po", receivedBy: "oi-user", locationType: "faena", worksiteId: "receiving" }])
    await db.insert(schema.receiptItems).values([{ id: "oi-office-item", receiptId: "oi-office", purchaseOrderItemId: "oi-rec-line", quantityReceived: 6 }, { id: "oi-faena-item", receiptId: "oi-faena", purchaseOrderItemId: "oi-rec-line", quantityReceived: 7 }])
    expect(await scanOperationalIntegrity(actor, ["receiving"])).toEqual({ found: 1, recorded: 1 })
    const [finding] = await list(actor)
    expect(finding).toMatchObject({ productId: "oi-product", sku: "QA-INT" })
    expect(finding!.productName).toContain("Azul")
    expect(await verifyOperationalIntegrityCase(actor, finding!.id)).toEqual({ resolved: false })
    await db.update(schema.receiptItems).set({ quantityReceived: 6 }).where(eq(schema.receiptItems.id, "oi-faena-item"))
    expect(await verifyOperationalIntegrityCase(actor, finding!.id)).toEqual({ resolved: true })
  })
})
