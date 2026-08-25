import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
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

const {
  acceptPurchaseOrderInvoiceReconciliation,
  getPurchaseOrderInvoiceReconciliation,
  backfillPurchaseOrderInvoiceReconciliations,
} = await import("@/lib/services/purchasing-module/invoice-reconciliation-service")
const { deletePurchaseOrderInvoice, setPurchaseOrderInvoiceReceipts } = await import("@/lib/services/purchasing-module/invoices")

const now = "2026-08-20T12:00:00.000Z"
const userId = "user-reconciliation"

const { setProductSupplierPrice } = await import("@/lib/services/product-supplier-prices")
async function insertOrderFixture(input: {
  id: string
  worksiteId?: string
  pendingCost?: boolean
  invoiceIssueDate?: string
}) {
  const worksiteId = input.worksiteId ?? "ws-reconciliation"
  const itemId = `${input.id}-item`
  const invoiceId = `${input.id}-invoice`
  const invoiceItemId = `${input.id}-invoice-item`
  const pendingCost = input.pendingCost ?? false
  await inMemoryDb.insert(schema.purchaseOrders).values({
    id: input.id,
    code: `OC-${input.id}`,
    worksiteId,
    supplierId: "supplier-reconciliation",
    createdBy: userId,
    status: "closed",
    netAmount: pendingCost ? 0 : 100,
    taxAmount: pendingCost ? 0 : 19,
    totalAmount: pendingCost ? 0 : 119,
    createdAt: now,
    updatedAt: now,
  })
  await inMemoryDb.insert(schema.purchaseOrderItems).values({
    id: itemId,
    purchaseOrderId: input.id,
    productId: "product-reconciliation",
    quantity: pendingCost ? 1 : 2,
    quantityOfficeReceived: pendingCost ? 1 : 2,
    unitOfMeasure: pendingCost ? "servicio" : "unidad",
    unitPrice: pendingCost ? null : 50,
    subtotal: pendingCost ? null : 100,
  })
  await inMemoryDb.insert(schema.purchaseOrderInvoices).values({
    id: invoiceId,
    purchaseOrderId: input.id,
    invoiceNumber: `F-${input.id}`,
    amount: pendingCost ? 119 : 123,
    issueDate: input.invoiceIssueDate ?? "2026-08-20",
    fileName: `${input.id}.pdf`,
    filePath: `storage/purchase-orders/${input.id}.pdf`,
    uploadedBy: userId,
    uploadedAt: now,
  })
  await inMemoryDb.insert(schema.purchaseOrderInvoiceItems).values({
    id: invoiceItemId,
    invoiceId,
    purchaseOrderItemId: itemId,
    productName: "Producto conciliado",
    unitOfMeasure: pendingCost ? "servicio" : "unidad",
    quantity: pendingCost ? 1 : 2,
    unitPrice: pendingCost ? 100 : 52,
    subtotal: pendingCost ? 100 : 104,
  })
  return { itemId, invoiceId, invoiceItemId }
}

