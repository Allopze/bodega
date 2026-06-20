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
