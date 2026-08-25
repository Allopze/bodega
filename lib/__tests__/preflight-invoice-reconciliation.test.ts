import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { inArray } from "drizzle-orm"
import path from "node:path"
import type postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { readPurchaseInvoiceReconciliationPreflight } from "@/scripts/preflight-purchase-invoice-reconciliation"
import { mapNewInvoiceReconciliationStatusesForRollback } from "@/scripts/rollback-purchase-invoice-reconciliation-statuses"

/**
 * El preflight corre en el deploy de producción (`scripts/deploy-prod.sh`) y es
 * el único diagnóstico que el operador ve antes de migrar, así que su conteo
 * tiene que ser creíble sobre una base real.
 *
 * La consulta no interpola nada: le basta un `sql.begin(modo, fn)` que entregue
 * una plantilla etiquetada contra PGlite. `read only` se ignora acá — PGlite no
 * lo necesita y la garantía que importa es la del PostgreSQL de producción.
 */
const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const sqlShim = {
  begin: (_mode: string, fn: (tx: unknown) => unknown) =>
    Promise.resolve(
      fn((strings: TemplateStringsArray) => pg.query(strings.join("")).then((result) => result.rows)),
    ),
} as unknown as postgres.Sql

const now = "2026-08-20T12:00:00.000Z"

async function insertClosedOrder(id: string, options: { withInvoice: boolean }) {
  await db.insert(schema.purchaseOrders).values({
    id, code: `OC-${id}`, worksiteId: "ws-preflight", supplierId: "supplier-preflight",
    createdBy: "user-preflight", status: "closed",
    netAmount: 100, taxAmount: 19, totalAmount: 119, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: `${id}-item`, purchaseOrderId: id, productId: "product-preflight",
    quantity: 2, unitOfMeasure: "unidad", unitPrice: 50, subtotal: 100,
  })
  if (!options.withInvoice) return
  await db.insert(schema.purchaseOrderInvoices).values({
    id: `${id}-invoice`, purchaseOrderId: id, invoiceNumber: `F-${id}`,
    amount: 123, issueDate: "2026-08-20", fileName: `${id}.pdf`,
    filePath: `storage/purchase-orders/${id}.pdf`, uploadedBy: "user-preflight", uploadedAt: now,
  })
  await db.insert(schema.purchaseOrderInvoiceItems).values({
    id: `${id}-invoice-item`, invoiceId: `${id}-invoice`, purchaseOrderItemId: `${id}-item`,
    productName: "Producto", unitOfMeasure: "unidad", quantity: 2, unitPrice: 52, subtotal: 104,
  })
}

