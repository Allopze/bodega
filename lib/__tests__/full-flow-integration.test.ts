/**
 * Full Flow Integration Test
 *
 * Simulates the end-to-end procurement pipeline:
 * 1. Seed worksite, product, supplier, and user
 * 2. Create Purchase Request (SOL) in draft state
 * 3. Submit request (transitions request to submitted, item to requested)
 * 4. Approve request item (transitions item to approved, rolls up request to approved)
 * 5. Stage item for purchasing (transitions item to pending_purchase)
 * 6. Create Purchase Order (OC) (transitions item to in_purchase_order, creates draft OC)
 * 7. Issue OC (transitions OC to issued)
 * 8. Send OC (transitions OC to sent, item to purchased)
 * 9. Register Receipt of OC items into worksite (transitions item to received, OC and request to closed)
 * 10. Verify worksite stock is correctly incremented
 * 11. Register EPP delivery to a worker and verify stock + traceability
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, vi, afterAll } from "vitest"
import path from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { Tx } from "@/db"

// ── Setup in-memory PostgreSQL database & schema migrations ──────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }

// Store in global singleton so that services can access it
// @ts-expect-error — PGlite is structurally compatible at runtime; postgres-js type differs only in result-type HKT
testGlobal.__db = inMemoryDb

// Mock the db module using a getter to avoid Vitest hoisting ReferenceError
vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

// Run migrations to construct the database schema
const migrationsFolder = path.resolve(process.cwd(), "db/migrations")
await migratePGlite(pg, migrationsFolder)

// Import the services to test (they now reference the mocked in-memory database)
import { submitItemTx, approveItem } from "@/lib/services/item-state"
import { createOrder, createOrdersBySupplier, issueAndSendOrder } from "@/lib/services/purchasing"
import { registerReceipt } from "@/lib/services/receiving"
import { confirmDispatchGuideReceipt, dispatchDispatchGuide, getDispatchGuideDetail } from "@/lib/services/dispatch-guides"
import { registerWorkerStockDelivery } from "@/lib/services/deliveries"

describe("Full procurement workflow integration", () => {
  afterAll(async () => {
    await pg.close()
  })

  it("completes the full request-to-receiving-to-stock flow successfully", async () => {
    const now = new Date().toISOString()

    // 1. Seed master data
    const userId = "u-user"
    await inMemoryDb.insert(schema.users).values({
      id: userId,
      name: "Juan Perez",
      email: "juan@chome.cl",
      hashedPassword: "hashed_password_placeholder",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    const worksiteId = "ws-1"
    await inMemoryDb.insert(schema.worksites).values({
      id: worksiteId,
      name: "Faena Quillota",
      code: "F-QUILLOTA",
      address: "Condell 123",
      region: "Valparaiso",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    const officeWorksiteId = "ws-office-1"
    await inMemoryDb.insert(schema.worksites).values({
      id: officeWorksiteId,
      name: "Oficina CHOME",
      code: "OF-CHOME",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.systemSettings).values({
      key: "warehouse.office_worksite_id",
      value: officeWorksiteId,
      updatedAt: now,
    })

    const supplierId = "sup-1"
    await inMemoryDb.insert(schema.suppliers).values({
      id: supplierId,
      name: "Ferretería El Tornillo",
      rut: "76.123.456-7",
      paymentTerms: "30 días",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    const categoryId = "cat-1"
    await inMemoryDb.insert(schema.productCategories).values({
      id: categoryId,
      name: "Seguridad y EPP",
      slug: "seguridad-y-epp",
      isEpp: true,
      sortOrder: 1,
    })

    const productId = "prod-1"
    await inMemoryDb.insert(schema.products).values({
      id: productId,
      sku: "EPP-001",
      name: "Casco de Seguridad Amarillo",
      categoryId: categoryId,
      unitOfMeasure: "unidad",
      referencePrice: 5000,
      isEpp: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    const workerId = "worker-1"
    await inMemoryDb.insert(schema.workers).values({
      id: workerId,
      rut: "11.111.111-1",
      firstName: "Pedro",
      lastName: "Rojas",
      position: "Operador",
      worksiteId,
      isActive: true,
      createdAt: now,
    })

    // 2. Create Purchase Request (SOL) in draft state
    const requestId = "req-1"
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId,
      code: "SOL-2026-0001",
      worksiteId: worksiteId,
      requesterId: userId,
      urgency: "normal",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })

    const requestItemId = "item-1"
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: requestItemId,
      requestId: requestId,
      productId: productId,
      quantity: 10,
      unitOfMeasure: "unidad",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })

    // Verify draft setup
    const initialReq = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, requestId),
      with: { items: true },
    })
    expect(initialReq).toBeDefined()
    expect(initialReq?.status).toBe("draft")
    expect(initialReq?.items[0]?.status).toBe("draft")

    // 3. Submit request item (transitions item to requested)
    await inMemoryDb.transaction((tx) => submitItemTx(tx as unknown as Tx, requestItemId, userId, { userEmail: "juan@chome.cl" }))

    // Simulate request header status update to "submitted" as done in submitRequest server action
    await inMemoryDb.update(schema.purchaseRequests)
      .set({ status: "submitted", submittedAt: now, updatedAt: now })
      .where(eq(schema.purchaseRequests.id, requestId))
      

    const submittedReq = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, requestId),
      with: { items: true },
    })
    expect(submittedReq?.status).toBe("submitted")
    expect(submittedReq?.items[0]?.status).toBe("requested")

    // 4. Approve request item (transitions item to approved, rolls up request to approved)
    await approveItem(requestItemId, userId, { userEmail: "juan@chome.cl" })

    const approvedReq = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, requestId),
      with: { items: true },
    })
    expect(approvedReq?.items[0]?.status).toBe("approved")
    expect(approvedReq?.status).toBe("approved")

    // 5. Create Purchase Order (OC) — el ítem aprobado entra directo, sin
    //    paso intermedio de "pendiente de compra".
    // 6. Create Purchase Order (OC)
    const orderId = await createOrder({
      worksiteId: worksiteId,
      supplierId: supplierId,
      createdBy: userId,
      userEmail: "juan@chome.cl",
      items: [
        {
          requestItemId: requestItemId,
          productId: productId,
          productNameFree: null,
          quantity: 10,
          unitOfMeasure: "unidad",
          unitPrice: 5000,
        },
      ],
    })

    const order = await inMemoryDb.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, orderId),
      with: { items: true },
    })
    expect(order).toBeDefined()
    expect(order?.status).toBe("draft")
    expect(order?.items[0]?.quantity).toBe(10)
    expect(order?.items[0]?.requestItemId).toBe(requestItemId)

    // Request item should transition to in_purchase_order
    const inOcReq = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, requestId),
      with: { items: true },
    })
    expect(inOcReq?.items[0]?.status).toBe("in_purchase_order")

    // 7. Emitir y enviar la OC (un solo acto desde 2026-08-07)
    await issueAndSendOrder(orderId, userId, "all", { userEmail: "juan@chome.cl" })
    const sentOrder = await inMemoryDb.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, orderId),
    })
    expect(sentOrder?.status).toBe("sent")
    expect(sentOrder?.issuedAt).toBeTruthy()
    expect(sentOrder?.sentAt).toBeTruthy()

    // Request item should transition to purchased
    const purchasedReq = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, requestId),
      with: { items: true },
    })
    expect(purchasedReq?.items[0]?.status).toBe("purchased")

    // 9a. Stage 1 — arrival at Chome office (mandatory first step, office stock).
    const ocItemId = order?.items[0]?.id ?? ""
    await registerReceipt({
      purchaseOrderId: orderId,
      receivedBy: userId,
      userEmail: "juan@chome.cl",
      stage: "office",
      dispatchGuideNo: "GUIA-OFI-999",
      items: [
        {
          purchaseOrderItemId: ocItemId,
          quantityReceived: 10,
        },
      ],
    })

    const officeOrder = await inMemoryDb.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, orderId),
    })
    expect(officeOrder?.status).toBe("office_received")

    // 9b. Stage 2 — the office receipt prepares the GDI; dispatch is the only
    // operation that moves stock to faena, and the later cotejo creates the
    // final receipt without duplicating that movement.
    const [guide] = await inMemoryDb.select().from(schema.dispatchGuides)
      .where(eq(schema.dispatchGuides.purchaseOrderId, orderId))
    expect(guide?.receiptId).toBeTruthy()
    await dispatchDispatchGuide(guide!.id, { userId, userEmail: "juan@chome.cl" })
    const guideDetail = await getDispatchGuideDetail(guide!.id)
    await confirmDispatchGuideReceipt(guide!.id, {
      receivedByWorkerId: workerId,
      items: [{ guideItemId: guideDetail!.guide.items[0]!.id, quantityReceived: 10 }],
    }, { userId, userEmail: "juan@chome.cl" })

    const [faenaReceiptRow] = await inMemoryDb.select({ id: schema.receipts.id })
      .from(schema.receipts)
      .where(eq(schema.receipts.dispatchGuideNo, guide!.code))
    const receiptId = faenaReceiptRow!.id

    const receipt = await inMemoryDb.query.receipts.findFirst({
      where: eq(schema.receipts.id, receiptId),
      with: { items: true },
    })
    expect(receipt).toBeDefined()
    expect(receipt?.status).toBe("closed")
    expect(receipt?.items[0]?.quantityReceived).toBe(10)
    const [receiptActivity] = await inMemoryDb.select().from(schema.operationalActivityEvents)
      .where(eq(schema.operationalActivityEvents.entityId, receiptId))
    expect(receiptActivity).toMatchObject({
      eventType: "receipt.registered",
      module: "recepciones",
      worksiteId,
      actorUserId: userId,
    })

    // Verify Purchase Order rolled up to "received" and auto-closed in the same transaction
    const finalOrder = await inMemoryDb.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, orderId),
    })
    expect(finalOrder?.status).toBe("closed")

    // La adquisición termina al recibir en faena; la entrega al trabajador es
    // un movimiento posterior de stock.
    const finalReq = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, requestId),
      with: { items: true },
    })
    expect(finalReq?.items[0]?.status).toBe("received")
    expect(finalReq?.status).toBe("closed")

    // 10. Verify worksite stock is correctly incremented
    const stock = await inMemoryDb.query.worksiteStock.findFirst({
      where: eq(schema.worksiteStock.worksiteId, worksiteId),
    })
    expect(stock).toBeDefined()
    expect(stock?.productId).toBe(productId)
    expect(stock?.quantity).toBe(10) // 10 cascos in worksite stock

    // 11. Deliver received EPP to a worker
    const deliveryId = await registerWorkerStockDelivery({
      sourceWorksiteId: worksiteId,
      workerId,
      deliveredBy: userId,
      userEmail: "juan@chome.cl",
      items: [{ productId, quantity: 10, requestItemId }],
    })

    const delivery = await inMemoryDb.query.deliveries.findFirst({
      where: eq(schema.deliveries.id, deliveryId),
      with: { items: true },
    })
    expect(delivery).toBeDefined()
    expect(delivery?.destinationType).toBe("worker")
    expect(delivery?.workerId).toBe(workerId)
    expect(delivery?.items[0]?.requestItemId).toBe(requestItemId)
    const [deliveryActivity] = await inMemoryDb.select().from(schema.operationalActivityEvents)
      .where(eq(schema.operationalActivityEvents.entityId, deliveryId))
    expect(deliveryActivity).toMatchObject({
      eventType: "delivery.registered",
      module: "entregas",
      worksiteId,
      actorUserId: userId,
    })

    const stockAfterDelivery = await inMemoryDb.query.worksiteStock.findFirst({
      where: eq(schema.worksiteStock.worksiteId, worksiteId),
    })
    expect(stockAfterDelivery?.quantity).toBe(0)

    const deliveredReq = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, requestId),
      with: { items: true },
    })
    expect(deliveredReq?.items[0]?.status).toBe("delivered")
    expect(deliveredReq?.status).toBe("closed")
  })

  it("creates separate purchase orders for items assigned to different suppliers", async () => {
    const now = new Date().toISOString()
    const userId = "u-multi-supplier"
    const worksiteId = "ws-multi-supplier"
    const supplierAId = "sup-multi-a"
    const supplierBId = "sup-multi-b"
    const categoryId = "cat-multi-supplier"
    const productAId = "prod-multi-a"
    const productBId = "prod-multi-b"
    const requestId = "req-multi-supplier"
    const itemAId = "item-multi-a"
    const itemBId = "item-multi-b"

    await inMemoryDb.insert(schema.users).values({
      id: userId,
      name: "Comprador Multi",
      email: "comprador-multi@chome.cl",
      hashedPassword: "hashed_password_placeholder",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    await inMemoryDb.insert(schema.worksites).values({
      id: worksiteId,
      name: "Faena Multi Proveedor",
      code: "F-MULTI-PROV",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    await inMemoryDb.insert(schema.suppliers).values([
      {
        id: supplierAId,
        name: "Proveedor Multi A",
        rut: "76.000.001-1",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: supplierBId,
        name: "Proveedor Multi B",
        rut: "76.000.002-2",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ])

    await inMemoryDb.insert(schema.productCategories).values({
      id: categoryId,
      name: "Multi proveedor",
      slug: "multi-proveedor",
      isEpp: false,
      sortOrder: 2,
    })

    await inMemoryDb.insert(schema.products).values([
      {
        id: productAId,
        sku: "MULTI-A",
        name: "Item proveedor A",
        categoryId,
        unitOfMeasure: "unidad",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: productBId,
        sku: "MULTI-B",
        name: "Item proveedor B",
        categoryId,
        unitOfMeasure: "unidad",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ])

    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId,
      code: "SOL-2026-MULTI",
      worksiteId,
      requesterId: userId,
      requestType: "otro",
      urgency: "normal",
      status: "approved",
      createdAt: now,
      updatedAt: now,
    })

    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      {
        id: itemAId,
        requestId,
        productId: productAId,
        quantity: 2,
        unitOfMeasure: "unidad",
        status: "pending_purchase",
        suggestedSupplierId: supplierAId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: itemBId,
        requestId,
        productId: productBId,
        quantity: 3,
        unitOfMeasure: "unidad",
        status: "pending_purchase",
        suggestedSupplierId: supplierBId,
        createdAt: now,
        updatedAt: now,
      },
    ])

    const orderIds = await createOrdersBySupplier({
      worksiteId,
      createdBy: userId,
      userEmail: "comprador-multi@chome.cl",
      orders: [
        {
          supplierId: supplierAId,
          items: [{
            requestItemId: itemAId,
            productId: productAId,
            productNameFree: null,
            quantity: 2,
            unitOfMeasure: "unidad",
            unitPrice: 1000,
          }],
        },
        {
          supplierId: supplierBId,
          items: [{
            requestItemId: itemBId,
            productId: productBId,
            productNameFree: null,
            quantity: 3,
            unitOfMeasure: "unidad",
            unitPrice: 2000,
          }],
        },
      ],
    })

    expect(orderIds).toHaveLength(2)

    const orders = await inMemoryDb.query.purchaseOrders.findMany({
      with: { items: true },
    })
    const createdOrders = orders.filter((order) => orderIds.includes(order.id))

    expect(createdOrders.map((order) => order.supplierId).sort()).toEqual([supplierAId, supplierBId])
    expect(createdOrders.every((order) => order.items.length === 1)).toBe(true)

    const itemA = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, itemAId),
    })
    const itemB = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, itemBId),
    })
    expect(itemA?.status).toBe("in_purchase_order")
    expect(itemB?.status).toBe("in_purchase_order")
  })

  // TR-10 (auditoría 2026-09-05): una compra parcial duplicaba parte de la
  // cantidad aprobada. Aprobado a 10, se compran 6: el split reduce el original
  // a 6 y crea un remanente de 4, pero el `modifiedQty` de la última decisión
  // seguía sobre el original reclamando 10. El consolidado sumaba ese 10 al
  // remanente de 4 → aprobado 14 para un solicitado de 10. Este test fija que
  // `createOrder` con cantidades menores reparta la aprobación: la última
  // decisión del original debe quedar en 6 (la porción comprada) y el remanente
  // aporta su propia cantidad.
  it("una compra parcial reparte la aprobación sin duplicar la cantidad (TR-10)", async () => {
    const now = new Date().toISOString()
    const userId = "u-split"
    const worksiteId = "ws-split"
    const supplierId = "sup-split"
    const categoryId = "cat-split"
    const productId = "prod-split"
    const requestId = "req-split"
    const requestItemId = "item-split"

    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Comprador Split", email: "split@chome.cl", hashedPassword: "x",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteId, name: "Faena Split", code: "F-SPLIT", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.suppliers).values({
      id: supplierId, name: "Proveedor Split", rut: "77.123.456-7", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({
      id: categoryId, name: "Categoría Split", slug: "categoria-split", sortOrder: 1,
    })
    await inMemoryDb.insert(schema.products).values({
      id: productId, sku: "SPLIT-001", name: "Ítem dividible", categoryId,
      unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: "SOL-2026-SPLIT", worksiteId, requesterId: userId,
      urgency: "normal", status: "approved", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: requestItemId, requestId, productId, quantity: 10, unitOfMeasure: "unidad",
      status: "approved", createdAt: now, updatedAt: now,
    })
    // La aprobación previa ajustó la cantidad a 10 (mismo valor en este caso,
    // pero es quien manda en el consolidado porque `requestItem.quantity` ya
    // quedó en 10 tras el approve con modifiedQty).
    await inMemoryDb.insert(schema.approvalDecisions).values({
      id: "approval-split-1", requestItemId, requestId, type: "modify", decidedBy: userId,
      decidedAt: now, reason: "Se aprueban 10 unidades", modifiedQty: 10, roleContext: null,
    })

    // Compra parcial: 6 de las 10 unidades van a la OC.
    await createOrder({
      worksiteId, supplierId, createdBy: userId, userEmail: "split@chome.cl",
      items: [{ requestItemId, productId, productNameFree: null, quantity: 6, unitOfMeasure: "unidad", unitPrice: 1000 }],
    })

    // Original reducido a 6.
    const original = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, requestItemId),
    })
    expect(original?.quantity).toBe(6)

    // Hermano remanente de 4, que conserva el estado y apunta al original.
    const siblings = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.splitFromItemId, requestItemId))
    expect(siblings).toHaveLength(1)
    expect(siblings[0]?.quantity).toBe(4)
    expect(siblings[0]?.requestId).toBe(requestId)

    // La última decisión del original ya NO reclama 10: quedó en 6.
    const decisions = await inMemoryDb.select().from(schema.approvalDecisions)
      .where(eq(schema.approvalDecisions.requestItemId, requestItemId))
    expect(decisions[decisions.length - 1]).toMatchObject({
      type: "modify",
      modifiedQty: 6,
    })
    expect(decisions[decisions.length - 1]?.reason).toContain("Compra parcial")

    // Total solicitado de la solicitud = 10 (6 + 4), no 14 ni 20.
    const reqItems = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
    const totalRequested = reqItems.reduce((sum, item) => sum + item.quantity, 0)
    expect(totalRequested).toBe(10)
  })
})
