/**
 * `E2E-004` (auditoría 2026-09-14) — la cola operacional también vigila el pago.
 *
 * Antes: el trabajo tributario que la cola reconocía terminaba en el documento
 * —recepción sin factura, conciliación `needs_review`, facturación parcial— y
 * los tres llevaban a la pestaña de facturación de la OC. Una factura
 * conciliada y aprobada no generaba ningún pendiente de pago, porque el pago
 * vive en el otro libro (`billing_invoices` con `direction = 'purchase'`, ver
 * `E2E-003`) y la cola no lo miraba: el circuito de compra quedaba cerrado
 * cuando el documento cuadraba, no cuando se pagaba.
 *
 * Lo que estas pruebas fijan, y lo que deliberadamente NO: la fila nace del
 * cruce de identidad tributaria entre los dos libros, hereda la faena de la OC
 * y sólo aparece vencida. Si el documento no tiene gemelo en el libro de
 * facturación, su estado de pago no se conoce y la fuente calla en vez de
 * afirmar que está impago.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
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

import { getOperationalWorkQueue } from "@/lib/services/operational-work-queue"

const now = "2026-01-10T12:00:00.000Z"
const WORKSITE = "ws-e2e004"
const USER = "u-e2e004"
const SUPPLIER = "sup-e2e004"
const ORDER = "oc-e2e004"

function makeSession(permissions: string[]): Session {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: {
      id: USER, name: "Tesorería", email: "e2e004@chome.cl",
      roles: [], permissions, worksiteIds: [WORKSITE], primaryWorksiteId: WORKSITE,
      avatarColor: null, isActive: true,
    },
  } as Session
}

/** Una factura de OC con su gemela en el libro de facturación. */
async function makeInvoicePair(suffix: string, opts: {
  folio: number
  dueDate: string | null
  paymentStatus: "unpaid" | "partial" | "paid"
  withBillingTwin?: boolean
}) {
  const invoiceId = `poi-e2e004-${suffix}`
  await inMemoryDb.insert(schema.purchaseOrderInvoices).values({
    id: invoiceId, purchaseOrderId: ORDER, invoiceNumber: String(opts.folio),
    documentKind: "invoice", amount: 119000, fileName: "f.pdf", filePath: "storage/f.pdf",
    documentSupplierRut: "76.000.004-4", supplierIdentityStatus: "verified",
    supplierIdentitySource: "dte_xml", uploadedBy: USER, uploadedAt: now,
  })
  if (opts.withBillingTwin !== false) {
    await inMemoryDb.insert(schema.billingInvoices).values({
      id: `bi-e2e004-${suffix}`, direction: "purchase", docType: "33", folio: opts.folio,
      issuerTaxId: "76000004-4", issuerName: "Proveedor E2E-004",
      receiverTaxId: "76111111-1", receiverName: "Chome",
      issueDate: "2025-12-01", dueDate: opts.dueDate, totalAmount: 119000,
      documentStatus: "accepted", paymentStatus: opts.paymentStatus, source: "manual",
      createdAt: now, updatedAt: now,
    })
  }
  return invoiceId
}

describe("E2E-004 — el pago vencido de una factura de proveedor es trabajo de la cola", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.worksites).values({
      id: WORKSITE, name: "Faena E2E-004", code: "E2E004", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.users).values({
      id: USER, name: "Tesorería", email: "e2e004@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({
      id: SUPPLIER, name: "Proveedor E2E-004", rut: "76.000.004-4", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseOrders).values({
      id: ORDER, code: "OC-E2E004", worksiteId: WORKSITE, supplierId: SUPPLIER, createdBy: USER,
      status: "closed", deliveryMode: "via_oficina", invoiceReconciliationStatus: "matched",
      createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  it("ofrece el pago vencido y lo enlaza a la ficha de la factura del libro que lo conoce", async () => {
    const invoiceId = await makeInvoicePair("vencida", { folio: 9001, dueDate: "2025-12-31", paymentStatus: "unpaid" })

    const result = await getOperationalWorkQueue(makeSession(["billing:confirm_payments", "billing:view"]), {})
    const item = result.items.find((row) => row.sourceId === invoiceId)

    expect(item).toBeDefined()
    expect(item!.module).toBe("compras")
    expect(item!.worksiteId).toBe(WORKSITE)
    expect(item!.ctaLabel).toBe("Revisar pago")
    expect(item!.href).toBe("/facturacion/facturas/bi-e2e004-vencida")
    expect(item!.sourceDueAt).toBe("2025-12-31")
  })

  it("no ofrece nada a quien no puede actuar sobre pagos", async () => {
    const result = await getOperationalWorkQueue(makeSession(["billing:view"]), {})
    expect(result.items.some((row) => row.actionKey === "pay")).toBe(false)
  })

  it("una factura pagada, una dentro de plazo y una sin vencimiento no son trabajo", async () => {
    const pagada = await makeInvoicePair("pagada", { folio: 9002, dueDate: "2025-12-31", paymentStatus: "paid" })
    const enPlazo = await makeInvoicePair("en-plazo", { folio: 9003, dueDate: "2099-12-31", paymentStatus: "unpaid" })
    const sinVencimiento = await makeInvoicePair("sin-venc", { folio: 9004, dueDate: null, paymentStatus: "unpaid" })

    const result = await getOperationalWorkQueue(makeSession(["billing:confirm_payments", "billing:view"]), {})
    const ids = result.items.map((row) => row.sourceId)

    expect(ids).not.toContain(pagada)
    expect(ids).not.toContain(enPlazo)
    expect(ids).not.toContain(sinVencimiento)
  })

  it("sin gemela en el libro de facturación la cola calla: el estado de pago no se conoce", async () => {
    const huerfana = await makeInvoicePair("huerfana", {
      folio: 9005, dueDate: "2025-12-31", paymentStatus: "unpaid", withBillingTwin: false,
    })

    const result = await getOperationalWorkQueue(makeSession(["billing:confirm_payments", "billing:view"]), {})
    expect(result.items.map((row) => row.sourceId)).not.toContain(huerfana)
  })

  it("una factura anulada en el libro de compras no debe nada", async () => {
    const anulada = await makeInvoicePair("anulada", { folio: 9006, dueDate: "2025-12-31", paymentStatus: "unpaid" })
    await inMemoryDb.update(schema.purchaseOrderInvoices)
      .set({ voidedAt: now, voidedBy: USER, voidReason: "Documento anulado por el proveedor" })
      .where(eq(schema.purchaseOrderInvoices.id, anulada))

    const result = await getOperationalWorkQueue(makeSession(["billing:confirm_payments", "billing:view"]), {})
    expect(result.items.map((row) => row.sourceId)).not.toContain(anulada)
  })
})
