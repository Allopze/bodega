/**
 * E2E-003 (auditoría 2026-09-14): el mismo documento de proveedor puede vivir
 * en dos libros que no se conocen —`purchase_order_invoices`, que cuelga de la
 * OC y alimenta la conciliación de tres vías, y `billing_invoices` con
 * `direction = 'purchase'`, que trae vencimiento, cobranza y pagos— y la
 * detección de duplicados de facturación sólo mira su propio libro.
 *
 * Cuál debe ser el libro único es una decisión de producto. La comprobación
 * cruzada no la necesita: detecta y deja constancia, no fusiona ni bloquea.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const {
  describeCrossBookMatch, describeDuplicateAcrossOrders, findInBillingBook, findInPurchasingBook,
  findSameSupplierDocumentInAnotherOrder, normalizeFolio, normalizeTaxId,
} = await import("@/lib/services/purchasing-module/supplier-document-crosscheck")
const { upsertProviderInvoice } = await import("@/lib/services/billing/invoices")

const USER = "user-xb-1"
const WS = "ws-xb-1"
const SUP = "sup-xb-1"
const RUT = "76123456-7"

async function seedBillingPurchase(folio: number, docType = "33") {
  const id = nanoid()
  await testDb.insert(schema.billingInvoices).values({
    id, direction: "purchase", docType, folio,
    issuerTaxId: "76.123.456-7", issuerName: "Proveedor",
    receiverTaxId: "78023530-6", receiverName: "CHOME",
    issueDate: "2026-08-01", currency: "CLP", totalAmount: 100,
    documentStatus: "accepted", paymentStatus: "unpaid", source: "manual",
  })
  return id
}

async function seedPurchasingInvoice(invoiceNumber: string, options: { kind?: "invoice" | "credit_note"; voided?: boolean } = {}) {
  const orderId = nanoid()
  const code = `OC-XB-${nanoid(4).toUpperCase()}`
  await testDb.insert(schema.purchaseOrders).values({
    id: orderId, code, supplierId: SUP, worksiteId: WS, createdBy: USER, status: "received",
  })
  const id = nanoid()
  await testDb.insert(schema.purchaseOrderInvoices).values({
    id, purchaseOrderId: orderId, invoiceNumber,
    documentKind: options.kind ?? "invoice",
    documentSupplierRut: "76.123.456-7",
    fileName: "f.pdf", filePath: "storage/purchase-orders/f.pdf", uploadedBy: USER,
    ...(options.voided
      ? { voidedAt: "2026-09-01T12:00:00.000Z", voidedBy: USER, voidReason: "Se adjuntó a la orden equivocada" }
      : {}),
  })
  return { id, code }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({
    id: USER, name: "Compras", email: "compras@xb.cl", hashedPassword: "x", isActive: true,
  })
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena XB", code: "XB", isActive: true })
  await testDb.insert(schema.suppliers).values({ id: SUP, name: "Proveedor XB", rut: RUT, isActive: true })
})

beforeEach(async () => {
  await testDb.delete(schema.purchaseOrderInvoices)
  await testDb.delete(schema.purchaseOrders)
  await testDb.delete(schema.billingInvoices)
})

describe("normalización de la identidad tributaria", () => {
  it("el RUT es el mismo aunque se escriba distinto", () => {
    expect(normalizeTaxId("76.123.456-7")).toBe("761234567")
    expect(normalizeTaxId("76123456-7")).toBe("761234567")
    expect(normalizeTaxId("76123456k")).toBe("76123456K")
    expect(normalizeTaxId(null)).toBe("")
  })

  it("el folio se compara como número, no como texto", () => {
    // Los proveedores lo escriben con ceros, con serie y con separadores;
    // comparar el texto crudo daría falsos negativos justo donde importa.
    expect(normalizeFolio("0004321")).toBe(4321)
    expect(normalizeFolio("F-4.321")).toBe(4321)
    expect(normalizeFolio("4321")).toBe(4321)
    expect(normalizeFolio("sin folio")).toBeNull()
    expect(normalizeFolio(null)).toBeNull()
  })
})

describe("del libro de compras hacia el de facturación", () => {
  it("encuentra el gemelo aunque el folio venga con ceros y el RUT con puntos", async () => {
    const billingId = await seedBillingPurchase(4321)
    const match = await findInBillingBook({
      issuerTaxId: "76.123.456-7", invoiceNumber: "0004321", documentKind: "invoice",
    })
    expect(match?.id).toBe(billingId)
    expect(describeCrossBookMatch(match!)).toContain("ya existe en Facturación")
  })

  it("no confunde una factura con una nota de crédito del mismo folio", async () => {
    await seedBillingPurchase(4321, "61")
    expect(await findInBillingBook({
      issuerTaxId: RUT, invoiceNumber: "4321", documentKind: "invoice",
    })).toBeNull()
    expect(await findInBillingBook({
      issuerTaxId: RUT, invoiceNumber: "4321", documentKind: "credit_note",
    })).not.toBeNull()
  })

  it("no confunde el mismo folio de otro emisor", async () => {
    await seedBillingPurchase(4321)
    expect(await findInBillingBook({
      issuerTaxId: "99888777-6", invoiceNumber: "4321", documentKind: "invoice",
    })).toBeNull()
  })

  it("no mira las facturas de venta: sólo las de compra", async () => {
    await testDb.insert(schema.billingInvoices).values({
      id: nanoid(), direction: "sale", docType: "33", folio: 4321,
      issuerTaxId: "76123456-7", issuerName: "CHOME",
      receiverTaxId: "78023530-6", receiverName: "Cliente",
      issueDate: "2026-08-01", currency: "CLP", totalAmount: 100,
      documentStatus: "accepted", paymentStatus: "unpaid", source: "manual",
    })
    expect(await findInBillingBook({
      issuerTaxId: RUT, invoiceNumber: "4321", documentKind: "invoice",
    })).toBeNull()
  })

  it("sin RUT o sin folio no inventa una coincidencia", async () => {
    await seedBillingPurchase(4321)
    expect(await findInBillingBook({ issuerTaxId: null, invoiceNumber: "4321", documentKind: "invoice" })).toBeNull()
    expect(await findInBillingBook({ issuerTaxId: RUT, invoiceNumber: "s/n", documentKind: "invoice" })).toBeNull()
  })
})

describe("del libro de facturación hacia el de compras", () => {
  it("encuentra el gemelo y nombra la orden a la que está adjunto", async () => {
    const { id, code } = await seedPurchasingInvoice("0004321")
    const match = await findInPurchasingBook({ issuerTaxId: "76.123.456-7", folio: 4321, docType: "33" })
    expect(match?.id).toBe(id)
    expect(match?.purchaseOrderCode).toBe(code)
    expect(describeCrossBookMatch(match!)).toContain(code)
  })

  it("una factura anulada no ocupa la identidad de nadie", async () => {
    // FAC-002 dejó la fila anulada en su sitio; si contara aquí, la corrección
    // de un error impediría registrar el documento correcto.
    await seedPurchasingInvoice("4321", { voided: true })
    expect(await findInPurchasingBook({ issuerTaxId: RUT, folio: 4321, docType: "33" })).toBeNull()
  })

  it("distingue la nota de crédito por su tipo de DTE", async () => {
    await seedPurchasingInvoice("4321", { kind: "credit_note" })
    expect(await findInPurchasingBook({ issuerTaxId: RUT, folio: 4321, docType: "61" })).not.toBeNull()
    expect(await findInPurchasingBook({ issuerTaxId: RUT, folio: 4321, docType: "33" })).toBeNull()
  })
})

describe("la sincronización deja constancia de que el documento ya estaba en compras", () => {
  it("registra un evento de duplicado entre libros al importar la factura", async () => {
    const { code } = await seedPurchasingInvoice("0004321")

    const result = await testDb.transaction((tx) => upsertProviderInvoice(tx, {
      externalId: "ext-xb-1", direction: "purchase", docType: "33", folio: 4321,
      issuerTaxId: "76123456-7", issuerName: "Proveedor XB",
      receiverTaxId: "78023530-6", receiverName: "CHOME",
      issueDate: "2026-08-01", dueDate: null, currency: "CLP",
      netAmount: 84034, taxAmount: 15966, exemptAmount: 0, totalAmount: 100000,
      documentStatus: "accepted", items: [],
    } as never, "manual"))

    expect(result.outcome).toBe("inserted")
    const events = await testDb.select().from(schema.billingInvoiceEvents)
      .where(eq(schema.billingInvoiceEvents.invoiceId, result.invoiceId))
    const crossBook = events.find((e) => e.eventType === "invoice.crossbook_duplicate")
    expect(crossBook).toBeDefined()
    expect(crossBook?.actorKind).toBe("system")
    expect(JSON.stringify(crossBook?.detail)).toContain(code)
  })

  it("no inventa el aviso cuando el documento sólo existe en un libro", async () => {
    const result = await testDb.transaction((tx) => upsertProviderInvoice(tx, {
      externalId: "ext-xb-2", direction: "purchase", docType: "33", folio: 9999,
      issuerTaxId: "76123456-7", issuerName: "Proveedor XB",
      receiverTaxId: "78023530-6", receiverName: "CHOME",
      issueDate: "2026-08-01", dueDate: null, currency: "CLP",
      netAmount: 84034, taxAmount: 15966, exemptAmount: 0, totalAmount: 100000,
      documentStatus: "accepted", items: [],
    } as never, "manual"))

    const events = await testDb.select().from(schema.billingInvoiceEvents)
      .where(eq(schema.billingInvoiceEvents.invoiceId, result.invoiceId))
    expect(events.some((e) => e.eventType === "invoice.crossbook_duplicate")).toBe(false)
  })
})

/**
 * `FAC-001` (auditoría 2026-09-14): la unicidad del folio estaba declarada por
 * OC, así que el mismo folio del mismo proveedor podía adjuntarse a dos órdenes
 * y contarse dos veces en la cobertura documental, en el gasto y en el pago.
 */
