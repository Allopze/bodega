import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import type postgres from "postgres"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { verifyPurchaseInvoiceAllocations } from "@/scripts/verify-purchase-invoice-allocations"

/**
 * Cada inconsistencia se siembra sola y se cuenta sola: si dos consultas
 * compartieran predicado, un desvío real se escondería tras el conteo del otro.
 *
 * Mismo shim que el preflight: la consulta no interpola nada, así que basta un
 * `sql.begin(modo, fn)` que entregue una plantilla etiquetada contra PGlite.
 */
const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const sqlShim = {
  begin: (_mode: string, fn: (tx: unknown) => unknown) =>
    Promise.resolve(
      fn(Object.assign(
        (strings: TemplateStringsArray, ...fragments: string[]) =>
          pg.query(strings.reduce((text, part, index) => text + part + (fragments[index] ?? ""), "")).then((result) => result.rows),
        { unsafe: (fragment: string) => fragment },
      )),
    ),
} as unknown as postgres.Sql

const now = "2026-09-09T12:00:00.000Z"

async function order(id: string) {
  await db.insert(schema.purchaseOrders).values({
    id, code: `OC-${id}`, worksiteId: "ws-alloc", supplierId: "sup-alloc",
    createdBy: "user-alloc", status: "sent",
    netAmount: 100, taxAmount: 19, totalAmount: 119, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: `${id}-item`, purchaseOrderId: id, productId: "prod-alloc",
    quantity: 10, unitOfMeasure: "unidad", unitPrice: 10, subtotal: 100,
  })
  await db.insert(schema.purchaseOrderInvoices).values({
    id: `${id}-invoice`, purchaseOrderId: id, invoiceNumber: `F-${id}`,
    amount: 100, issueDate: "2026-09-01", fileName: `${id}.pdf`,
    filePath: `storage/purchase-orders/${id}.pdf`, uploadedBy: "user-alloc", uploadedAt: now,
  })
}

/** Segunda línea de la MISMA orden: el reparto N:N vive dentro de una OC. */
async function secondLine(orderId: string) {
  await db.insert(schema.purchaseOrderItems).values({
    id: `${orderId}-item2`, purchaseOrderId: orderId, productId: "prod-alloc",
    quantity: 10, unitOfMeasure: "unidad", unitPrice: 10, subtotal: 100,
  })
}

async function invoiceLine(id: string, values: { mirror?: string | null; quantity?: number; subtotal?: number } = {}) {
  await db.insert(schema.purchaseOrderInvoiceItems).values({
    id: `${id}-invoice-item`, invoiceId: `${id}-invoice`,
    purchaseOrderItemId: values.mirror === undefined ? `${id}-item` : values.mirror,
    productName: "Producto", unitOfMeasure: "unidad",
    quantity: values.quantity ?? 10, unitPrice: 10, subtotal: values.subtotal ?? 100,
  })
}

