/** Real row-lock regression. Dedicated disposable DSN only; never DATABASE_URL fallback. */
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { assertSafeDestructiveDatabase } from "@/lib/testing/destructive-database-guard"
import { nanoid } from "@/lib/id"
import { loadInvoiceLineAllocationsTx, replaceInvoiceLineAllocationsTx } from "@/lib/services/purchasing-module/invoice-line-allocations"

const databaseUrl = process.env.INVOICE_ALLOCATIONS_CONCURRENCY_DATABASE_URL
const describeIf = databaseUrl ? describe : describe.skip
let client: postgres.Sql | undefined
let db: DB
let migrated = false
const prefix = `QA_alloc_${nanoid(8)}`
const ids = { user: `${prefix}-user`, worksite: `${prefix}-ws`, supplier: `${prefix}-supplier`, order: `${prefix}-order`, invoice: `${prefix}-invoice`, line: `${prefix}-line`, a: `${prefix}-a`, b: `${prefix}-b` }
// recordAudit uses the transaction passed by the service. Avoid opening the
// application's default pool while testing explicit connections.
vi.mock("@/db", () => ({ get db() { return db } }))

describeIf("invoice line allocations concurrency on real PostgreSQL", () => {
  beforeAll(async () => {
    // Reuse the repository's disposable-name/host guard. This suite never drops
    // schemas: the explicit test DSN authorizes isolated QA fixtures only.
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: true, context: "INVOICE_ALLOCATIONS_CONCURRENCY" })
    client = postgres(databaseUrl!, { max: 3, connect_timeout: 5, onnotice: () => {} })
    db = drizzle(client, { schema })
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })
    migrated = true
    await db.insert(schema.users).values({ id: ids.user, name: "QA allocations concurrency", email: `${prefix}@test.local`, hashedPassword: "hash" })
    await db.insert(schema.worksites).values({ id: ids.worksite, name: "QA allocations concurrency", code: prefix })
    await db.insert(schema.suppliers).values({ id: ids.supplier, name: "QA allocations concurrency" })
    await db.insert(schema.purchaseOrders).values({ id: ids.order, code: prefix, worksiteId: ids.worksite, supplierId: ids.supplier, createdBy: ids.user })
    await db.insert(schema.purchaseOrderItems).values([ids.a, ids.b].map(id => ({ id, purchaseOrderId: ids.order, productNameFree: "QA allocations concurrency", quantity: 10, unitOfMeasure: "unidad" })))
    await db.insert(schema.purchaseOrderInvoices).values({ id: ids.invoice, purchaseOrderId: ids.order, invoiceNumber: prefix, amount: 100_000, fileName: "QA.pdf", filePath: "QA.pdf", uploadedBy: ids.user })
    await db.insert(schema.purchaseOrderInvoiceItems).values({ id: ids.line, invoiceId: ids.invoice, productName: "QA allocations concurrency", quantity: 10, unitPrice: 10_000, subtotal: 100_000, unitOfMeasure: "unidad" })
  }, 300_000)

  afterAll(async () => {
    try {
      if (migrated) {
        await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, ids.order))
        await db.delete(schema.auditLog).where(eq(schema.auditLog.entityId, ids.line))
        await db.delete(schema.suppliers).where(eq(schema.suppliers.id, ids.supplier))
        await db.delete(schema.worksites).where(eq(schema.worksites.id, ids.worksite))
        await db.delete(schema.users).where(eq(schema.users.id, ids.user))
      }
    } finally { await client?.end() }
  })

  it("serializes two replacements from one fingerprint: one winner, one STALE_EVIDENCE, no mixed set", async () => {
    const scope = { purchaseOrderId: ids.order, invoiceItemId: ids.line, worksiteScope: [ids.worksite] }
    const evidence = await db.transaction(tx => loadInvoiceLineAllocationsTx(tx, scope))
    const input = { ...scope, expectedFingerprint: evidence.fingerprint, actor: { userId: ids.user }, source: "operator" as const, coverage: "complete" as const }
    const proposals = [
      [{ purchaseOrderItemId: ids.a, quantity: 6, subtotal: 60_000 }, { purchaseOrderItemId: ids.b, quantity: 4, subtotal: 40_000 }],
      [{ purchaseOrderItemId: ids.a, quantity: 3, subtotal: 30_000 }, { purchaseOrderItemId: ids.b, quantity: 7, subtotal: 70_000 }],
    ]
    let started = 0
    let release!: () => void
    const bothTransactionsStarted = new Promise<void>(resolve => { release = resolve })
    const results = await Promise.allSettled(proposals.map(allocations => db.transaction(async tx => {
      started += 1
      if (started === 2) release()
      await bothTransactionsStarted
      return replaceInvoiceLineAllocationsTx(tx, { ...input, allocations })
    })))
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
    const failure = results.find(result => result.status === "rejected")
    expect(failure).toMatchObject({ status: "rejected", reason: { code: "STALE_EVIDENCE" } })
    const winnerIndex = results.findIndex(result => result.status === "fulfilled")
    const current = await db.transaction(tx => loadInvoiceLineAllocationsTx(tx, scope))
    expect(current.allocations.map(({ purchaseOrderItemId, quantity, subtotal }) => ({ purchaseOrderItemId, quantity, subtotal }))).toEqual(proposals[winnerIndex])
    expect(current.legacyPurchaseOrderItemId).toBeNull()
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, ids.line))).toHaveLength(1)
  })
})
