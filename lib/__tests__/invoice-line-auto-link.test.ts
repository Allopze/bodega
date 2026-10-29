import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const { backfillPurchaseOrderInvoiceReconciliations } = await import("@/lib/services/purchasing-module/invoice-reconciliation-service")

const now = "2026-10-29T12:00:00.000Z"
const userId = "user-auto-link"
const supplierId = "supplier-auto-link"

type Line = { id: string; productName: string; productCode?: string | null; quantity: number }

/**
 * Una OC con dos tallas del mismo pantalón (mismo nombre de catálogo, como en
 * producción) y una factura del DTE cuyas líneas llegan sin reparto.
 */
async function insertFixture(prefix: string, lines: Line[]) {
  await inMemoryDb.insert(schema.purchaseOrders).values({
    id: prefix, code: `OC-${prefix}`, worksiteId: "ws-auto-link", supplierId, createdBy: userId,
    status: "closed", netAmount: 100, taxAmount: 19, totalAmount: 119, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.purchaseOrderItems).values([
    { id: `${prefix}-m`, purchaseOrderId: prefix, productId: "pantalon-m", quantity: 26, unitOfMeasure: "unidad", unitPrice: 1, subtotal: 26 },
    { id: `${prefix}-l`, purchaseOrderId: prefix, productId: "pantalon-l", quantity: 18, unitOfMeasure: "unidad", unitPrice: 1, subtotal: 18 },
    { id: `${prefix}-casco`, purchaseOrderId: prefix, productId: "casco", quantity: 1, unitOfMeasure: "unidad", unitPrice: 1, subtotal: 1 },
  ])
  await inMemoryDb.insert(schema.dteDocuments).values({
    id: `${prefix}-dte`, tipoDte: "33", folio: Math.floor(Math.random() * 1e6), rutEmisor: "76000000-0",
    razonSocialEmisor: "Proveedor", fechaEmision: "2026-10-01", montoTotal: 100, codEmp: "1", periodo: "2026-10",
    portalRecordId: `${prefix}-portal`, rawHash: `${prefix}-hash`,
  })
  await inMemoryDb.insert(schema.dteDocumentItems).values(lines.map((line, index) => ({
    id: `${line.id}-dte`, dteDocumentId: `${prefix}-dte`, lineNumber: index + 1,
    productName: line.productName, productCode: line.productCode ?? null, quantity: line.quantity, unitPrice: 1, amount: line.quantity,
  })))
  await inMemoryDb.insert(schema.purchaseOrderInvoices).values({
    id: `${prefix}-invoice`, purchaseOrderId: prefix, invoiceNumber: `F-${prefix}`, amount: 100,
    fileName: "f.xml", filePath: "f.xml", uploadedBy: userId, uploadedAt: now,
  })
  await inMemoryDb.insert(schema.purchaseOrderInvoiceItems).values(lines.map((line) => ({
    id: line.id, invoiceId: `${prefix}-invoice`, sourceDteDocumentItemId: `${line.id}-dte`,
    productName: line.productName, productCode: line.productCode ?? null, unitOfMeasure: null,
    quantity: line.quantity, unitPrice: 1, subtotal: line.quantity,
  })))
}

const allocationsOf = (invoiceItemId: string) => inMemoryDb.query.purchaseOrderInvoiceItemAllocations.findMany({
  where: eq(schema.purchaseOrderInvoiceItemAllocations.invoiceItemId, invoiceItemId),
})

describe("reparto automático de líneas DTE al recalcular la conciliación", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Compras", email: "compras@example.com", hashedPassword: "hash", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-auto-link", name: "Faena", code: "F-AL", createdAt: now, updatedAt: now })
    await inMemoryDb.insert(schema.suppliers).values({ id: supplierId, name: "Proveedor", createdAt: now, updatedAt: now })
    await inMemoryDb.insert(schema.productCategories).values({ id: "cat-auto-link", name: "EPP", slug: "cat-auto-link" })
    await inMemoryDb.insert(schema.products).values([
      { id: "pantalon-m", sku: "EPP-204", name: "Pantalón Slack Cargo gabardina gris/naranjo", categoryId: "cat-auto-link", unitOfMeasure: "unidad", createdAt: now, updatedAt: now },
      { id: "pantalon-l", sku: "EPP-101", name: "Pantalón Slack Cargo gabardina gris/naranjo", categoryId: "cat-auto-link", unitOfMeasure: "unidad", createdAt: now, updatedAt: now },
      { id: "casco", sku: "EPP-001", name: "Casco de seguridad", categoryId: "cat-auto-link", unitOfMeasure: "unidad", createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.productAttributes).values([
      { id: "attr-m", productId: "pantalon-m", name: "Talla", type: "select", options: JSON.stringify(["T/M"]) },
      { id: "attr-l", productId: "pantalon-l", name: "Talla", type: "select", options: JSON.stringify(["T/L"]) },
    ])
  })

  afterAll(async () => { await pg.close() })

  it("reparte por talla las líneas que llegaron sin reparto y lo deja auditado como sugerencia del DTE", async () => {
    await insertFixture("talla", [
      { id: "talla-1", productName: "Pantalon Slack Cargo Gabardina Gris/Nara", productCode: "12-01-011-T-L", quantity: 18 },
      { id: "talla-2", productName: "Pantalon Slack Cargo Gabardina Gris/Nara", productCode: "12-01-011-T-M", quantity: 26 },
    ])

    await backfillPurchaseOrderInvoiceReconciliations()

    expect(await allocationsOf("talla-1")).toEqual([
      expect.objectContaining({ purchaseOrderItemId: "talla-l", quantity: 18, source: "dte_suggestion", createdBy: null }),
    ])
    expect(await allocationsOf("talla-2")).toEqual([
      expect.objectContaining({ purchaseOrderItemId: "talla-m", quantity: 26, source: "dte_suggestion" }),
    ])
    const audit = await inMemoryDb.query.auditLog.findMany({
      where: and(eq(schema.auditLog.entityType, "purchase_order_invoice_item_allocation"), eq(schema.auditLog.entityId, "talla-1")),
    })
    expect(audit).toHaveLength(1)
    expect(audit[0]?.userId).toBeNull()
  })

  it("usa el alias de proveedor confirmado aunque el nombre no se parezca", async () => {
    await inMemoryDb.insert(schema.supplierProductAliases).values({
      id: "alias-casco", supplierId, productId: "casco", supplierProductCode: "01-02-999",
      normalizedCode: "0102999", normalizedName: null, confirmedBy: userId,
    })
    await insertFixture("alias", [{ id: "alias-1", productName: "CASCO MSA V-GARD AMARILLO", productCode: "01-02-999", quantity: 1 }])

    await backfillPurchaseOrderInvoiceReconciliations()

    expect(await allocationsOf("alias-1")).toEqual([
      expect.objectContaining({ purchaseOrderItemId: "alias-casco", source: "dte_suggestion" }),
    ])
  })

  it("deja sin repartir lo ambiguo y no vuelve a repartir una línea que alguien ya tocó", async () => {
    await insertFixture("manual", [
      { id: "manual-ambigua", productName: "Pantalon Slack Cargo Gabardina Gris/Nara", quantity: 5 },
      { id: "manual-tocada", productName: "Pantalon Slack Cargo Gabardina Gris/Nara", productCode: "12-01-011-T-L", quantity: 18 },
    ])
    // Una persona dejó la línea sin reparto a propósito: hay historia de reparto.
    await inMemoryDb.insert(schema.auditLog).values({
      id: "audit-manual", userId, action: "update", entityType: "purchase_order_invoice_item_allocation",
      entityId: "manual-tocada", createdAt: now,
    })

    await backfillPurchaseOrderInvoiceReconciliations()

    expect(await allocationsOf("manual-ambigua")).toEqual([])
    expect(await allocationsOf("manual-tocada")).toEqual([])
  })
})