describe("el mismo folio del mismo proveedor en otra orden", () => {
  it("lo encuentra y nombra la orden que ya lo tiene", async () => {
    const { code } = await seedPurchasingInvoice("0004321")
    const match = await findSameSupplierDocumentInAnotherOrder({
      supplierRut: "76.123.456-7", invoiceNumber: "4321", documentKind: "invoice",
    })
    expect(match?.purchaseOrderCode).toBe(code)
    expect(describeDuplicateAcrossOrders(match!)).toContain("una sola vez")
  })

  it("no se acusa a sí mismo: excluye la orden que se está cargando", async () => {
    const { code } = await seedPurchasingInvoice("4321")
    const [order] = await testDb.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.code, code))
    expect(await findSameSupplierDocumentInAnotherOrder({
      supplierRut: RUT, invoiceNumber: "4321", documentKind: "invoice",
      exceptPurchaseOrderId: order!.id,
    })).toBeNull()
  })

  it("dos folios iguales de proveedores distintos no son un duplicado", async () => {
    await seedPurchasingInvoice("4321")
    expect(await findSameSupplierDocumentInAnotherOrder({
      supplierRut: "99888777-6", invoiceNumber: "4321", documentKind: "invoice",
    })).toBeNull()
  })

  it("una factura y una nota de crédito con el mismo folio conviven", async () => {
    await seedPurchasingInvoice("4321", { kind: "credit_note" })
    expect(await findSameSupplierDocumentInAnotherOrder({
      supplierRut: RUT, invoiceNumber: "4321", documentKind: "invoice",
    })).toBeNull()
  })

  it("el adjunto anulado libera el folio", async () => {
    await seedPurchasingInvoice("4321", { voided: true })
    expect(await findSameSupplierDocumentInAnotherOrder({
      supplierRut: RUT, invoiceNumber: "4321", documentKind: "invoice",
    })).toBeNull()
  })

  it("la base lo impide aunque nadie pase por el servicio", async () => {
    // El servicio comprueba dentro de la transacción; el índice parcial es lo
    // que sostiene la regla frente a una carrera o a una escritura directa.
    await seedPurchasingInvoice("4321")
    await expect(seedPurchasingInvoice("0004321")).rejects.toThrow()
  })
})
