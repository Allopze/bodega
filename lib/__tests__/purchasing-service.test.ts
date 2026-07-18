/**
 * Integration tests for lib/services/purchasing.ts — edge cases and error paths.
 *
 * The happy-path flow (create → issue → send) is already covered in
 * full-flow-integration.test.ts. These tests focus on validation errors,
 * state guard violations, and invoice/cancel logic.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest"
import path from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

import {
  createOrder,
  createOrdersBySupplier,
  issueOrder,
  markOrderSent,
  cancelOrder,
  closeOrder,
  createPurchaseOrderInvoice,
  deletePurchaseOrderInvoice,
} from "@/lib/services/purchasing"

const now = new Date().toISOString()
const userId = "u-purch"
let lifecycleOrderId = ""

describe("Purchasing service — edge cases", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Comprador", email: "comprador@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-purch", name: "Faena Purch", code: "F-PURCH",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({
      id: "sup-purch", name: "Proveedor Purch", rut: "76.000.001-1",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-purch", name: "Cat Purch", slug: "cat-purch", sortOrder: 1,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-purch", sku: "P-001", name: "Producto Purch",
      categoryId: "cat-purch", unitOfMeasure: "unidad", isActive: true,
      createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  // ── createOrdersBySupplier ──────────────────────────────────────────────

  describe("createOrdersBySupplier", () => {
    it("throws when orders array is empty", async () => {
      await expect(
        createOrdersBySupplier({
          worksiteId: "ws-purch", createdBy: userId,
          orders: [],
        })
      ).rejects.toThrow("No hay órdenes para crear")
    })

    it("throws when an order has no items", async () => {
      await expect(
        createOrdersBySupplier({
          worksiteId: "ws-purch", createdBy: userId,
          orders: [{ supplierId: "sup-purch", items: [] }],
        })
      ).rejects.toThrow("sin ítems")
    })

    it("rejects partial purchase quantities instead of orphaning the approved balance", async () => {
      const requestId = "req-partial-purchase-block"
      const requestItemId = "item-partial-purchase-block"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-PARTIAL-PURCHASE", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch",
        quantity: 10, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })

      await expect(createOrder({
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        items: [{
          requestItemId,
          productId: "prod-purch",
          productNameFree: null,
          quantity: 6,
          unitOfMeasure: "unidad",
          unitPrice: 1000,
        }],
      })).rejects.toThrow("cantidad completa")
    })
  })

  // ── createOrder + issueOrder + markOrderSent ────────────────────────────

  describe("createOrder → issue → send lifecycle", () => {
    it("creates an order in draft status with correct totals", async () => {
      // First, create a request item to link
      const requestId = "req-purch-lifecycle"
      const requestItemId = "item-purch-lifecycle"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-PURCH-001", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch",
        quantity: 10, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })

      lifecycleOrderId = await createOrder({
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        items: [{
          requestItemId,
          productId: "prod-purch",
          productNameFree: null,
          quantity: 10,
          unitOfMeasure: "unidad",
          unitPrice: 5000,
        }],
      })

      const order = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.id, lifecycleOrderId),
      })
      expect(order).toBeDefined()
      expect(order?.status).toBe("draft")
      expect(order?.netAmount).toBe(50000)
      expect(order?.taxAmount).toBe(9500)
      expect(order?.totalAmount).toBe(59500)

      // Request item should be in_purchase_order
      const item = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(item?.status).toBe("in_purchase_order")
    })

    it("issueOrder transitions draft → issued", async () => {
      // Find the order we just created
      await issueOrder(lifecycleOrderId, userId)

      const order = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.id, lifecycleOrderId),
      })
      expect(order?.status).toBe("issued")
      expect(order?.issuedAt).toBeTruthy()
    })

    it("issueOrder throws if order is not in draft", async () => {
      const orders = await inMemoryDb.query.purchaseOrders.findMany({
        where: eq(schema.purchaseOrders.status, "issued"),
      })
      const orderId = orders[orders.length - 1]!.id

      await expect(issueOrder(orderId, userId)).rejects.toThrow("Cannot issue")
    })

    it("issueOrder throws if order does not exist", async () => {
      await expect(issueOrder("nonexistent", userId)).rejects.toThrow("not found")
    })

    it("issueOrder rejects orders outside the provided worksite scope", async () => {
      const requestId = "req-issue-scope"
      const requestItemId = "item-issue-scope"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-ISSUE-SCOPE", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch",
        quantity: 1, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })

      const orderId = await createOrder({
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        items: [{
          requestItemId,
          productId: "prod-purch",
          productNameFree: null,
          quantity: 1,
          unitOfMeasure: "unidad",
          unitPrice: 1000,
        }],
      })

      await expect(issueOrder(orderId, userId, ["ws-other"])).rejects.toThrow("No tienes acceso")
    })

    it("markOrderSent transitions issued → sent and moves items to purchased", async () => {
      const orders = await inMemoryDb.query.purchaseOrders.findMany({
        where: eq(schema.purchaseOrders.status, "issued"),
      })
      const orderId = orders[orders.length - 1]!.id

      await markOrderSent(orderId, userId)

      const order = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.id, orderId),
      })
      expect(order?.status).toBe("sent")
      expect(order?.sentAt).toBeTruthy()

      // Request item should now be purchased
      const item = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.requestId, "req-purch-lifecycle"),
      })
      expect(item?.status).toBe("purchased")
    })

    it("markOrderSent throws if order is not in issued state", async () => {
      // The order we just sent is now in "sent" state
      const orders = await inMemoryDb.query.purchaseOrders.findMany({
        where: eq(schema.purchaseOrders.status, "sent"),
      })
      const orderId = orders[orders.length - 1]!.id

      await expect(markOrderSent(orderId, userId)).rejects.toThrow("Cannot mark")
    })

    it("markOrderSent rejects orders outside the provided worksite scope", async () => {
      const requestId = "req-send-scope"
      const requestItemId = "item-send-scope"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-SEND-SCOPE", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch",
        quantity: 1, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })
      const orderId = await createOrder({
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        items: [{
          requestItemId,
          productId: "prod-purch",
          productNameFree: null,
          quantity: 1,
          unitOfMeasure: "unidad",
          unitPrice: 1000,
        }],
      })
      await issueOrder(orderId, userId)

      await expect(markOrderSent(orderId, userId, ["ws-other"])).rejects.toThrow("No tienes acceso")
    })
  })

  // ── cancelOrder ────────────────────────────────────────────────────────

  describe("cancelOrder", () => {
    it("cancels a draft order and moves items back to pending_purchase", async () => {
      // Create a fresh order for cancellation
      const requestId = "req-cancel"
      const requestItemId = "item-cancel"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-CANCEL", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch",
        quantity: 5, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })

      const orderId = await createOrder({
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        items: [{
          requestItemId,
          productId: "prod-purch",
          productNameFree: null,
          quantity: 5,
          unitOfMeasure: "unidad",
          unitPrice: 1000,
        }],
      })

      // Item is now in_purchase_order
      const itemBefore = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(itemBefore?.status).toBe("in_purchase_order")

      await cancelOrder(orderId, userId, "Ya no se necesita")

      const order = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.id, orderId),
      })
      expect(order?.status).toBe("cancelled")

      // Item should be back to pending_purchase
      const itemAfter = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(itemAfter?.status).toBe("pending_purchase")
    })

    it("records the real previous status for each heterogeneous request item", async () => {
      const requestId = "req-cancel-heterogeneous"
      const firstItemId = "item-cancel-heterogeneous-a"
      const secondItemId = "item-cancel-heterogeneous-b"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-CANCEL-HETEROGENEOUS", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values([
        {
          id: firstItemId, requestId, productId: "prod-purch", quantity: 2,
          unitOfMeasure: "unidad", status: "pending_purchase", createdAt: now, updatedAt: now,
        },
        {
          id: secondItemId, requestId, productId: "prod-purch", quantity: 3,
          unitOfMeasure: "unidad", status: "pending_purchase", createdAt: now, updatedAt: now,
        },
      ])

      const orderId = await createOrder({
        worksiteId: "ws-purch", supplierId: "sup-purch", createdBy: userId,
        items: [
          { requestItemId: firstItemId, productId: "prod-purch", productNameFree: null, quantity: 2, unitOfMeasure: "unidad", unitPrice: 1000 },
          { requestItemId: secondItemId, productId: "prod-purch", productNameFree: null, quantity: 3, unitOfMeasure: "unidad", unitPrice: 1000 },
        ],
      })

      await inMemoryDb
        .update(schema.purchaseRequestItems)
        .set({ status: "purchased" })
        .where(eq(schema.purchaseRequestItems.id, secondItemId))

      await cancelOrder(orderId, userId, "Cancelar OC heterogénea")

      const history = await inMemoryDb
        .select({ entityId: schema.statusHistory.entityId, fromStatus: schema.statusHistory.fromStatus, toStatus: schema.statusHistory.toStatus })
        .from(schema.statusHistory)
        .where(eq(schema.statusHistory.entityType, "request_item"))
      expect(history).toEqual(expect.arrayContaining([
        { entityId: firstItemId, fromStatus: "in_purchase_order", toStatus: "pending_purchase" },
        { entityId: secondItemId, fromStatus: "purchased", toStatus: "pending_purchase" },
      ]))
    })

    it("throws if order is already received (cannot cancel)", async () => {
      // Create a fresh order, issue it, send it, then set to 'received' status
      const reqId = "req-no-cancel"
      const itemId = "item-no-cancel"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: reqId, code: "SOL-NO-CANCEL", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: itemId, requestId: reqId, productId: "prod-purch",
        quantity: 3, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })
      const oid = await createOrder({
        worksiteId: "ws-purch", supplierId: "sup-purch", createdBy: userId,
        items: [{
          requestItemId: itemId, productId: "prod-purch", productNameFree: null,
          quantity: 3, unitOfMeasure: "unidad", unitPrice: 2000,
        }],
      })
      await issueOrder(oid, userId)
      await markOrderSent(oid, userId)

      // Directly set status to 'received' to test the guard
      await inMemoryDb
        .update(schema.purchaseOrders)
        .set({ status: "received" })
        .where(eq(schema.purchaseOrders.id, oid))

      await expect(
        cancelOrder(oid, userId, "test")
      ).rejects.toThrow("Cannot cancel")
    })

    it("throws if order does not exist", async () => {
      await expect(
        cancelOrder("nonexistent", userId, "test")
      ).rejects.toThrow("not found")
    })
  })

  // ── closeOrder ─────────────────────────────────────────────────────────

  describe("closeOrder", () => {
    it("closes a partially received order and returns incomplete items to pending_purchase", async () => {
      const requestId = "req-close-partial"
      const receivedItemId = "item-close-received"
      const pendingItemId = "item-close-pending"

      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-CLOSE-PARTIAL", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "in_purchasing", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values([
        {
          id: receivedItemId, requestId, productId: "prod-purch",
          quantity: 2, unitOfMeasure: "unidad", status: "pending_purchase",
          createdAt: now, updatedAt: now,
        },
        {
          id: pendingItemId, requestId, productId: "prod-purch",
          quantity: 3, unitOfMeasure: "unidad", status: "pending_purchase",
          createdAt: now, updatedAt: now,
        },
      ])

      const orderId = await createOrder({
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        items: [
          {
            requestItemId: receivedItemId,
            productId: "prod-purch",
            productNameFree: null,
            quantity: 2,
            unitOfMeasure: "unidad",
            unitPrice: 1000,
          },
          {
            requestItemId: pendingItemId,
            productId: "prod-purch",
            productNameFree: null,
            quantity: 3,
            unitOfMeasure: "unidad",
            unitPrice: 1000,
          },
        ],
      })

      await inMemoryDb
        .update(schema.purchaseOrders)
        .set({ status: "partially_received" })
        .where(eq(schema.purchaseOrders.id, orderId))
      await inMemoryDb
        .update(schema.purchaseRequestItems)
        .set({ status: "received" })
        .where(eq(schema.purchaseRequestItems.id, receivedItemId))
      await inMemoryDb
        .update(schema.purchaseRequestItems)
        .set({ status: "purchased" })
        .where(eq(schema.purchaseRequestItems.id, pendingItemId))

      await closeOrder(orderId, userId, "Proveedor no despachará saldo")

      const order = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.id, orderId),
      })
      expect(order?.status).toBe("closed")

      const pendingItem = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, pendingItemId),
      })
      expect(pendingItem?.status).toBe("pending_purchase")

      const receivedItem = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, receivedItemId),
      })
      expect(receivedItem?.status).toBe("received")

      const request = await inMemoryDb.query.purchaseRequests.findFirst({
        where: eq(schema.purchaseRequests.id, requestId),
      })
      expect(request?.status).toBe("in_purchasing")
    })

    it("splits remaining quantity when closing an order with a partially received request item", async () => {
      const requestId = "req-close-split"
      const requestItemId = "item-close-split"

      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-CLOSE-SPLIT", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "in_purchasing", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch",
        quantity: 10, unitOfMeasure: "unidad", status: "pending_purchase",
        urgency: "critical", requiredDate: "2026-08-01",
        notes: "Talla L", sortOrder: 7,
        createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.requestItemAttributes).values({
        id: "attr-close-split",
        requestItemId,
        attributeName: "Talla",
        value: "L",
      })

      const orderId = await createOrder({
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        items: [{
          requestItemId,
          productId: "prod-purch",
          productNameFree: null,
          quantity: 10,
          unitOfMeasure: "unidad",
          unitPrice: 1000,
        }],
      })

      await inMemoryDb
        .update(schema.purchaseOrders)
        .set({ status: "partially_received" })
        .where(eq(schema.purchaseOrders.id, orderId))
      await inMemoryDb
        .update(schema.purchaseOrderItems)
        .set({ quantityOfficeReceived: 10, quantityReceived: 4, status: "partially_received" })
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))
      await inMemoryDb
        .update(schema.purchaseRequestItems)
        .set({ status: "partially_received" })
        .where(eq(schema.purchaseRequestItems.id, requestItemId))

      await closeOrder(orderId, userId, "Proveedor no despachará saldo")

      const originalItem = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(originalItem?.quantity).toBe(4)
      expect(originalItem?.status).toBe("partially_received")

      const requestItems = await inMemoryDb.query.purchaseRequestItems.findMany({
        where: eq(schema.purchaseRequestItems.requestId, requestId),
        with: { attributes: true },
      })
      const splitItem = requestItems.find((item) => item.id !== requestItemId)
      expect(splitItem).toBeDefined()
      expect(splitItem).toMatchObject({
        quantity: 6,
        status: "pending_purchase",
        productId: "prod-purch",
        urgency: "critical",
        requiredDate: "2026-08-01",
      })
      expect(splitItem?.attributes[0]).toMatchObject({ attributeName: "Talla", value: "L" })
    })
  })

  // ── createPurchaseOrderInvoice ─────────────────────────────────────────

  describe("createPurchaseOrderInvoice", () => {
    it("creates an invoice for an active order", async () => {
      const orders = await inMemoryDb.query.purchaseOrders.findMany({
        where: eq(schema.purchaseOrders.status, "sent"),
      })
      if (orders.length === 0) return // skip if no sent orders
      const orderId = orders[0]!.id

      const invoiceId = await createPurchaseOrderInvoice({
        purchaseOrderId: orderId,
        invoiceNumber: "FAC-001",
        amount: 59500,
        fileName: "fac.pdf",
        filePath: "/uploads/fac.pdf",
        uploadedBy: userId,
      })

      expect(invoiceId).toBeTruthy()
      const invoice = await inMemoryDb.query.purchaseOrderInvoices.findFirst({
        where: eq(schema.purchaseOrderInvoices.id, invoiceId),
      })
      expect(invoice).toBeDefined()
      expect(invoice?.invoiceNumber).toBe("FAC-001")
      expect(invoice?.amount).toBe(59500)
    })

    it("throws if order does not exist", async () => {
      await expect(
        createPurchaseOrderInvoice({
          purchaseOrderId: "nonexistent",
          invoiceNumber: "FAC-999",
          amount: 1000,
          fileName: "f.pdf",
          filePath: "/f.pdf",
          uploadedBy: userId,
        })
      ).rejects.toThrow("no encontrada")
    })
  })

  // ── deletePurchaseOrderInvoice ─────────────────────────────────────────

  describe("deletePurchaseOrderInvoice", () => {
    it("deletes an invoice and returns filePath", async () => {
      const invoices = await inMemoryDb.query.purchaseOrderInvoices.findMany()
      if (invoices.length === 0) return // skip if no invoices

      const invoice = invoices[0]!
      const result = await deletePurchaseOrderInvoice(invoice.id, userId)

      expect(result.filePath).toBe(invoice.filePath)

      const deleted = await inMemoryDb.query.purchaseOrderInvoices.findFirst({
        where: eq(schema.purchaseOrderInvoices.id, invoice.id),
      })
      expect(deleted).toBeUndefined()
    })

    it("throws if invoice does not exist", async () => {
      await expect(
        deletePurchaseOrderInvoice("nonexistent", userId)
      ).rejects.toThrow("no encontrada")
    })
  })
})
