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
import { and, eq, ne } from "drizzle-orm"
import * as schema from "@/db/schema"
import * as audit from "@/lib/audit"
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
  issueAndSendOrder,
  cancelOrder,
  deleteOrder,
  closeOrder,
  createPurchaseOrderInvoice,
  createPurchaseOrderInvoiceFromDte,
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
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-purch-other", name: "Faena Ajena", code: "F-OTHER",
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

    it("rejects the same request item across supplier groups before opening a partial purchase", async () => {
      const repeatedItem = {
        requestItemId: "item-duplicated-across-suppliers",
        productId: "prod-purch",
        productNameFree: null,
        quantity: 1,
        unitOfMeasure: "unidad",
        unitPrice: 1_000,
      }

      await expect(createOrdersBySupplier({
        worksiteId: "ws-purch",
        createdBy: userId,
        orders: [
          { supplierId: "sup-purch", items: [repeatedItem] },
          { supplierId: "sup-purch", items: [repeatedItem] },
        ],
      })).rejects.toThrow("mismo ítem de solicitud más de una vez")
    })

    it("rejects buying more than the approved quantity", async () => {
      const requestId = "req-over-purchase-block"
      const requestItemId = "item-over-purchase-block"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-OVER-PURCHASE", worksiteId: "ws-purch",
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
          quantity: 11,
          unitOfMeasure: "unidad",
          unitPrice: 1000,
        }],
      })).rejects.toThrow("no puede superar")
    })

    it("rejects an item from another worksite inside the creation transaction", async () => {
      const requestId = "req-cross-worksite"
      const requestItemId = "item-cross-worksite"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-CROSS-WS", worksiteId: "ws-purch-other",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch",
        quantity: 1, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })

      await expect(createOrdersBySupplier({
        worksiteId: "ws-purch", worksiteScope: ["ws-purch"], createdBy: userId,
        orders: [{ supplierId: "sup-purch", items: [{
          requestItemId, productId: null, productNameFree: "Manipulado", quantity: 1,
          unitOfMeasure: "caja", unitPrice: 1000,
        }] }],
      })).rejects.toThrow(/otra faena/i)

      const item = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(item?.status).toBe("pending_purchase")
    })

    it("derives product identity and unit from the locked request item", async () => {
      const requestId = "req-immutable-purchase-item"
      const requestItemId = "item-immutable-purchase-item"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-IMMUTABLE-ITEM", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch",
        quantity: 1, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })

      const orderId = await createOrder({
        worksiteId: "ws-purch", supplierId: "sup-purch", createdBy: userId,
        items: [{
          requestItemId, productId: null, productNameFree: "Producto manipulado", quantity: 1,
          unitOfMeasure: "caja", unitPrice: 1000,
        }],
      })
      const [orderItem] = await inMemoryDb.select().from(schema.purchaseOrderItems)
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))
      expect(orderItem).toMatchObject({ productId: "prod-purch", productNameFree: null, unitOfMeasure: "unidad" })
    })

    it("buying less than approved splits the remainder into a sibling item that stays pending", async () => {
      const requestId = "req-partial-purchase-split"
      const requestItemId = "item-partial-purchase-split"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-PARTIAL-SPLIT", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch",
        quantity: 10, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })

      await createOrder({
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
      })

      const purchasedItem = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(purchasedItem?.quantity).toBe(6)
      expect(purchasedItem?.status).toBe("in_purchase_order")

      const siblings = await inMemoryDb.query.purchaseRequestItems.findMany({
        where: eq(schema.purchaseRequestItems.requestId, requestId),
      })
      expect(siblings.length).toBe(2)
      const remainderItem = siblings.find((i) => i.id !== requestItemId)
      expect(remainderItem?.quantity).toBe(4)
      expect(remainderItem?.status).toBe("pending_purchase")

      // La suma comprada + remanente debe cuadrar con la cantidad aprobada original.
      expect((purchasedItem?.quantity ?? 0) + (remainderItem?.quantity ?? 0)).toBe(10)
    })
  })

  // ── createOrder + issueAndSendOrder ─────────────────────────────────────

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
      const [createdEvent] = await inMemoryDb.select().from(schema.operationalActivityEvents)
        .where(eq(schema.operationalActivityEvents.entityId, lifecycleOrderId))
      expect(createdEvent).toMatchObject({
        eventType: "purchase_order.created",
        module: "compras",
        worksiteId: "ws-purch",
        actorUserId: userId,
      })

      // Request item should be in_purchase_order
      const item = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(item?.status).toBe("in_purchase_order")
    })

    it("issueAndSendOrder transitions draft → sent and moves items to purchased", async () => {
      await issueAndSendOrder(lifecycleOrderId, userId)

      const order = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.id, lifecycleOrderId),
      })
      expect(order?.status).toBe("sent")
      // Emitir y enviar es un solo acto: ambas marcas de tiempo quedan escritas.
      expect(order?.issuedAt).toBeTruthy()
      expect(order?.sentAt).toBeTruthy()

      const item = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.requestId, "req-purch-lifecycle"),
      })
      expect(item?.status).toBe("purchased")

      const events = await inMemoryDb.select().from(schema.operationalActivityEvents)
        .where(eq(schema.operationalActivityEvents.entityId, lifecycleOrderId))
      expect(events.map((event) => event.eventType)).toEqual([
        "purchase_order.created",
        "purchase_order.sent",
      ])
    })

    it("issueAndSendOrder throws if order is not in draft", async () => {
      const orders = await inMemoryDb.query.purchaseOrders.findMany({
        where: eq(schema.purchaseOrders.status, "sent"),
      })
      const orderId = orders[orders.length - 1]!.id

      await expect(issueAndSendOrder(orderId, userId)).rejects.toThrow("Cannot issue and send")
    })

    it("issueAndSendOrder throws if order does not exist", async () => {
      await expect(issueAndSendOrder("nonexistent", userId)).rejects.toThrow("not found")
    })

    it("issueAndSendOrder rejects orders outside the provided worksite scope", async () => {
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

      await expect(issueAndSendOrder(orderId, userId, ["ws-other"])).rejects.toThrow("No tienes acceso")
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

    it("does not reopen an item while a different active OC still covers it", async () => {
      const requestId = "req-cancel-covered-elsewhere"
      const requestItemId = "item-cancel-covered-elsewhere"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-CANCEL-COVERED", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal", status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch", quantity: 5,
        unitOfMeasure: "unidad", status: "pending_purchase", createdAt: now, updatedAt: now,
      })
      const cancelledOrderId = await createOrder({
        worksiteId: "ws-purch", supplierId: "sup-purch", createdBy: userId,
        items: [{ requestItemId, productId: "prod-purch", productNameFree: null, quantity: 5, unitOfMeasure: "unidad", unitPrice: 1000 }],
      })
      // Historical duplicate coverage is possible in data imported before the
      // new create guard. Cancellation must not compound that inconsistency by
      // advertising the item as available again.
      await inMemoryDb.insert(schema.purchaseOrders).values({
        id: "po-other-active-coverage", code: "OC-OTHER-ACTIVE", worksiteId: "ws-purch", supplierId: "sup-purch",
        createdBy: userId, status: "draft", netAmount: 0, taxAmount: 0, totalAmount: 0, createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseOrderItems).values({
        id: "poi-other-active-coverage", purchaseOrderId: "po-other-active-coverage", requestItemId,
        productId: "prod-purch", quantity: 5, unitOfMeasure: "unidad", unitPrice: 1000, discount: 0, subtotal: 5000,
        status: "issued", sortOrder: 1,
      })

      await cancelOrder(cancelledOrderId, userId, "La otra OC sigue vigente")

      const itemAfter = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(itemAfter?.status).toBe("in_purchase_order")
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
      await issueAndSendOrder(oid, userId)

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

  describe("deleteOrder", () => {
    it("does not return a request item to purchase when another active OC covers it", async () => {
      const requestId = "req-delete-covered-elsewhere"
      const requestItemId = "item-delete-covered-elsewhere"
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-DELETE-COVERED", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal", status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch", quantity: 2,
        unitOfMeasure: "unidad", status: "pending_purchase", createdAt: now, updatedAt: now,
      })
      const deletedOrderId = await createOrder({
        worksiteId: "ws-purch", supplierId: "sup-purch", createdBy: userId,
        items: [{ requestItemId, productId: "prod-purch", productNameFree: null, quantity: 2, unitOfMeasure: "unidad", unitPrice: 1000 }],
      })
      await inMemoryDb.insert(schema.purchaseOrders).values({
        id: "po-delete-other-active", code: "OC-DELETE-OTHER-ACTIVE", worksiteId: "ws-purch", supplierId: "sup-purch",
        createdBy: userId, status: "draft", netAmount: 0, taxAmount: 0, totalAmount: 0, createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseOrderItems).values({
        id: "poi-delete-other-active", purchaseOrderId: "po-delete-other-active", requestItemId,
        productId: "prod-purch", quantity: 2, unitOfMeasure: "unidad", unitPrice: 1000, discount: 0, subtotal: 2000,
        status: "issued", sortOrder: 1,
      })

      await deleteOrder(deletedOrderId, userId)

      const itemAfter = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(itemAfter?.status).toBe("in_purchase_order")
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
      // office == faena (ambos 4/10): sin excedente en oficina, así que el
      // guard de LOG-7 no bloquea — es un cierre parcial legítimo, "el
      // proveedor no va a despachar el resto".
      // ARQ-12: purchase_order_items.status sólo describe 'issued'/'cancelled'
      // (activo/anulado) — la recepción se trackea con los contadores
      // quantityOfficeReceived/quantityReceived, no con este status.
      await inMemoryDb
        .update(schema.purchaseOrderItems)
        .set({ quantityOfficeReceived: 4, quantityReceived: 4 })
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

    it("splits the remainder even if the item never left the purchase stage", async () => {
      // El hueco: la clasificación del cierre eran dos `filter` con listas de
      // estado escritas a mano, y una línea con recepción parcial cuyo ítem
      // siguiera en 'purchased' no caía en ninguna. Ni se dividía ni se
      // liberaba: el saldo desaparecía y la línea quedaba viva sobre una OC
      // cerrada, o sea cobertura fantasma sobre un ítem que nadie iba a
      // comprar. Ahora el destino lo decide sólo cuánto llegó.
      const requestId = "req-close-stuck"
      const requestItemId = "item-close-stuck"

      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-CLOSE-STUCK", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "in_purchasing", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch",
        quantity: 10, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })

      const orderId = await createOrder({
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        items: [{
          requestItemId, productId: "prod-purch", productNameFree: null,
          quantity: 10, unitOfMeasure: "unidad", unitPrice: 1000,
        }],
      })

      await inMemoryDb
        .update(schema.purchaseOrders)
        .set({ status: "partially_received" })
        .where(eq(schema.purchaseOrders.id, orderId))
      await inMemoryDb
        .update(schema.purchaseOrderItems)
        .set({ quantityOfficeReceived: 4, quantityReceived: 4 })
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))
      // El ítem se quedó en 'purchased': llegó mercadería pero su transición
      // no corrió (una recepción a medio camino, un dato migrado).
      await inMemoryDb
        .update(schema.purchaseRequestItems)
        .set({ status: "purchased" })
        .where(eq(schema.purchaseRequestItems.id, requestItemId))

      await closeOrder(orderId, userId, "Proveedor no despachará saldo")

      const originalItem = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(originalItem?.quantity).toBe(4)

      const requestItems = await inMemoryDb.query.purchaseRequestItems.findMany({
        where: eq(schema.purchaseRequestItems.requestId, requestId),
      })
      const splitItem = requestItems.find((item) => item.id !== requestItemId)
      expect(splitItem, "el saldo de 6 tiene que volver a la cola, no desaparecer").toBeDefined()
      expect(splitItem).toMatchObject({ quantity: 6, status: "pending_purchase" })
    })

    it("releases a not-received line whose item is no longer purchasable without faking history", async () => {
      // Cierre de una OC cuyo ítem ya fue rechazado (la solicitud se canceló
      // mientras la orden seguía abierta). La línea no recibió nada, así que se
      // anula; el ítem no se toca —sigue rechazado— y por lo tanto tampoco se
      // escribe una transición que nunca ocurrió.
      const requestId = "req-close-rejected"
      const keptItemId = "item-close-kept"
      const rejectedItemId = "item-close-rejected"

      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-CLOSE-REJ", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "in_purchasing", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values([
        {
          id: keptItemId, requestId, productId: "prod-purch",
          quantity: 2, unitOfMeasure: "unidad", status: "pending_purchase",
          createdAt: now, updatedAt: now,
        },
        {
          id: rejectedItemId, requestId, productId: "prod-purch",
          quantity: 3, unitOfMeasure: "unidad", status: "pending_purchase",
          createdAt: now, updatedAt: now,
        },
      ])

      const orderId = await createOrder({
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        items: [
          { requestItemId: keptItemId, productId: "prod-purch", productNameFree: null, quantity: 2, unitOfMeasure: "unidad", unitPrice: 1000 },
          { requestItemId: rejectedItemId, productId: "prod-purch", productNameFree: null, quantity: 3, unitOfMeasure: "unidad", unitPrice: 1000 },
        ],
      })

      await inMemoryDb
        .update(schema.purchaseOrders)
        .set({ status: "partially_received" })
        .where(eq(schema.purchaseOrders.id, orderId))
      await inMemoryDb
        .update(schema.purchaseRequestItems)
        .set({ status: "received" })
        .where(eq(schema.purchaseRequestItems.id, keptItemId))
      await inMemoryDb
        .update(schema.purchaseRequestItems)
        .set({ status: "rejected" })
        .where(eq(schema.purchaseRequestItems.id, rejectedItemId))

      await closeOrder(orderId, userId, "Solicitud cancelada")

      const rejectedItem = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, rejectedItemId),
      })
      expect(rejectedItem?.status).toBe("rejected")

      // Su línea queda anulada: nada llegó y la OC está cerrada, así que no
      // puede seguir contando como cobertura activa.
      const lines = await inMemoryDb.query.purchaseOrderItems.findMany({
        where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
      })
      expect(lines.find((line) => line.requestItemId === rejectedItemId)?.status).toBe("cancelled")

      const history = await inMemoryDb.query.statusHistory.findMany({
        where: eq(schema.statusHistory.entityId, rejectedItemId),
      })
      expect(
        history.some((row) => row.toStatus === "pending_purchase"),
        "no se debe trazar una transición que el WHERE no aplicó",
      ).toBe(false)
    })

    it("blocks closing an order with merchandise received at office but not yet at faena (LOG-7/DAT-17)", async () => {
      const requestId = "req-close-office-excess"
      const requestItemId = "item-close-office-excess"

      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: requestId, code: "SOL-CLOSE-OFFICE", worksiteId: "ws-purch",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "in_purchasing", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: requestItemId, requestId, productId: "prod-purch",
        quantity: 10, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })

      const orderId = await createOrder({
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        items: [{
          requestItemId, productId: "prod-purch", productNameFree: null,
          quantity: 10, unitOfMeasure: "unidad", unitPrice: 1000,
        }],
      })

      // Las 10 llegaron a oficina; nada llegó a faena todavía.
      await inMemoryDb
        .update(schema.purchaseOrders)
        .set({ status: "office_received" })
        .where(eq(schema.purchaseOrders.id, orderId))
      await inMemoryDb
        .update(schema.purchaseOrderItems)
        .set({ quantityOfficeReceived: 10, quantityReceived: 0 })
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))

      await expect(closeOrder(orderId, userId, "Cerrar de todos modos"))
        .rejects.toThrow("hay mercadería recibida en oficina que aún no llega a faena")

      // No mutó nada: la orden sigue abierta y el ítem no volvió a pending_purchase.
      const order = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.id, orderId),
      })
      expect(order?.status).toBe("office_received")

      const item = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(item?.status).toBe("in_purchase_order")
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

      await expect(createPurchaseOrderInvoice({
        purchaseOrderId: orderId,
        invoiceNumber: "FAC-001",
        amount: 59500,
        fileName: "fac-duplicate.pdf",
        filePath: "/uploads/fac-duplicate.pdf",
        uploadedBy: userId,
      })).rejects.toThrow("Ya existe una factura con ese folio")
    })

    it("rejects invoice lines that belong to another purchase order", async () => {
      const targetOrder = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.status, "sent"),
      })
      expect(targetOrder).toBeDefined()
      const foreignItem = await inMemoryDb.query.purchaseOrderItems.findFirst({
        where: ne(schema.purchaseOrderItems.purchaseOrderId, targetOrder!.id),
      })
      expect(foreignItem).toBeDefined()

      await expect(createPurchaseOrderInvoice({
        purchaseOrderId: targetOrder!.id,
        invoiceNumber: "FAC-CROSS-OC",
        amount: 1000,
        fileName: "cross.pdf",
        filePath: "/uploads/cross.pdf",
        uploadedBy: userId,
        items: [{
          purchaseOrderItemId: foreignItem!.id,
          productName: "Línea ajena",
          quantity: 1,
          unitPrice: 1000,
          subtotal: 1000,
        }],
      })).rejects.toThrow("no pertenece a esta OC")
    })

    it("blocks a manual invoice whose extracted RUT differs and audits an absent RUT as unverified", async () => {
      const targetOrder = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.status, "sent"),
      })
      expect(targetOrder).toBeDefined()

      await expect(createPurchaseOrderInvoice({
        purchaseOrderId: targetOrder!.id,
        invoiceNumber: "FAC-RUT-DISTINTO",
        amount: 1000,
        fileName: "rut-distinto.pdf",
        filePath: "/uploads/rut-distinto.pdf",
        uploadedBy: userId,
        supplierIdentity: {
          documentSupplierRut: "77.777.777-7",
          status: "verified",
          source: "pdf_text",
        },
      })).rejects.toThrow("RUT de la factura no corresponde")

      const invoiceId = await createPurchaseOrderInvoice({
        purchaseOrderId: targetOrder!.id,
        invoiceNumber: "FAC-RUT-AUSENTE",
        amount: 1000,
        fileName: "rut-ausente.pdf",
        filePath: "/uploads/rut-ausente.pdf",
        uploadedBy: userId,
        supplierIdentity: {
          documentSupplierRut: null,
          status: "unverified",
          source: "manual",
        },
      })
      const invoice = await inMemoryDb.query.purchaseOrderInvoices.findFirst({
        where: eq(schema.purchaseOrderInvoices.id, invoiceId),
      })
      expect(invoice).toMatchObject({
        documentSupplierRut: null,
        supplierIdentityStatus: "unverified",
        supplierIdentitySource: "manual",
      })
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

    it("creates a DTE-backed invoice atomically, preserves its header total and unlinks it on deletion", async () => {
      const orderId = "oc-dte-auto-invoice-1"
      const dteId = "dte-auto-invoice-1"
      const issueDate = now.slice(0, 10)
      await inMemoryDb.insert(schema.purchaseOrders).values({
        id: orderId,
        code: "OC-DTE-AUTO-1",
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        status: "sent",
        netAmount: 100000,
        taxAmount: 19000,
        totalAmount: 119000,
        createdAt: now,
        updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseOrderItems).values({
        id: "oc-dte-auto-item-1",
        purchaseOrderId: orderId,
        productId: "prod-purch",
        productNameFree: null,
        quantity: 10,
        unitOfMeasure: "unidad",
        unitPrice: 10000,
        subtotal: 100000,
        status: "issued",
      })
      await inMemoryDb.insert(schema.dteDocuments).values({
        id: dteId,
        tipoDte: "33",
        folio: 456789,
        rutEmisor: "76.000.001-1",
        razonSocialEmisor: "Proveedor Purch",
        fechaEmision: issueDate,
        montoTotal: 119000,
        codEmp: "433",
        periodo: issueDate.slice(0, 7),
        portalRecordId: "9000001",
        rawHash: "dte-auto-invoice-1-hash",
      })
      await inMemoryDb.insert(schema.dteDocumentItems).values({
        id: "dte-line:dte-auto-invoice-1:1",
        dteDocumentId: dteId,
        lineNumber: 1,
        productCode: "PROV-CASCO-01",
        productName: "Casco proveedor",
        unitOfMeasure: "UN",
        quantity: 10,
        unitPrice: 10000,
        amount: 100000,
      })

      const invoiceId = await createPurchaseOrderInvoiceFromDte({
        purchaseOrderId: orderId,
        dteDocumentId: dteId,
        invoiceNumber: "456789",
        amount: 119000,
        amountAuthority: "document_header",
        issueDate,
        fileName: "DTE-33-456789.pdf",
        filePath: "storage/purchase-orders/dte-33-456789.pdf",
        fileSize: 8,
        mimeType: "application/pdf",
        uploadedBy: userId,
        dteIdentity: {
          tipoDte: "33",
          invoiceNumber: "456789",
          issueDate,
          supplierRut: "76.000.001-1",
          totalAmount: 119000,
        },
        items: [{
          sourceDteDocumentItemId: "dte-line:dte-auto-invoice-1:1",
          productName: "Producto Purch",
          productCode: "P-001",
          unitOfMeasure: "UN",
          quantity: 10,
          unitPrice: 10000,
          // Neto de la línea: no debe reemplazar MntTotal ($119.000 con IVA).
          subtotal: 100000,
        }],
        lineResolutions: [{
          dteDocumentItemId: "dte-line:dte-auto-invoice-1:1",
          purchaseOrderItemId: "oc-dte-auto-item-1",
          rememberAlias: true,
        }],
      })

      const invoice = await inMemoryDb.query.purchaseOrderInvoices.findFirst({
        where: eq(schema.purchaseOrderInvoices.id, invoiceId),
        with: { items: true },
      })
      const dte = await inMemoryDb.query.dteDocuments.findFirst({
        where: eq(schema.dteDocuments.id, dteId),
      })
      expect(invoice?.amount).toBe(119000)
      expect(invoice?.items).toHaveLength(1)
      expect(invoice?.items[0]?.purchaseOrderItemId).toBeTruthy()
      expect(invoice?.items[0]?.sourceDteDocumentItemId).toBe("dte-line:dte-auto-invoice-1:1")
      const alias = await inMemoryDb.query.supplierProductAliases.findFirst({
        where: eq(schema.supplierProductAliases.supplierId, "sup-purch"),
      })
      expect(alias).toMatchObject({
        productId: "prod-purch",
        supplierProductCode: "PROV-CASCO-01",
        normalizedCode: "PROVCASCO01",
        confirmedBy: userId,
      })
      expect(dte?.purchaseOrderInvoiceId).toBe(invoiceId)

      await expect(createPurchaseOrderInvoiceFromDte({
        purchaseOrderId: orderId,
        dteDocumentId: dteId,
        invoiceNumber: "456790",
        amount: 119000,
        amountAuthority: "document_header",
        issueDate,
        fileName: "DTE-33-456789-copy.pdf",
        filePath: "storage/purchase-orders/dte-33-456789-copy.pdf",
        uploadedBy: userId,
        dteIdentity: {
          tipoDte: "33",
          invoiceNumber: "456789",
          issueDate,
          supplierRut: "76.000.001-1",
          totalAmount: 119000,
        },
        items: [{
          productName: "Producto Purch",
          productCode: "P-001",
          unitOfMeasure: "UN",
          quantity: 10,
          unitPrice: 10000,
          subtotal: 100000,
        }],
      })).rejects.toThrow("ya fue usado")

      await deletePurchaseOrderInvoice(invoiceId, userId)
      const unlinked = await inMemoryDb.query.dteDocuments.findFirst({
        where: eq(schema.dteDocuments.id, dteId),
      })
      expect(unlinked?.purchaseOrderInvoiceId).toBeNull()

      // Fail after the invoice, its lines, and the guarded DTE update have all
      // been issued. The transaction must roll every one of them back.
      const auditFailure = vi.spyOn(audit, "recordAudit")
        .mockRejectedValueOnce(new Error("fallo de auditoría simulado"))
      try {
        await expect(createPurchaseOrderInvoiceFromDte({
          purchaseOrderId: orderId,
          dteDocumentId: dteId,
          invoiceNumber: "456791",
          amount: 119000,
          amountAuthority: "document_header",
          issueDate,
          fileName: "DTE-33-456791.pdf",
          filePath: "storage/purchase-orders/dte-33-456791.pdf",
          uploadedBy: userId,
          dteIdentity: {
            tipoDte: "33",
            invoiceNumber: "456789",
            issueDate,
            supplierRut: "76.000.001-1",
            totalAmount: 119000,
          },
          items: [{
            productName: "Producto Purch",
            productCode: "P-001",
            unitOfMeasure: "UN",
            quantity: 10,
            unitPrice: 10000,
            subtotal: 100000,
          }],
        })).rejects.toThrow("fallo de auditoría simulado")
      } finally {
        auditFailure.mockRestore()
      }

      const rolledBackInvoice = await inMemoryDb.query.purchaseOrderInvoices.findFirst({
        where: and(
          eq(schema.purchaseOrderInvoices.purchaseOrderId, orderId),
          eq(schema.purchaseOrderInvoices.invoiceNumber, "456791"),
        ),
      })
      const rolledBackItems = await inMemoryDb
        .select({ id: schema.purchaseOrderInvoiceItems.id })
        .from(schema.purchaseOrderInvoiceItems)
        .innerJoin(
          schema.purchaseOrderInvoices,
          eq(schema.purchaseOrderInvoiceItems.invoiceId, schema.purchaseOrderInvoices.id),
        )
        .where(and(
          eq(schema.purchaseOrderInvoices.purchaseOrderId, orderId),
          eq(schema.purchaseOrderInvoices.invoiceNumber, "456791"),
        ))
      const dteAfterRollback = await inMemoryDb.query.dteDocuments.findFirst({
        where: eq(schema.dteDocuments.id, dteId),
      })
      expect(rolledBackInvoice).toBeUndefined()
      expect(rolledBackItems).toEqual([])
      expect(dteAfterRollback?.purchaseOrderInvoiceId).toBeNull()
    })

    // Las resoluciones explícitas son lo que confirma el operador en el diálogo
    // "Revisar asociaciones". Sus ocho rechazos no tenían ninguna prueba: sólo
    // se ejercitaba el camino feliz, y son justo los que ahora llegan a la
    // pantalla con su texto (antes se tapaban con un mensaje único).
    describe("resoluciones de línea explícitas", () => {
      const issueDate = now.slice(0, 10)
      // (tipo, folio, RUT, empresa) es único: derivar el folio del nombre hacía
      // colisionar cualquier par de sufijos parecidos.
      let nextFolio = 470001

      // Un segundo producto de catálogo: el conflicto de alias sólo existe entre
      // dos productos distintos del MISMO proveedor.
      beforeAll(async () => {
        await inMemoryDb.insert(schema.products).values({
          id: "prod-purch-2", sku: "P-002", name: "Producto Purch Dos",
          categoryId: "cat-purch", unitOfMeasure: "unidad", isActive: true,
          createdAt: now, updatedAt: now,
        }).onConflictDoNothing()
      })

      /** OC + DTE + dos líneas persistidas, listos para resolver. */
      async function seedResolvableDte(suffix: string) {
        const orderId = `oc-dte-res-${suffix}`
        const dteId = `dte-res-${suffix}`
        const folio = nextFolio++
        await inMemoryDb.insert(schema.purchaseOrders).values({
          id: orderId,
          code: `OC-DTE-RES-${suffix.toUpperCase()}`,
          worksiteId: "ws-purch",
          supplierId: "sup-purch",
          createdBy: userId,
          status: "sent",
          netAmount: 100000,
          taxAmount: 19000,
          totalAmount: 119000,
          createdAt: now,
          updatedAt: now,
        })
        await inMemoryDb.insert(schema.purchaseOrderItems).values([
          {
            id: `${orderId}-item-1`,
            purchaseOrderId: orderId,
            productId: "prod-purch",
            productNameFree: null,
            quantity: 10,
            unitOfMeasure: "unidad",
            unitPrice: 10000,
            subtotal: 100000,
            status: "issued",
          },
          {
            id: `${orderId}-item-2`,
            purchaseOrderId: orderId,
            productId: "prod-purch-2",
            productNameFree: null,
            quantity: 5,
            unitOfMeasure: "unidad",
            unitPrice: 2000,
            subtotal: 10000,
            status: "issued",
          },
        ])
        await inMemoryDb.insert(schema.dteDocuments).values({
          id: dteId,
          tipoDte: "33",
          folio,
          rutEmisor: "76.000.001-1",
          razonSocialEmisor: "Proveedor Purch",
          fechaEmision: issueDate,
          montoTotal: 119000,
          codEmp: "433",
          periodo: issueDate.slice(0, 7),
          portalRecordId: `9${folio}`,
          rawHash: `${dteId}-hash`,
        })
        await inMemoryDb.insert(schema.dteDocumentItems).values([
          {
            id: `dte-line:${dteId}:1`,
            dteDocumentId: dteId,
            lineNumber: 1,
            productCode: "PROV-CASCO-01",
            productName: "Casco proveedor",
            unitOfMeasure: "UN",
            quantity: 10,
            unitPrice: 10000,
            amount: 100000,
          },
          {
            id: `dte-line:${dteId}:2`,
            dteDocumentId: dteId,
            lineNumber: 2,
            productCode: "PROV-CASCO-02",
            productName: "Casco proveedor dos",
            unitOfMeasure: "UN",
            quantity: 5,
            unitPrice: 2000,
            amount: 10000,
          },
        ])
        return { orderId, dteId, folio }
      }

      type DteInvoiceItems = Parameters<typeof createPurchaseOrderInvoiceFromDte>[0]["items"]

      function attach(
        seeded: { orderId: string; dteId: string; folio: number },
        lineResolutions: Array<{ dteDocumentItemId: string; purchaseOrderItemId: string | null; rememberAlias: boolean }>,
        items?: DteInvoiceItems,
      ) {
        return createPurchaseOrderInvoiceFromDte({
          purchaseOrderId: seeded.orderId,
          dteDocumentId: seeded.dteId,
          invoiceNumber: String(seeded.folio),
          amount: 119000,
          amountAuthority: "document_header",
          issueDate,
          fileName: "DTE.pdf",
          filePath: "storage/purchase-orders/dte.pdf",
          uploadedBy: userId,
          dteIdentity: {
            tipoDte: "33",
            invoiceNumber: String(seeded.folio),
            issueDate,
            supplierRut: "76.000.001-1",
            totalAmount: 119000,
          },
          lineResolutions,
          items: items ?? [
            {
              sourceDteDocumentItemId: `dte-line:${seeded.dteId}:1`,
              productName: "Casco proveedor",
              unitOfMeasure: "UN",
              quantity: 10,
              unitPrice: 10000,
              subtotal: 100000,
            },
            {
              sourceDteDocumentItemId: `dte-line:${seeded.dteId}:2`,
              productName: "Casco proveedor dos",
              unitOfMeasure: "UN",
              quantity: 5,
              unitPrice: 2000,
              subtotal: 10000,
            },
          ],
        })
      }

      it("rechaza dos líneas del DTE apuntando al mismo ítem de la OC", async () => {
        const seeded = await seedResolvableDte("dup")

        await expect(attach(seeded, [
          { dteDocumentItemId: `dte-line:${seeded.dteId}:1`, purchaseOrderItemId: `${seeded.orderId}-item-1`, rememberAlias: false },
          { dteDocumentItemId: `dte-line:${seeded.dteId}:2`, purchaseOrderItemId: `${seeded.orderId}-item-1`, rememberAlias: false },
        ])).rejects.toThrow("No puedes asociar dos líneas DTE al mismo ítem de la OC")

        const dte = await inMemoryDb.query.dteDocuments.findFirst({ where: eq(schema.dteDocuments.id, seeded.dteId) })
        expect(dte?.purchaseOrderInvoiceId).toBeNull()
      })

      it("rechaza una resolución que apunta a un ítem de otra OC", async () => {
        const seeded = await seedResolvableDte("ajena")
        const otra = await seedResolvableDte("otra")

        await expect(attach(seeded, [
          { dteDocumentItemId: `dte-line:${seeded.dteId}:1`, purchaseOrderItemId: `${otra.orderId}-item-1`, rememberAlias: false },
          { dteDocumentItemId: `dte-line:${seeded.dteId}:2`, purchaseOrderItemId: null, rememberAlias: false },
        ])).rejects.toThrow("Una resolución no pertenece a esta OC")
      })

      it("rechaza una resolución que no corresponde a una línea de este DTE", async () => {
        const seeded = await seedResolvableDte("fantasma")

        await expect(attach(seeded, [
          { dteDocumentItemId: `dte-line:${seeded.dteId}:1`, purchaseOrderItemId: null, rememberAlias: false },
          { dteDocumentItemId: `dte-line:${seeded.dteId}:99`, purchaseOrderItemId: null, rememberAlias: false },
        ])).rejects.toThrow("Una resolución no pertenece a este DTE")
      })

      it("exige una resolución por línea del XML: ninguna puede quedar sin decidir", async () => {
        const seeded = await seedResolvableDte("faltante")

        await expect(attach(seeded, [
          { dteDocumentItemId: `dte-line:${seeded.dteId}:1`, purchaseOrderItemId: null, rememberAlias: false },
        ])).rejects.toThrow("Debes resolver todas las líneas del DTE")
      })

      // "Recordar" es una preferencia, pero contradecir un alias ya confirmado
      // aborta la factura entera. El mensaje nombra la línea justamente para que
      // se sepa cuál desmarcar.
      it("nombra la línea cuando el alias a recordar contradice uno confirmado", async () => {
        const primera = await seedResolvableDte("alias1")
        await attach(primera, [
          { dteDocumentItemId: `dte-line:${primera.dteId}:1`, purchaseOrderItemId: `${primera.orderId}-item-1`, rememberAlias: true },
          { dteDocumentItemId: `dte-line:${primera.dteId}:2`, purchaseOrderItemId: null, rememberAlias: false },
        ])

        // Mismo alias del proveedor (código y nombre de la línea 1), ahora
        // apuntado a otro producto del catálogo: no puede reescribirse solo.
        const segunda = await seedResolvableDte("alias2")
        await expect(attach(segunda, [
          { dteDocumentItemId: `dte-line:${segunda.dteId}:1`, purchaseOrderItemId: `${segunda.orderId}-item-2`, rememberAlias: true },
          { dteDocumentItemId: `dte-line:${segunda.dteId}:2`, purchaseOrderItemId: null, rememberAlias: false },
        ])).rejects.toThrow("Casco proveedor")
      })
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

    // Una OC en `sent` admite factura Y admite anulación. Si además se bloquea
    // borrar la factura de una OC anulada, el DTE queda atrapado: es la única
    // ruta de desvinculación del repo y el índice único impide reusarlo.
    it("permite quitar la factura de una OC anulada y devuelve el DTE al pozo", async () => {
      const orderId = "oc-dte-cancelada-1"
      const dteId = "dte-oc-cancelada-1"
      const issueDate = now.slice(0, 10)
      await inMemoryDb.insert(schema.purchaseOrders).values({
        id: orderId,
        code: "OC-DTE-CANCEL-1",
        worksiteId: "ws-purch",
        supplierId: "sup-purch",
        createdBy: userId,
        status: "sent",
        netAmount: 100000,
        taxAmount: 19000,
        totalAmount: 119000,
        createdAt: now,
        updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseOrderItems).values({
        id: "oc-dte-cancelada-item-1",
        purchaseOrderId: orderId,
        productId: "prod-purch",
        productNameFree: null,
        quantity: 10,
        unitOfMeasure: "unidad",
        unitPrice: 10000,
        subtotal: 100000,
        status: "issued",
      })
      await inMemoryDb.insert(schema.dteDocuments).values({
        id: dteId,
        tipoDte: "33",
        folio: 456999,
        rutEmisor: "76.000.001-1",
        razonSocialEmisor: "Proveedor Purch",
        fechaEmision: issueDate,
        montoTotal: 119000,
        codEmp: "433",
        periodo: issueDate.slice(0, 7),
        portalRecordId: "9000099",
        rawHash: "dte-oc-cancelada-1-hash",
      })

      const invoiceId = await createPurchaseOrderInvoiceFromDte({
        purchaseOrderId: orderId,
        dteDocumentId: dteId,
        invoiceNumber: "456999",
        amount: 119000,
        amountAuthority: "document_header",
        issueDate,
        fileName: "DTE-33-456999.pdf",
        filePath: "storage/purchase-orders/dte-33-456999.pdf",
        uploadedBy: userId,
        dteIdentity: {
          tipoDte: "33",
          invoiceNumber: "456999",
          issueDate,
          supplierRut: "76.000.001-1",
          totalAmount: 119000,
        },
        items: [{
          productName: "Producto Purch",
          productCode: "P-001",
          unitOfMeasure: "UN",
          quantity: 10,
          unitPrice: 10000,
          subtotal: 100000,
        }],
      })

      await cancelOrder(orderId, userId, "El proveedor no era ése")

      await expect(deletePurchaseOrderInvoice(invoiceId, userId)).resolves.toMatchObject({
        filePath: "storage/purchase-orders/dte-33-456999.pdf",
      })
      const dte = await inMemoryDb.query.dteDocuments.findFirst({
        where: eq(schema.dteDocuments.id, dteId),
      })
      expect(dte?.purchaseOrderInvoiceId).toBeNull()
    })
  })
})
