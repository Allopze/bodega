/**
 * El filtro "Sin factura" del listado de compras, aplicado al export.
 *
 * El chip del header exporta con el filtro puesto; sin propagarlo, el Excel
 * bajaba también las OC ya facturadas. El predicado es el mismo que usan la cola
 * operacional y el listado (`INVOICE_DUE_ORDER_STATUSES` + `orderHasNoInvoice`),
 * así que este test verifica que el export lo aplica de verdad contra la base y
 * no sólo que el parámetro llega.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es compatible en runtime; difiere sólo en el HKT del resultado.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

const { comprasList } = await import("@/lib/reports/export-module/compras")
const { ocCerradasSinFactura } = await import("@/lib/reports/export-module/oc-cerradas-sin-factura")

const now = "2026-07-25T12:00:00.000Z"

const session = {
  expires: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-export",
    name: "Compradora",
    email: "compradora@example.com",
    roles: ["administrador"],
    permissions: ["purchasing:view", "purchasing:send_order"],
    worksiteIds: [],
    primaryWorksiteId: null,
    avatarColor: null,
    isActive: true,
    isGlobal: true,
  },
} as Session

async function order(id: string, code: string, status: string, invoiceReconciliationStatus = "no_invoices") {
  await inMemoryDb.insert(schema.purchaseOrders).values({
    id, code, worksiteId: "ws-export", supplierId: "sup-export", createdBy: "user-export",
    status, invoiceReconciliationStatus, netAmount: 100, taxAmount: 19, totalAmount: 119, createdAt: now, updatedAt: now,
  })
}

describe("export de compras con el filtro de facturas pendientes", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-export", name: "Faena export", code: "FE-01", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({
      id: "sup-export", name: "Proveedor export", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.users).values({
      id: "user-export", name: "Compradora", email: "compradora@example.com",
      hashedPassword: "hash", createdAt: now, updatedAt: now,
    })

    await order("oc-sin-factura", "OC-EXPORT-0001", "received")       // debe salir
    await order("oc-con-factura", "OC-EXPORT-0002", "received", "matched")
    await order("oc-recien-enviada", "OC-EXPORT-0003", "sent")        // aún no corresponde
    await order("oc-cerrada", "OC-EXPORT-0004", "closed")             // ya no admite trabajo
    await order("oc-cerrada-revision", "OC-EXPORT-0005", "closed", "needs_review")
    await order("oc-cerrada-aceptada", "OC-EXPORT-0006", "closed", "accepted_exception")

    await inMemoryDb.insert(schema.purchaseOrderInvoices).values([
      {
        id: "inv-export", purchaseOrderId: "oc-con-factura", invoiceNumber: "000123", amount: 119,
        fileName: "f.pdf", filePath: "storage/purchase-orders/f.pdf", uploadedBy: "user-export", uploadedAt: now,
      }, {
        id: "inv-review", purchaseOrderId: "oc-cerrada-revision", invoiceNumber: "000124", amount: 120,
        fileName: "review.pdf", filePath: "storage/purchase-orders/review.pdf", uploadedBy: "user-export", uploadedAt: now,
      }, {
        id: "inv-accepted", purchaseOrderId: "oc-cerrada-aceptada", invoiceNumber: "000125", amount: 120,
        fileName: "accepted.pdf", filePath: "storage/purchase-orders/accepted.pdf", uploadedBy: "user-export", uploadedAt: now,
      },
    ])
  })

  afterAll(async () => {
    await pg.close()
  })

  it("sin el filtro exporta todas las órdenes visibles", async () => {
    const report = await comprasList(session, {}, 100)
    expect(report.rows.map((row) => row[0])).toEqual(expect.arrayContaining([
      "OC-EXPORT-0001", "OC-EXPORT-0002", "OC-EXPORT-0003", "OC-EXPORT-0004", "OC-EXPORT-0005", "OC-EXPORT-0006",
    ]))
  })

  it("incluye la OC cerrada con diferencias y excluye la aceptada y la cerrada sin factura", async () => {
    const report = await comprasList(session, { invoicePending: true }, 100)
    expect(report.rows.map((row) => row[0])).toEqual(expect.arrayContaining(["OC-EXPORT-0001", "OC-EXPORT-0005"]))
    expect(report.rows.map((row) => row[0])).not.toEqual(expect.arrayContaining(["OC-EXPORT-0004", "OC-EXPORT-0006"]))
    const reviewRow = report.rows.find((row) => row[0] === "OC-EXPORT-0005")
    expect(report.headers).toContain("Conciliación")
    expect(reviewRow?.[7]).toBe("Revisión requerida")
  })

  // Una OC cerrada sale de la cola operacional, así que cerrarla sin respaldo
  // tributario no deja rastro en pantalla: este reporte es el que lo audita.
  it("audita las OC cerradas sin factura con el motivo del cierre", async () => {
    await inMemoryDb.insert(schema.statusHistory).values({
      id: "sh-export", entityType: "purchase_order", entityId: "oc-cerrada",
      fromStatus: "received", toStatus: "closed", changedBy: "user-export",
      reason: "Servicio sin factura [Cierre sin conciliación de factura confirmado]",
      changedAt: now,
    })

    const report = await ocCerradasSinFactura(session, {}, 100)

    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]?.[0]).toBe("OC-EXPORT-0004")
    expect(String(report.rows[0]?.[5])).toContain("Cierre sin conciliación de factura confirmado")
  })
})