describe("verificador de asignaciones de factura", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await db.insert(schema.users).values({
      id: "user-alloc", name: "Operador", email: "alloc@example.com",
      hashedPassword: "hash", createdAt: now, updatedAt: now,
    })
    await db.insert(schema.worksites).values({
      id: "ws-alloc", name: "Faena alloc", code: "F-ALLOC", createdAt: now, updatedAt: now,
    })
    await db.insert(schema.suppliers).values({ id: "sup-alloc", name: "Proveedor", createdAt: now, updatedAt: now })
    await db.insert(schema.productCategories).values({ id: "cat-alloc", name: "Categoría", slug: "cat-alloc" })
    await db.insert(schema.products).values({
      id: "prod-alloc", sku: "PROD-ALLOC", name: "Producto",
      categoryId: "cat-alloc", unitOfMeasure: "unidad", createdAt: now, updatedAt: now,
    })
  })

  it("no reporta nada sobre una asignación 1:1 sana", async () => {
    await order("ok")
    await invoiceLine("ok")
    await db.insert(schema.purchaseOrderInvoiceItemAllocations).values({
      id: "ok-alloc", invoiceItemId: "ok-invoice-item", purchaseOrderItemId: "ok-item",
      quantity: 10, subtotal: 100, source: "legacy_backfill",
    })

    expect(await verifyPurchaseInvoiceAllocations(sqlShim)).toEqual({
      legacyRowsWithoutAllocation: 0,
      crossOrderAllocations: 0,
      signMismatchedAllocations: 0,
      overAllocatedInvoiceLines: 0,
      inconsistentCompatibilityMirrors: 0,
    })
  })

  it("cuenta una fila heredada 1:1 que se quedó sin su asignación", async () => {
    await order("legacy")
    await invoiceLine("legacy")

    const report = await verifyPurchaseInvoiceAllocations(sqlShim)
    expect(report.legacyRowsWithoutAllocation).toBe(1)
    expect(report.crossOrderAllocations).toBe(0)
    expect(report.overAllocatedInvoiceLines).toBe(0)
  })

  it("cuenta una asignación que apunta a la línea de otra orden", async () => {
    await order("cross")
    await order("otra")
    // El espejo acompaña a la asignación para que sólo se dispare el cruce de
    // órdenes: si además lo contradijera, esta fila contaría en dos conteos.
    await invoiceLine("cross", { mirror: "otra-item" })
    await db.insert(schema.purchaseOrderInvoiceItemAllocations).values({
      id: "cross-alloc", invoiceItemId: "cross-invoice-item", purchaseOrderItemId: "otra-item",
      quantity: 10, subtotal: 100, source: "operator",
    })

    const report = await verifyPurchaseInvoiceAllocations(sqlShim)
    expect(report.crossOrderAllocations).toBe(1)
  })

  it("cuenta el signo opuesto al de la línea del comprobante", async () => {
    await order("signo")
    // Línea de nota de crédito: cantidad y subtotal negativos.
    await invoiceLine("signo", { quantity: -5, subtotal: -50 })
    await db.insert(schema.purchaseOrderInvoiceItemAllocations).values({
      id: "signo-alloc", invoiceItemId: "signo-invoice-item", purchaseOrderItemId: "signo-item",
      quantity: 5, subtotal: 50, source: "operator",
    })

    const report = await verifyPurchaseInvoiceAllocations(sqlShim)
    expect(report.signMismatchedAllocations).toBe(1)
  })

  it("cuenta la línea repartida por encima de lo que factura", async () => {
    await order("exceso")
    await secondLine("exceso")
    await invoiceLine("exceso", { quantity: 10, subtotal: 100 })
    await db.insert(schema.purchaseOrderInvoiceItemAllocations).values([
      { id: "exceso-a1", invoiceItemId: "exceso-invoice-item", purchaseOrderItemId: "exceso-item", quantity: 6, subtotal: 60, source: "operator" },
      { id: "exceso-a2", invoiceItemId: "exceso-invoice-item", purchaseOrderItemId: "exceso-item2", quantity: 5, subtotal: 50, source: "operator" },
    ])

    const report = await verifyPurchaseInvoiceAllocations(sqlShim)
    expect(report.overAllocatedInvoiceLines).toBe(1)
  })

  it("cuenta el espejo de compatibilidad que contradice a su única asignación", async () => {
    await order("espejo")
    await order("espejo-b")
    await invoiceLine("espejo", { mirror: "espejo-b-item" })
    await db.insert(schema.purchaseOrderInvoiceItemAllocations).values({
      id: "espejo-alloc", invoiceItemId: "espejo-invoice-item", purchaseOrderItemId: "espejo-item",
      quantity: 10, subtotal: 100, source: "operator",
    })

    const report = await verifyPurchaseInvoiceAllocations(sqlShim)
    expect(report.inconsistentCompatibilityMirrors).toBe(1)
  })

  /**
   * Una línea repartida entre dos líneas de su propia OC no puede llevar espejo
   * 1:1, y no debe sumar a ningún conteo: es la forma sana del modelo N:N.
   */
  it("no reporta nada por una línea repartida entre dos líneas de su orden", async () => {
    const before = await verifyPurchaseInvoiceAllocations(sqlShim)

    await order("multi")
    await secondLine("multi")
    await invoiceLine("multi", { mirror: null, quantity: 10, subtotal: 100 })
    await db.insert(schema.purchaseOrderInvoiceItemAllocations).values([
      { id: "multi-a1", invoiceItemId: "multi-invoice-item", purchaseOrderItemId: "multi-item", quantity: 6, subtotal: 60, source: "operator" },
      { id: "multi-a2", invoiceItemId: "multi-invoice-item", purchaseOrderItemId: "multi-item2", quantity: 4, subtotal: 40, source: "operator" },
    ])

    expect(await verifyPurchaseInvoiceAllocations(sqlShim)).toEqual(before)
  })
})
