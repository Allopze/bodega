import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const db = drizzle(pg, { schema })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => { await pg.close() })

async function expectConstraintViolation(promise: Promise<unknown>): Promise<void> {
  let thrown: unknown = null
  try { await promise } catch (error) { thrown = error }
  expect(thrown).toBeTruthy()
  const cause = (thrown as { cause?: { message?: string } }).cause
  expect(`${(thrown as Error).message}\n${cause?.message ?? ""}`).toMatch(
    /check|constraint|violates|Failing row|duplicate/i,
  )
}

const actorUserId = "integrity-user"
const worksiteId = "integrity-worksite"
const invoiceItemId = "integrity-invoice-item"
const purchaseOrderItemId = "integrity-order-item"
const caseId = "integrity-case"
const observationId = "integrity-observation"

beforeAll(async () => {
  await db.insert(schema.users).values({
    id: actorUserId,
    name: "Integrity User",
    email: "integrity@test.local",
    hashedPassword: "hash",
    isActive: true,
  })
  await db.insert(schema.worksites).values({
    id: worksiteId,
    name: "Faena Integridad",
    code: "INT-TEST",
    isActive: true,
  })
  await db.insert(schema.suppliers).values({
    id: "integrity-supplier",
    name: "Proveedor Integridad",
    rut: "76.000.001-9",
  })
  await db.insert(schema.purchaseOrders).values({
    id: "integrity-order",
    code: "OC-INT-TEST",
    worksiteId,
    supplierId: "integrity-supplier",
    createdBy: actorUserId,
    status: "sent",
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: purchaseOrderItemId,
    purchaseOrderId: "integrity-order",
    productNameFree: "Línea de prueba",
    quantity: 5,
    unitPrice: 1_000,
    subtotal: 5_000,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: "integrity-order-item-2",
    purchaseOrderId: "integrity-order",
    productNameFree: "Segunda línea de prueba",
    quantity: 1,
    unitPrice: 1_000,
    subtotal: 1_000,
  })
  await db.insert(schema.purchaseOrderInvoices).values({
    id: "integrity-invoice",
    purchaseOrderId: "integrity-order",
    invoiceNumber: "INT-1",
    amount: 5_000,
    fileName: "integrity.pdf",
    filePath: "storage/purchase-orders/integrity.pdf",
    uploadedBy: actorUserId,
  })
  await db.insert(schema.purchaseOrderInvoiceItems).values({
    id: invoiceItemId,
    invoiceId: "integrity-invoice",
    purchaseOrderItemId,
    productName: "Línea de prueba",
    quantity: 5,
    unitPrice: 1_000,
    subtotal: 5_000,
  })
  await db.insert(schema.operationalIntegrityCases).values({
    id: caseId,
    caseKey: "stock:integrity-order-item",
    domain: "stock",
    code: "STOCK_MISMATCH",
    severity: "high",
    worksiteId,
    entityType: "purchase_order_item",
    entityId: purchaseOrderItemId,
  })
  await db.insert(schema.operationalIntegrityObservations).values({
    id: observationId,
    caseId,
    fingerprint: "fingerprint-1",
    snapshot: { expected: 5, actual: 4 },
  })
})

describe("asignaciones N:N de líneas de factura", () => {
  it("rechaza cantidades cero y signos inconsistentes", async () => {
    await expectConstraintViolation(db.insert(schema.purchaseOrderInvoiceItemAllocations).values({
      id: "alloc-zero",
      invoiceItemId,
      purchaseOrderItemId,
      quantity: 0,
      subtotal: 0,
      source: "operator",
    }))

    await expectConstraintViolation(db.insert(schema.purchaseOrderInvoiceItemAllocations).values({
      id: "alloc-sign",
      invoiceItemId,
      purchaseOrderItemId,
      quantity: 1,
      subtotal: -1,
      source: "operator",
    }))
  })

  it("mantiene una sola asignación por par de líneas", async () => {
    await db.insert(schema.purchaseOrderInvoiceItemAllocations).values({
      id: "alloc-pair-1",
      invoiceItemId,
      purchaseOrderItemId,
      quantity: 5,
      subtotal: 5_000,
      source: "operator",
      createdBy: actorUserId,
    })

    await expectConstraintViolation(db.insert(schema.purchaseOrderInvoiceItemAllocations).values({
      id: "alloc-pair-2",
      invoiceItemId,
      purchaseOrderItemId,
      quantity: 5,
      subtotal: 5_000,
      source: "operator",
    }))
  })

  it("restringe el origen de una asignación", async () => {
    await expectConstraintViolation(db.insert(schema.purchaseOrderInvoiceItemAllocations).values({
      id: "alloc-invalid-source",
      invoiceItemId,
      purchaseOrderItemId: "integrity-order-item-2",
      quantity: 1,
      subtotal: 1_000,
      source: "spreadsheet" as "operator",
    }))
  })

  it("expone las asignaciones desde la línea de factura y la línea de OC", async () => {
    const invoiceItem = await db.query.purchaseOrderInvoiceItems.findFirst({
      where: (item, { eq }) => eq(item.id, invoiceItemId),
      with: { allocations: true },
    })
    const orderItem = await db.query.purchaseOrderItems.findFirst({
      where: (item, { eq }) => eq(item.id, purchaseOrderItemId),
      with: { allocations: true },
    })

    expect(invoiceItem?.allocations.map((allocation) => allocation.id)).toEqual(["alloc-pair-1"])
    expect(orderItem?.allocations.map((allocation) => allocation.id)).toEqual(["alloc-pair-1"])
  })
})

