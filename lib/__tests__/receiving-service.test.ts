/**
 * Integration tests for lib/services/receiving.ts — edge cases and validation.
 *
 * The full flow (office → faena → stock) is covered in full-flow-integration.test.ts.
 * These tests focus on error paths: invalid state, duplicate items, quantity caps.
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

import { registerReceipt } from "@/lib/services/receiving"
import { createOrder, issueOrder, markOrderSent } from "@/lib/services/purchasing"

const now = new Date().toISOString()
const userId = "u-recv"

describe("Receiving service — edge cases", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Recepcionista", email: "recv@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-recv", name: "Faena Recv", code: "F-RECV",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({
      id: "sup-recv", name: "Proveedor Recv", rut: "76.000.002-2",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-recv", name: "Cat Recv", slug: "cat-recv", sortOrder: 1,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-recv", sku: "R-001", name: "Producto Recv",
      categoryId: "cat-recv", unitOfMeasure: "unidad", isEpp: true, isActive: true,
      createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  // ── Setup: create a sent order with OC items ────────────────────────────

  async function createSentOrder() {
    const requestId = `req-recv-${Date.now()}`
    const requestItemId = `item-recv-${Date.now()}`
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-RECV-${Date.now()}`, worksiteId: "ws-recv",
      requesterId: userId, requestType: "epp", urgency: "normal",
      status: "approved", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: requestItemId, requestId, productId: "prod-recv",
      quantity: 10, unitOfMeasure: "unidad", status: "pending_purchase",
      createdAt: now, updatedAt: now,
    })

    const orderId = await createOrder({
      worksiteId: "ws-recv",
      supplierId: "sup-recv",
      createdBy: userId,
      items: [{
        requestItemId,
        productId: "prod-recv",
        productNameFree: null,
        quantity: 10,
        unitOfMeasure: "unidad",
        unitPrice: 3000,
      }],
    })

    await issueOrder(orderId, userId)
    await markOrderSent(orderId, userId)

    // Get the OC item ID
    const ocItems = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    return { orderId, requestItemId, ocItemId: ocItems[0]!.id }
  }

  // ── Validation errors ──────────────────────────────────────────────────

  describe("validation", () => {
    it("throws when items array is empty", async () => {
      await expect(
        registerReceipt({
          purchaseOrderId: "any",
          receivedBy: userId,
          stage: "office",
          items: [],
        })
      ).rejects.toThrow("At least one received item")
    })

    it("throws when duplicate order items are provided", async () => {
      await expect(
        registerReceipt({
          purchaseOrderId: "any",
          receivedBy: userId,
          stage: "office",
          items: [
            { purchaseOrderItemId: "dup-1", quantityReceived: 5 },
            { purchaseOrderItemId: "dup-1", quantityReceived: 3 },
          ],
        })
      ).rejects.toThrow("duplicated")
    })

    it("throws when purchase order does not exist", async () => {
      await expect(
        registerReceipt({
          purchaseOrderId: "nonexistent",
          receivedBy: userId,
          stage: "office",
          items: [{ purchaseOrderItemId: "any", quantityReceived: 1 }],
        })
      ).rejects.toThrow("not found")
    })

    it("throws when order is in 'draft' state (must be sent first)", async () => {
      // Create a draft order using existing worksite/supplier from beforeAll
      const draftReqId = `req-draft-${Date.now()}`
      const draftItemId = `item-draft-${Date.now()}`
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: draftReqId, code: `SOL-DRAFT-${Date.now()}`, worksiteId: "ws-recv",
        requesterId: userId, requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: draftItemId, requestId: draftReqId, productId: "prod-recv",
        quantity: 5, unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })

      const orderId = await createOrder({
        worksiteId: "ws-recv",
        supplierId: "sup-recv",
        createdBy: userId,
        items: [{
          requestItemId: draftItemId,
          productId: "prod-recv",
          productNameFree: null,
          quantity: 5,
          unitOfMeasure: "unidad",
          unitPrice: 1000,
        }],
      })

      const ocItems = await inMemoryDb.query.purchaseOrderItems.findMany({
        where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
      })

      await expect(
        registerReceipt({
          purchaseOrderId: orderId,
          receivedBy: userId,
          stage: "office",
          items: [{ purchaseOrderItemId: ocItems[0]!.id, quantityReceived: 5 }],
        })
      ).rejects.toThrow("Cannot receive")
    })

    it("throws when faena stage used before office stage", async () => {
      const { orderId, ocItemId } = await createSentOrder()

      await expect(
        registerReceipt({
          purchaseOrderId: orderId,
          receivedBy: userId,
          stage: "faena",
          worksiteId: "ws-recv",
          items: [{ purchaseOrderItemId: ocItemId, quantityReceived: 10 }],
        })
      ).rejects.toThrow("llegada a oficina")
    })
  })

  // ── Rollup logic ───────────────────────────────────────────────────────

  describe("rollup", () => {
    it("partially_office_received when only some items arrive at office", async () => {
      const { orderId, ocItemId } = await createSentOrder()

      await registerReceipt({
        purchaseOrderId: orderId,
        receivedBy: userId,
        stage: "office",
        items: [{ purchaseOrderItemId: ocItemId, quantityReceived: 3 }],
      })

      const order = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.id, orderId),
      })
      expect(order?.status).toBe("partially_office_received")
    })

    it("office_received when all items arrive at office", async () => {
      const { orderId, ocItemId } = await createSentOrder()

      // First partial
      await registerReceipt({
        purchaseOrderId: orderId,
        receivedBy: userId,
        stage: "office",
        items: [{ purchaseOrderItemId: ocItemId, quantityReceived: 3 }],
      })

      // Complete the rest
      await registerReceipt({
        purchaseOrderId: orderId,
        receivedBy: userId,
        stage: "office",
        items: [{ purchaseOrderItemId: ocItemId, quantityReceived: 7 }],
      })

      const order = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.id, orderId),
      })
      expect(order?.status).toBe("office_received")
    })

    it("throws when received quantity exceeds pending", async () => {
      const { orderId, ocItemId } = await createSentOrder()

      await expect(
        registerReceipt({
          purchaseOrderId: orderId,
          receivedBy: userId,
          stage: "office",
          items: [{ purchaseOrderItemId: ocItemId, quantityReceived: 15 }],
        })
      ).rejects.toThrow("exceeds pending")
    })
  })

  // ── Two-stage receiving ────────────────────────────────────────────────

  describe("two-stage receiving", () => {
    it("registers office then faena and generates stock", async () => {
      const { orderId, ocItemId, requestItemId } = await createSentOrder()

      // Stage 1: office
      await registerReceipt({
        purchaseOrderId: orderId,
        receivedBy: userId,
        stage: "office",
        items: [{ purchaseOrderItemId: ocItemId, quantityReceived: 10 }],
      })

      // Stage 2: faena
      await registerReceipt({
        purchaseOrderId: orderId,
        receivedBy: userId,
        stage: "faena",
        worksiteId: "ws-recv",
        items: [{ purchaseOrderItemId: ocItemId, quantityReceived: 10 }],
      })

      // Verify stock
      const stock = await inMemoryDb.query.worksiteStock.findFirst({
        where: eq(schema.worksiteStock.worksiteId, "ws-recv"),
      })
      expect(stock).toBeDefined()
      expect(stock?.quantity).toBe(10)

      // Verify request item status
      const item = await inMemoryDb.query.purchaseRequestItems.findFirst({
        where: eq(schema.purchaseRequestItems.id, requestItemId),
      })
      expect(item?.status).toBe("received")

      // Verify order status
      const order = await inMemoryDb.query.purchaseOrders.findFirst({
        where: eq(schema.purchaseOrders.id, orderId),
      })
      expect(order?.status).toBe("received")
    })
  })
})