describe("preflight de conciliación OC-factura", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await db.insert(schema.users).values({
      id: "user-preflight", name: "Operador", email: "operador@example.com",
      hashedPassword: "hash", createdAt: now, updatedAt: now,
    })
    await db.insert(schema.worksites).values({
      id: "ws-preflight", name: "Faena preflight", code: "F-PRE", createdAt: now, updatedAt: now,
    })
    await db.insert(schema.suppliers).values({
      id: "supplier-preflight", name: "Proveedor preflight", createdAt: now, updatedAt: now,
    })
    await db.insert(schema.productCategories).values({
      id: "category-preflight", name: "Categoría", slug: "category-preflight",
    })
    await db.insert(schema.products).values({
      id: "product-preflight", sku: "PROD-PRE", name: "Producto",
      categoryId: "category-preflight", unitOfMeasure: "unidad", createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  it("no acusa a una OC cerrada que todavía no factura nada", async () => {
    await insertClosedOrder("sin-factura", { withInvoice: false })
    expect(await readPurchaseInvoiceReconciliationPreflight(sqlShim)).toEqual({
      invoicesWithoutLines: 0,
      unlinkedLines: 0,
      priceVarianceLines: 0,
      affectedClosedOrders: 0,
      ordersWithMultipleInvoices: 0,
      ordersWithMultipleReceipts: 0,
      uniqueReceiptSuggestions: 0,
      ambiguousReceiptSuggestions: 0,
    })
  })

  it("cuenta la OC cerrada cuya factura no calza con la orden", async () => {
    await insertClosedOrder("con-diferencia", { withInvoice: true })
    const report = await readPurchaseInvoiceReconciliationPreflight(sqlShim)
    expect(report.affectedClosedOrders).toBe(1)
    expect(report.priceVarianceLines).toBe(1)
  })

  it("no confunde una cobertura parcial legítima con una diferencia", async () => {
    const before = await readPurchaseInvoiceReconciliationPreflight(sqlShim)
    await insertClosedOrder("parcial-legitima", { withInvoice: true })
    await db.update(schema.purchaseOrderInvoices)
      .set({ amount: 60 })
      .where(inArray(schema.purchaseOrderInvoices.id, ["parcial-legitima-invoice"]))
    await db.update(schema.purchaseOrderInvoiceItems)
      .set({ quantity: 1, unitPrice: 50, subtotal: 50 })
      .where(inArray(schema.purchaseOrderInvoiceItems.id, ["parcial-legitima-invoice-item"]))

    const after = await readPurchaseInvoiceReconciliationPreflight(sqlShim)
    expect(after.affectedClosedOrders).toBe(before.affectedClosedOrders)
    expect(after.priceVarianceLines).toBe(before.priceVarianceLines)
  })

  it("cuenta una sugerencia ambigua sin escribir vínculos históricos", async () => {
    await insertClosedOrder("ambiguo", { withInvoice: true })
    await db.insert(schema.receipts).values([
      {
        id: "ambiguo-receipt-a", code: "REC-AMB-A", purchaseOrderId: "ambiguo",
        receivedBy: "user-preflight", receivedAt: now, locationType: "faena", worksiteId: "ws-preflight",
      },
      {
        id: "ambiguo-receipt-b", code: "REC-AMB-B", purchaseOrderId: "ambiguo",
        receivedBy: "user-preflight", receivedAt: now, locationType: "faena", worksiteId: "ws-preflight",
      },
    ])
    await db.insert(schema.receiptItems).values([
      {
        id: "ambiguo-receipt-item-a", receiptId: "ambiguo-receipt-a",
        purchaseOrderItemId: "ambiguo-item", quantityReceived: 2,
      },
      {
        id: "ambiguo-receipt-item-b", receiptId: "ambiguo-receipt-b",
        purchaseOrderItemId: "ambiguo-item", quantityReceived: 2,
      },
    ])

    const report = await readPurchaseInvoiceReconciliationPreflight(sqlShim)
    expect(report.ordersWithMultipleReceipts).toBe(1)
    expect(report.ambiguousReceiptSuggestions).toBe(1)
    expect(await db.select().from(schema.purchaseOrderInvoiceReceipts)).toHaveLength(0)
  })

  it("prepara el rollback mapeando sólo los estados nuevos a revisión", async () => {
    await db.update(schema.purchaseOrders)
      .set({ invoiceReconciliationStatus: "partially_invoiced", invoiceReconciliationFingerprint: "v2:partial" })
      .where(inArray(schema.purchaseOrders.id, ["sin-factura", "con-diferencia"]))
    await db.update(schema.purchaseOrders)
      .set({ invoiceReconciliationStatus: "awaiting_receipt", invoiceReconciliationFingerprint: "v2:awaiting" })
      .where(inArray(schema.purchaseOrders.id, ["ambiguo"]))

    expect(await mapNewInvoiceReconciliationStatusesForRollback(sqlShim)).toEqual({ mappedOrders: 3 })
    const statuses = await db.select({
      id: schema.purchaseOrders.id,
      status: schema.purchaseOrders.invoiceReconciliationStatus,
      fingerprint: schema.purchaseOrders.invoiceReconciliationFingerprint,
    }).from(schema.purchaseOrders)
      .where(inArray(schema.purchaseOrders.id, ["sin-factura", "con-diferencia", "ambiguo"]))
    expect(statuses).toHaveLength(3)
    expect(statuses.every((row) => row.status === "needs_review")).toBe(true)
    expect(statuses.every((row) => row.fingerprint === null)).toBe(true)
  })
})
