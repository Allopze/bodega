import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import type postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { readPurchaseInvoiceReconciliationPreflight } from "@/scripts/preflight-purchase-invoice-reconciliation"

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
    })
  })

  it("cuenta la OC cerrada cuya factura no calza con la orden", async () => {
    await insertClosedOrder("con-diferencia", { withInvoice: true })
    const report = await readPurchaseInvoiceReconciliationPreflight(sqlShim)
    expect(report.affectedClosedOrders).toBe(1)
    expect(report.priceVarianceLines).toBe(1)
  })
})