describe("servicio transaccional de conciliación OC-factura", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Revisora", email: "revisora@example.com", hashedPassword: "hash",
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-reconciliation", name: "Faena conciliación", code: "F-REC", createdAt: now, updatedAt: now },
      { id: "ws-other", name: "Faena ajena", code: "F-OTHER-REC", createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.suppliers).values({
      id: "supplier-reconciliation", name: "Proveedor conciliación", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({ id: "category-reconciliation", name: "Categoría", slug: "category-reconciliation" })
    await inMemoryDb.insert(schema.products).values({
      id: "product-reconciliation", sku: "PROD-REC", name: "Producto conciliado",
      categoryId: "category-reconciliation", unitOfMeasure: "unidad", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "product-history", sku: "PROD-HISTORY", name: "Producto historial",
      categoryId: "category-reconciliation", unitOfMeasure: "unidad", createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  it("acepta sólo la huella vigente y respeta el alcance de faena", async () => {
    await insertOrderFixture({ id: "scope" })
    const evidence = await getPurchaseOrderInvoiceReconciliation("scope")
    expect(evidence.status).toBe("needs_review")

    await expect(acceptPurchaseOrderInvoiceReconciliation({
      purchaseOrderId: "scope", fingerprint: evidence.fingerprint,
      reason: "Diferencia respaldada por la documentación adjunta.",
      userId, worksiteScope: ["ws-other"],
    })).rejects.toThrow("No tienes acceso")

    await inMemoryDb.update(schema.purchaseOrderInvoices).set({ amount: 124 })
      .where(eq(schema.purchaseOrderInvoices.id, "scope-invoice"))
    await expect(acceptPurchaseOrderInvoiceReconciliation({
      purchaseOrderId: "scope", fingerprint: evidence.fingerprint,
      reason: "Diferencia respaldada por la documentación adjunta.",
      userId, worksiteScope: "all",
    })).rejects.toThrow("La conciliación cambió")
  })

  it("recalcula atómicamente la proyección conservadora post-migración", async () => {
    await insertOrderFixture({ id: "backfill" })
    const result = await backfillPurchaseOrderInvoiceReconciliations()
    expect(result.total).toBeGreaterThanOrEqual(1)
    const [order] = await inMemoryDb.select({
      status: schema.purchaseOrders.invoiceReconciliationStatus,
      fingerprint: schema.purchaseOrders.invoiceReconciliationFingerprint,
      updatedAt: schema.purchaseOrders.invoiceReconciliationUpdatedAt,
    }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, "backfill"))
    expect(order?.status).toBe("needs_review")
    expect(order?.fingerprint).toMatch(/^v2:[a-f0-9]{64}$/)
    expect(order?.updatedAt).not.toBeNull()
  })

  it("persiste una aceptación y la eliminación posterior de la factura la vuelve histórica", async () => {
    const { invoiceId } = await insertOrderFixture({ id: "accepted" })
    const evidence = await getPurchaseOrderInvoiceReconciliation("accepted")
    const accepted = await acceptPurchaseOrderInvoiceReconciliation({
      purchaseOrderId: "accepted", fingerprint: evidence.fingerprint,
      reason: "Diferencia comercial aceptada con respaldo documental.",
      userId, userEmail: "revisora@example.com", worksiteScope: "all",
    })
    expect(accepted.status).toBe("accepted_exception")

    await deletePurchaseOrderInvoice(invoiceId, userId, "all")
    const afterDelete = await getPurchaseOrderInvoiceReconciliation("accepted")
    expect(afterDelete.status).toBe("no_invoices")
    expect(afterDelete.currentReview).toBeNull()
    expect(afterDelete.previousReview?.reason).toContain("Diferencia comercial")
  })

  it("bloquea la aceptación si la cobertura sigue parcial aunque exista una diferencia de precio", async () => {
    const { itemId, invoiceItemId, invoiceId } = await insertOrderFixture({ id: "partial-hard-difference" })
    await inMemoryDb.update(schema.purchaseOrders).set({ netAmount: 200, taxAmount: 38, totalAmount: 238 })
      .where(eq(schema.purchaseOrders.id, "partial-hard-difference"))
    await inMemoryDb.update(schema.purchaseOrderItems).set({ quantity: 4, subtotal: 200, quantityOfficeReceived: 2 })
      .where(eq(schema.purchaseOrderItems.id, itemId))
    await inMemoryDb.update(schema.purchaseOrderInvoiceItems).set({ quantity: 2, unitPrice: 52, subtotal: 104 })
      .where(eq(schema.purchaseOrderInvoiceItems.id, invoiceItemId))
    await inMemoryDb.update(schema.purchaseOrderInvoices).set({ amount: 123 })
      .where(eq(schema.purchaseOrderInvoices.id, invoiceId))

    const evidence = await getPurchaseOrderInvoiceReconciliation("partial-hard-difference")
    expect(evidence.status).toBe("needs_review")
    expect(evidence.coverage.status).toBe("partial")
    await expect(acceptPurchaseOrderInvoiceReconciliation({
      purchaseOrderId: "partial-hard-difference", fingerprint: evidence.fingerprint,
      reason: "No se puede cerrar una cobertura todavía incompleta.", userId, worksiteScope: "all",
    })).rejects.toThrow(/cobertura|facturar|parcial/i)
    expect(await inMemoryDb.select().from(schema.purchaseOrderInvoiceReconciliationReviews)
      .where(eq(schema.purchaseOrderInvoiceReconciliationReviews.purchaseOrderId, "partial-hard-difference"))).toHaveLength(0)
  })

  it("relaciona muchas facturas y recepciones sin aceptar vínculos de otra OC", async () => {
    const { invoiceId } = await insertOrderFixture({ id: "receipt-links" })
    await inMemoryDb.insert(schema.receipts).values([
      {
        id: "receipt-links-a", code: "REC-LINK-A", purchaseOrderId: "receipt-links",
        receivedBy: userId, receivedAt: now, locationType: "office", status: "closed",
      },
      {
        id: "receipt-links-b", code: "REC-LINK-B", purchaseOrderId: "receipt-links",
        receivedBy: userId, receivedAt: now, locationType: "office", status: "closed",
      },
    ])
    await inMemoryDb.insert(schema.purchaseOrderInvoices).values({
      id: "receipt-links-invoice-2", purchaseOrderId: "receipt-links", invoiceNumber: "F-LINK-2",
      amount: 0, fileName: "link-2.pdf", filePath: "storage/purchase-orders/link-2.pdf",
      uploadedBy: userId, uploadedAt: now,
    })

    await setPurchaseOrderInvoiceReceipts({
      invoiceId, purchaseOrderId: "receipt-links",
      receiptIds: ["receipt-links-a", "receipt-links-a", "receipt-links-b"],
      userId, userEmail: "revisora@example.com", worksiteScope: "all",
    })
    await setPurchaseOrderInvoiceReceipts({
      invoiceId: "receipt-links-invoice-2", purchaseOrderId: "receipt-links",
      receiptIds: ["receipt-links-a"], userId, worksiteScope: "all",
    })
    await expect(setPurchaseOrderInvoiceReceipts({
      invoiceId, purchaseOrderId: "receipt-links",
      receiptIds: ["receipt-links-a"], userId, worksiteScope: ["ws-other"],
    })).rejects.toThrow("No tienes acceso")

    const links = await inMemoryDb.select().from(schema.purchaseOrderInvoiceReceipts)
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({ invoiceId, receiptId: "receipt-links-a", linkedBy: userId }),
      expect.objectContaining({ invoiceId, receiptId: "receipt-links-b", linkedBy: userId }),
      expect.objectContaining({ invoiceId: "receipt-links-invoice-2", receiptId: "receipt-links-a", linkedBy: userId }),
    ]))

    await insertOrderFixture({ id: "receipt-links-foreign" })
    await inMemoryDb.insert(schema.receipts).values({
      id: "receipt-links-foreign-receipt", code: "REC-LINK-X", purchaseOrderId: "receipt-links-foreign",
      receivedBy: userId, receivedAt: now, locationType: "office", status: "closed",
    })
    await expect(setPurchaseOrderInvoiceReceipts({
      invoiceId, purchaseOrderId: "receipt-links", receiptIds: ["receipt-links-foreign-receipt"],
      userId, worksiteScope: "all",
    })).rejects.toThrow("misma orden")

    const preserved = await inMemoryDb.select().from(schema.purchaseOrderInvoiceReceipts)
      .where(eq(schema.purchaseOrderInvoiceReceipts.invoiceId, invoiceId))
    expect(preserved).toHaveLength(2)
    const audit = await inMemoryDb.select().from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, invoiceId))
    expect(audit.some((entry) => entry.entityType === "purchase_order_invoice_receipts")).toBe(true)

    await setPurchaseOrderInvoiceReceipts({
      invoiceId, purchaseOrderId: "receipt-links", receiptIds: ["receipt-links-b"],
      userId, worksiteScope: "all",
    })
    const edited = await inMemoryDb.select().from(schema.purchaseOrderInvoiceReceipts)
      .where(eq(schema.purchaseOrderInvoiceReceipts.invoiceId, invoiceId))
    expect(edited.map((link) => link.receiptId)).toEqual(["receipt-links-b"])

    await inMemoryDb.delete(schema.purchaseOrderInvoices)
      .where(eq(schema.purchaseOrderInvoices.id, "receipt-links-invoice-2"))
    expect(await inMemoryDb.select().from(schema.purchaseOrderInvoiceReceipts)
      .where(eq(schema.purchaseOrderInvoiceReceipts.invoiceId, "receipt-links-invoice-2"))).toHaveLength(0)

    await inMemoryDb.delete(schema.receipts).where(eq(schema.receipts.id, "receipt-links-b"))
    expect(await inMemoryDb.select().from(schema.purchaseOrderInvoiceReceipts)
      .where(eq(schema.purchaseOrderInvoiceReceipts.invoiceId, invoiceId))).toHaveLength(0)
  })

  it("registra el costo pendiente desde una línea concreta y audita el cambio", async () => {
    const { itemId, invoiceItemId } = await insertOrderFixture({ id: "pending-cost", pendingCost: true })
    const evidence = await getPurchaseOrderInvoiceReconciliation("pending-cost")
    const result = await acceptPurchaseOrderInvoiceReconciliation({
      purchaseOrderId: "pending-cost", fingerprint: evidence.fingerprint,
      reason: "Costo de servicio respaldado por esta línea de factura.",
      pendingCosts: [{ purchaseOrderItemId: itemId, invoiceItemId }],
      userId, worksiteScope: "all",
    })
    expect(result.status).toBe("matched")
    const [item] = await inMemoryDb.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.id, itemId))
    expect(item).toMatchObject({ unitPrice: 100, subtotal: 100, costRecordedBy: userId })
    const audits = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, itemId))
    expect(audits).toHaveLength(1)
  })

  it("actualiza opcionalmente el catálogo con historial y no altera la huella aceptada", async () => {
    const { invoiceItemId } = await insertOrderFixture({ id: "catalog", invoiceIssueDate: "2026-08-20" })
    await inMemoryDb.insert(schema.productSuppliers).values({
      id: "ps-catalog", productId: "product-reconciliation", supplierId: "supplier-reconciliation",
      unitPrice: 50, isPreferred: true, lastUpdated: "2026-08-01T00:00:00.000Z",
    })
    const evidence = await getPurchaseOrderInvoiceReconciliation("catalog")
    await expect(acceptPurchaseOrderInvoiceReconciliation({
      purchaseOrderId: "catalog", fingerprint: evidence.fingerprint,
      reason: "Intento de catálogo sin el permiso administrativo requerido.",
      catalogInvoiceItemIds: [invoiceItemId], canUpdateCatalog: false,
      userId, worksiteScope: "all",
    })).rejects.toThrow("No tienes permiso para actualizar precios del catálogo")

    const accepted = await acceptPurchaseOrderInvoiceReconciliation({
      purchaseOrderId: "catalog", fingerprint: evidence.fingerprint,
      reason: "Precio documental validado y aprobado para el proveedor.",
      catalogInvoiceItemIds: [invoiceItemId], canUpdateCatalog: true,
      userId, worksiteScope: "all",
    })
    expect(accepted.status).toBe("accepted_exception")
    expect(accepted.fingerprint).toBe(evidence.fingerprint)
    const [relation] = await inMemoryDb.select().from(schema.productSuppliers).where(eq(schema.productSuppliers.id, "ps-catalog"))
    expect(relation?.unitPrice).toBe(52)
    const history = await inMemoryDb.select().from(schema.productSupplierPriceHistory)
      .where(eq(schema.productSupplierPriceHistory.sourceId, invoiceItemId))
    expect(history).toEqual([expect.objectContaining({ previousPrice: 50, newPrice: 52, source: "invoice_reconciliation" })])
  })


  it("registra altas, cambios y eliminaciones de todos los escritores sólo cuando cambia el precio", async () => {
    await setProductSupplierPrice({
      productId: "product-history", supplierId: "supplier-reconciliation", unitPrice: 10,
      source: "product_form", sourceId: "form-create", userId, ensureRelation: true,
    })
    await setProductSupplierPrice({
      productId: "product-history", supplierId: "supplier-reconciliation", unitPrice: 10,
      source: "product_form", sourceId: "form-no-change", userId, ensureRelation: true,
    })
    await setProductSupplierPrice({
      productId: "product-history", supplierId: "supplier-reconciliation", unitPrice: 11,
      source: "variant_creator", sourceId: "variant-change", userId,
    })
    await setProductSupplierPrice({
      productId: "product-history", supplierId: "supplier-reconciliation", unitPrice: 12,
      source: "epp_import", sourceId: "epp-change", userId,
    })
    await setProductSupplierPrice({
      productId: "product-history", supplierId: "supplier-reconciliation", unitPrice: null,
      source: "product_form", sourceId: "form-delete", userId, deleteRelationWhenNull: true,
    })

    const history = await inMemoryDb.select().from(schema.productSupplierPriceHistory)
      .where(eq(schema.productSupplierPriceHistory.productId, "product-history"))
    expect(history.map((entry) => ({
      source: entry.source,
      sourceId: entry.sourceId,
      previousPrice: entry.previousPrice,
      newPrice: entry.newPrice,
    }))).toEqual([
      { source: "product_form", sourceId: "form-create", previousPrice: null, newPrice: 10 },
      { source: "variant_creator", sourceId: "variant-change", previousPrice: 10, newPrice: 11 },
      { source: "epp_import", sourceId: "epp-change", previousPrice: 11, newPrice: 12 },
      { source: "product_form", sourceId: "form-delete", previousPrice: 12, newPrice: null },
    ])
    const relations = await inMemoryDb.select().from(schema.productSuppliers)
      .where(eq(schema.productSuppliers.productId, "product-history"))
    expect(relations).toHaveLength(0)
  })
  it("revierte el costo completo si el precio de factura es anterior al catálogo", async () => {
    const { itemId, invoiceItemId } = await insertOrderFixture({ id: "rollback", pendingCost: true, invoiceIssueDate: "2026-07-01" })
    await inMemoryDb.update(schema.productSuppliers).set({ unitPrice: 60, lastUpdated: now })
      .where(eq(schema.productSuppliers.id, "ps-catalog"))
    const evidence = await getPurchaseOrderInvoiceReconciliation("rollback")
    await expect(acceptPurchaseOrderInvoiceReconciliation({
      purchaseOrderId: "rollback", fingerprint: evidence.fingerprint,
      reason: "Intento combinado que debe revertirse de forma completa.",
      pendingCosts: [{ purchaseOrderItemId: itemId, invoiceItemId }],
      catalogInvoiceItemIds: [invoiceItemId], canUpdateCatalog: true,
      userId, worksiteScope: "all",
    })).rejects.toThrow("anterior al último precio")
    const [item] = await inMemoryDb.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.id, itemId))
    expect(item?.unitPrice).toBeNull()
    const reviews = await inMemoryDb.select().from(schema.purchaseOrderInvoiceReconciliationReviews)
      .where(eq(schema.purchaseOrderInvoiceReconciliationReviews.purchaseOrderId, "rollback"))
    expect(reviews).toHaveLength(0)
  })
})