describe("ledger de integridad operacional", () => {
  it("restringe dominio y severidad a sus vocabularios cerrados", async () => {
    await expectConstraintViolation(db.insert(schema.operationalIntegrityCases).values({
      id: "case-invalid-domain",
      caseKey: "invalid-domain",
      domain: "billing" as "stock",
      code: "INVALID_DOMAIN",
      severity: "warning",
      worksiteId,
      entityType: "purchase_order",
      entityId: "integrity-order",
    }))

    await expectConstraintViolation(db.insert(schema.operationalIntegrityCases).values({
      id: "case-invalid-severity",
      caseKey: "invalid-severity",
      domain: "purchasing",
      code: "INVALID_SEVERITY",
      severity: "info" as "warning",
      worksiteId,
      entityType: "purchase_order",
      entityId: "integrity-order",
    }))
  })

  it("deduplica fingerprints dentro del caso y permite el mismo fingerprint en otro caso", async () => {
    await expectConstraintViolation(db.insert(schema.operationalIntegrityObservations).values({
      id: "observation-duplicate",
      caseId,
      fingerprint: "fingerprint-1",
      snapshot: { expected: 5, actual: 3 },
    }))

    await db.insert(schema.operationalIntegrityCases).values({
      id: "integrity-case-2",
      caseKey: "receiving:integrity-order-item",
      domain: "receiving",
      code: "RECEIVING_MISMATCH",
      severity: "warning",
      worksiteId,
      entityType: "purchase_order_item",
      entityId: purchaseOrderItemId,
    })
    await db.insert(schema.operationalIntegrityObservations).values({
      id: "observation-other-case",
      caseId: "integrity-case-2",
      fingerprint: "fingerprint-1",
      snapshot: { expected: 5, actual: 3 },
    })
  })

  it("rechaza un evento cuya observación pertenece a otro caso", async () => {
    await db.insert(schema.worksites).values({
      id: "integrity-worksite-crossed",
      name: "Faena Integridad Cruzada",
      code: "INT-CROSSED",
      isActive: true,
    })
    await db.insert(schema.operationalIntegrityCases).values([
      {
        id: "integrity-case-cross-a",
        caseKey: "stock:cross-a",
        domain: "stock",
        code: "STOCK_CROSS_A",
        severity: "high",
        worksiteId,
        entityType: "purchase_order_item",
        entityId: purchaseOrderItemId,
      },
      {
        id: "integrity-case-cross-b",
        caseKey: "receiving:cross-b",
        domain: "receiving",
        code: "RECEIVING_CROSS_B",
        severity: "critical",
        worksiteId: "integrity-worksite-crossed",
        entityType: "purchase_order_item",
        entityId: "integrity-order-item-2",
      },
    ])
    await db.insert(schema.operationalIntegrityObservations).values([
      {
        id: "integrity-observation-cross-a",
        caseId: "integrity-case-cross-a",
        fingerprint: "cross-a",
        snapshot: { worksiteId },
      },
      {
        id: "integrity-observation-cross-b",
        caseId: "integrity-case-cross-b",
        fingerprint: "cross-b",
        snapshot: { worksiteId: "integrity-worksite-crossed" },
      },
    ])

    // Ambos IDs existen y satisfacen por separado las FK heredadas; el rechazo
    // debe provenir de que la observación B no pertenece al caso A.
    await expectConstraintViolation(db.insert(schema.operationalIntegrityCaseEvents).values({
      id: "event-crossed-observation",
      caseId: "integrity-case-cross-a",
      observationId: "integrity-observation-cross-b",
      kind: "acknowledged",
      reason: "La evidencia no pertenece a este caso operacional",
      actorUserId,
    }))
  })

  it("restringe el tipo de evento", async () => {
    await expectConstraintViolation(db.insert(schema.operationalIntegrityCaseEvents).values({
      id: "event-invalid",
      caseId,
      observationId,
      kind: "closed_without_verification" as "acknowledged",
      reason: "No debe admitirse este estado",
      actorUserId,
    }))
  })

  it("exige una razón recortada de 10 a 2000 caracteres", async () => {
    await expectConstraintViolation(db.insert(schema.operationalIntegrityCaseEvents).values({
      id: "event-short-reason",
      caseId,
      observationId,
      kind: "acknowledged",
      reason: "   corta   ",
      actorUserId,
    }))
    await expectConstraintViolation(db.insert(schema.operationalIntegrityCaseEvents).values({
      id: "event-long-reason",
      caseId,
      observationId,
      kind: "acknowledged",
      reason: "x".repeat(2_001),
      actorUserId,
    }))

    await db.insert(schema.operationalIntegrityCaseEvents).values({
      id: "event-valid-reason",
      caseId,
      observationId,
      kind: "acknowledged",
      reason: "0123456789",
      actorUserId,
    })
  })

  it("deduplica eventos por caso, observación y tipo", async () => {
    await expectConstraintViolation(db.insert(schema.operationalIntegrityCaseEvents).values({
      id: "event-duplicate",
      caseId,
      observationId,
      kind: "acknowledged",
      reason: "Segunda confirmación no permitida",
      actorUserId,
    }))

    await db.insert(schema.operationalIntegrityCaseEvents).values({
      id: "event-other-kind",
      caseId,
      observationId,
      kind: "verified_resolved",
      reason: "Resolución verificada con evidencia suficiente",
      actorUserId,
    })
  })
})
