/**
 * Tests for lib/services/purchasing.ts — updateSentOrderItems (correcting the
 * items of a sent/supplier_confirmed OC) and the isOrderItemsEditable guard.
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
  issueOrder,
  markOrderSent,
  updateSentOrderItems,
  isOrderItemsEditable,
} from "@/lib/services/purchasing"

const now    = new Date().toISOString()
const userId = "u-edit"

describe("isOrderItemsEditable", () => {
  it("allows sent orders with no reception", () => {
    expect(isOrderItemsEditable("sent", 0)).toBe(true)
  })

  it("allows supplier_confirmed orders with no reception", () => {
    expect(isOrderItemsEditable("supplier_confirmed", 0)).toBe(true)
  })

  it("rejects orders outside sent/supplier_confirmed", () => {
    expect(isOrderItemsEditable("draft", 0)).toBe(false)
    expect(isOrderItemsEditable("closed", 0)).toBe(false)
  })

  it("rejects orders with any reception recorded", () => {
    expect(isOrderItemsEditable("sent", 1)).toBe(false)
  })
})

describe("updateSentOrderItems", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Editora", email: "editora@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-edit", name: "Faena Edit", code: "F-EDIT",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({
      id: "sup-edit", name: "Proveedor Edit", rut: "76.000.002-2",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-edit", name: "Cat Edit", slug: "cat-edit", sortOrder: 1,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-edit", sku: "P-EDIT-001", name: "Producto Edit",
      categoryId: "cat-edit", unitOfMeasure: "unidad", isActive: true,
      createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  async function createSentOrder(key: string, quantity: number, unitPrice: number) {
    const requestId     = `req-${key}`
    const requestItemId = `item-${key}`
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-${key}`, worksiteId: "ws-edit",
      requesterId: userId, requestType: "epp", urgency: "normal",
      status: "approved", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: requestItemId, requestId, productId: "prod-edit",
      quantity, unitOfMeasure: "unidad", status: "pending_purchase",
      createdAt: now, updatedAt: now,
    })
    const orderId = await createOrder({
      worksiteId: "ws-edit", supplierId: "sup-edit", createdBy: userId,
      items: [{
        requestItemId, productId: "prod-edit", productNameFree: null,
        quantity, unitOfMeasure: "unidad", unitPrice,
      }],
    })
    await issueOrder(orderId, userId)
    await markOrderSent(orderId, userId)
    return { orderId, requestItemId }
  }

  it("updates quantity and price of an existing item and recalculates totals", async () => {
    const { orderId } = await createSentOrder("qty-price", 5, 1000)
    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await updateSentOrderItems(orderId, [{
      id: existingItem!.id,
      productId: "prod-edit",
      productNameFree: null,
      quantity: 8,
      unitOfMeasure: "unidad",
      unitPrice: 1200,
    }], "Proveedor rechazó por cantidad incorrecta", userId)

    const updatedItem = await inMemoryDb.query.purchaseOrderItems.findFirst({
      where: eq(schema.purchaseOrderItems.id, existingItem!.id),
    })
    expect(updatedItem?.quantity).toBe(8)
    expect(updatedItem?.unitPrice).toBe(1200)
    expect(updatedItem?.subtotal).toBe(9600)

    const order = await inMemoryDb.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, orderId),
    })
    expect(order?.netAmount).toBe(9600)
    expect(order?.taxAmount).toBe(1824)
    expect(order?.totalAmount).toBe(11424)
  })

  it("removing an item linked to a request reverts it to pending_purchase", async () => {
    const requestId  = "req-remove"
    const keepItemId = "item-remove-keep"
    const dropItemId = "item-remove-drop"
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: "SOL-REMOVE", worksiteId: "ws-edit",
      requesterId: userId, requestType: "epp", urgency: "normal",
      status: "approved", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      { id: keepItemId, requestId, productId: "prod-edit", quantity: 2, unitOfMeasure: "unidad", status: "pending_purchase", createdAt: now, updatedAt: now },
      { id: dropItemId, requestId, productId: "prod-edit", quantity: 3, unitOfMeasure: "unidad", status: "pending_purchase", createdAt: now, updatedAt: now },
    ])
    const orderId = await createOrder({
      worksiteId: "ws-edit", supplierId: "sup-edit", createdBy: userId,
      items: [
        { requestItemId: keepItemId, productId: "prod-edit", productNameFree: null, quantity: 2, unitOfMeasure: "unidad", unitPrice: 1000 },
        { requestItemId: dropItemId, productId: "prod-edit", productNameFree: null, quantity: 3, unitOfMeasure: "unidad", unitPrice: 1000 },
      ],
    })
    await issueOrder(orderId, userId)
    await markOrderSent(orderId, userId)

    const orderItems = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })
    const keepOrderItem = orderItems.find((i) => i.requestItemId === keepItemId)!

    await updateSentOrderItems(orderId, [
      { id: keepOrderItem.id, productId: "prod-edit", productNameFree: null, quantity: 2, unitOfMeasure: "unidad", unitPrice: 1000 },
    ], "proveedor rechazó uno de los ítems", userId)

    const dropRequestItem = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, dropItemId),
    })
    expect(dropRequestItem?.status).toBe("pending_purchase")

    const remainingOrderItems = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })
    expect(remainingOrderItems).toHaveLength(1)
    expect(remainingOrderItems[0]?.id).toBe(keepOrderItem.id)
  })

  it("adds a new free-text item not linked to any request", async () => {
    const { orderId } = await createSentOrder("add-free", 2, 1500)
    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await updateSentOrderItems(orderId, [
      { id: existingItem!.id, productId: "prod-edit", productNameFree: null, quantity: 2, unitOfMeasure: "unidad", unitPrice: 1500 },
      { productId: null, productNameFree: "Repuesto urgente", quantity: 1, unitOfMeasure: "unidad", unitPrice: 3000 },
    ], "faltaba un repuesto en la OC original", userId)

    const items = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })
    const newItem = items.find((i) => i.productNameFree === "Repuesto urgente")
    expect(newItem).toBeDefined()
    expect(newItem?.requestItemId).toBeNull()
    expect(newItem?.status).toBe("issued")
    expect(newItem?.quantityReceived).toBe(0)
  })

  it("throws if the order is not in sent or supplier_confirmed status", async () => {
    const { orderId } = await createSentOrder("bad-status", 1, 1000)
    await inMemoryDb
      .update(schema.purchaseOrders)
      .set({ status: "draft" })
      .where(eq(schema.purchaseOrders.id, orderId))

    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await expect(
      updateSentOrderItems(orderId, [
        { id: existingItem!.id, productId: "prod-edit", productNameFree: null, quantity: 1, unitOfMeasure: "unidad", unitPrice: 1000 },
      ], "test", userId)
    ).rejects.toThrow("No se pueden editar")
  })

  it("throws if the order already has reception recorded", async () => {
    const { orderId } = await createSentOrder("has-reception", 4, 1000)
    await inMemoryDb
      .update(schema.purchaseOrderItems)
      .set({ quantityOfficeReceived: 2 })
      .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))

    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await expect(
      updateSentOrderItems(orderId, [
        { id: existingItem!.id, productId: "prod-edit", productNameFree: null, quantity: 4, unitOfMeasure: "unidad", unitPrice: 1000 },
      ], "test", userId)
    ).rejects.toThrow("No se pueden editar")
  })

  it("rejects orders outside the provided worksite scope", async () => {
    const { orderId } = await createSentOrder("scope", 1, 1000)
    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await expect(
      updateSentOrderItems(orderId, [
        { id: existingItem!.id, productId: "prod-edit", productNameFree: null, quantity: 1, unitOfMeasure: "unidad", unitPrice: 1000 },
      ], "test", userId, ["ws-other"])
    ).rejects.toThrow("No tienes acceso")
  })

  it("records an audit entry with the edit reason", async () => {
    const { orderId } = await createSentOrder("audit", 1, 1000)
    const [existingItem] = await inMemoryDb.query.purchaseOrderItems.findMany({
      where: eq(schema.purchaseOrderItems.purchaseOrderId, orderId),
    })

    await updateSentOrderItems(orderId, [
      { id: existingItem!.id, productId: "prod-edit", productNameFree: null, quantity: 1, unitOfMeasure: "unidad", unitPrice: 1000 },
    ], "corrección por rechazo del proveedor", userId)

    const auditRows = await inMemoryDb.query.auditLog.findMany({
      where: eq(schema.auditLog.entityId, orderId),
    })
    const updateEntry = auditRows.find((r) => r.action === "update")
    expect(updateEntry).toBeDefined()
    expect(updateEntry?.reason).toBe("corrección por rechazo del proveedor")
  })
})
