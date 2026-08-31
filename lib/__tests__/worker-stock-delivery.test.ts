/**
 * Worker deliveries from physical warehouse stock.
 *
 * A delivery is one document with one or more physical product lines. The
 * source warehouse is explicit and the worker's worksite remains the target
 * for traceability and permissions.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import {
  addDaysToPlainDate,
  todayInChile,
} from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

import { registerWorkerStockDelivery } from "@/lib/services/deliveries"

const USER_ID = "user-worker-stock"
let scenarioNumber = 0

async function makeScenario({ workerAtSource = true }: { workerAtSource?: boolean } = {}) {
  const suffix = String(++scenarioNumber)
  const now = new Date().toISOString()
  const sourceWorksiteId = `ws-office-${suffix}`
  const targetWorksiteId = `ws-faena-${suffix}`
  const workerWorksiteId = workerAtSource ? sourceWorksiteId : targetWorksiteId
  const workerId = `worker-${suffix}`
  const categoryId = `cat-worker-stock-${suffix}`
  const firstProductId = `prod-worker-stock-a-${suffix}`
  const secondProductId = `prod-worker-stock-b-${suffix}`
  const serviceProductId = `prod-worker-stock-service-${suffix}`

  await inMemoryDb.insert(schema.worksites).values([
    { id: sourceWorksiteId, name: `Bodega central ${suffix}`, code: `BOD-${suffix}`, isActive: true, createdAt: now, updatedAt: now },
    { id: targetWorksiteId, name: `Faena destino ${suffix}`, code: `FNE-${suffix}`, isActive: true, createdAt: now, updatedAt: now },
  ])
  await inMemoryDb.insert(schema.workers).values({
    id: workerId,
    firstName: "Andrea",
    lastName: `Operadora ${suffix}`,
    worksiteId: workerWorksiteId,
    isActive: true,
    createdAt: now,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: categoryId,
    name: `Categoría entrega ${suffix}`,
    slug: `categoria-entrega-${suffix}`,
    sortOrder: 0,
  })
  await inMemoryDb.insert(schema.products).values([
    {
      id: firstProductId, sku: `ENT-A-${suffix}`, name: `Guante ${suffix}`,
      categoryId, unitOfMeasure: "par", isActive: true, isService: false,
      isEpp: true,
      createdAt: now, updatedAt: now,
    },
    {
      id: secondProductId, sku: `ENT-B-${suffix}`, name: `Lente ${suffix}`,
      categoryId, unitOfMeasure: "unidad", isActive: true, isService: false,
      isEpp: true,
      createdAt: now, updatedAt: now,
    },
    {
      id: serviceProductId, sku: `ENT-S-${suffix}`, name: `Calibración ${suffix}`,
      categoryId, unitOfMeasure: "servicio", isActive: true, isService: true,
      createdAt: now, updatedAt: now,
    },
  ])
  await inMemoryDb.insert(schema.worksiteStock).values([
    {
      id: `stock-a-${suffix}`, worksiteId: sourceWorksiteId, productId: firstProductId,
      quantity: 10, minStock: 0, lastMovementAt: now, updatedAt: now,
    },
    {
      id: `stock-b-${suffix}`, worksiteId: sourceWorksiteId, productId: secondProductId,
      quantity: 4, minStock: 0, lastMovementAt: now, updatedAt: now,
    },
  ])

  return {
    sourceWorksiteId,
    targetWorksiteId,
    workerWorksiteId,
    workerId,
    firstProductId,
    secondProductId,
    serviceProductId,
  }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Bodeguero", email: "bodega-entregas@chome.cl",
    hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
  })
})

afterAll(async () => { await pg.close() })

describe("registerWorkerStockDelivery", () => {
  it("creates one multi-item delivery and atomically deducts each source stock row", async () => {
    const scenario = await makeScenario()

    const deliveryId = await registerWorkerStockDelivery({
      sourceWorksiteId: scenario.sourceWorksiteId,
      workerId: scenario.workerId,
      deliveredBy: USER_ID,
      userEmail: "bodega-entregas@chome.cl",
      notes: "Entrega de turno",
      items: [
        { productId: scenario.firstProductId, quantity: 3 },
        { productId: scenario.secondProductId, quantity: 2 },
      ],
    })

    const delivery = await inMemoryDb.query.deliveries.findFirst({
      where: eq(schema.deliveries.id, deliveryId),
      with: { items: true, sourceWorksite: true, worksite: true },
    })
    expect(delivery).toMatchObject({
      destinationType: "worker",
      sourceWorksiteId: scenario.sourceWorksiteId,
      worksiteId: scenario.sourceWorksiteId,
      workerId: scenario.workerId,
      signaturePath: null,
    })
    expect(delivery?.items).toHaveLength(2)
    expect(delivery?.sourceWorksite?.id).toBe(scenario.sourceWorksiteId)
    expect(delivery?.worksite?.id).toBe(scenario.sourceWorksiteId)
    expect(delivery?.items.map((item) => [item.productId, item.quantity]).sort()).toEqual([
      [scenario.firstProductId, 3],
      [scenario.secondProductId, 2],
    ])

    const sourceStock = await inMemoryDb.select({
      productId: schema.worksiteStock.productId,
      quantity: schema.worksiteStock.quantity,
    }).from(schema.worksiteStock).where(and(
      eq(schema.worksiteStock.worksiteId, scenario.sourceWorksiteId),
      eq(schema.worksiteStock.productId, scenario.firstProductId),
    ))
    expect(sourceStock[0]?.quantity).toBe(7)
    const secondStock = await inMemoryDb.query.worksiteStock.findFirst({
      where: and(
        eq(schema.worksiteStock.worksiteId, scenario.sourceWorksiteId),
        eq(schema.worksiteStock.productId, scenario.secondProductId),
      ),
    })
    expect(secondStock?.quantity).toBe(2)

    const movements = await inMemoryDb.select().from(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.referenceId, deliveryId))
    expect(movements).toHaveLength(2)
    expect(movements.every((movement) => movement.type === "egreso_entrega" && movement.worksiteId === scenario.sourceWorksiteId)).toBe(true)
  })

  it("rolls every line back when a later line has insufficient stock", async () => {
    const scenario = await makeScenario()

    await expect(registerWorkerStockDelivery({
      sourceWorksiteId: scenario.sourceWorksiteId,
      workerId: scenario.workerId,
      deliveredBy: USER_ID,
      items: [
        { productId: scenario.firstProductId, quantity: 1 },
        { productId: scenario.secondProductId, quantity: 5 },
      ],
    })).rejects.toThrow("Stock insuficiente")

    const firstStock = await inMemoryDb.query.worksiteStock.findFirst({
      where: and(
        eq(schema.worksiteStock.worksiteId, scenario.sourceWorksiteId),
        eq(schema.worksiteStock.productId, scenario.firstProductId),
      ),
    })
    expect(firstStock?.quantity).toBe(10)
    const failedDelivery = await inMemoryDb.query.deliveries.findFirst({
      where: and(
        eq(schema.deliveries.sourceWorksiteId, scenario.sourceWorksiteId),
        eq(schema.deliveries.workerId, scenario.workerId),
      ),
    })
    expect(failedDelivery).toBeUndefined()
  })

  it("rejects service catalog items before creating a delivery", async () => {
    const scenario = await makeScenario()

    await expect(registerWorkerStockDelivery({
      sourceWorksiteId: scenario.sourceWorksiteId,
      workerId: scenario.workerId,
      deliveredBy: USER_ID,
      items: [{ productId: scenario.serviceProductId, quantity: 1 }],
    })).rejects.toThrow("Los servicios no se entregan desde bodega")
  })

  it("rejects fractional EPP quantities without changing stock", async () => {
    const scenario = await makeScenario()

    await expect(registerWorkerStockDelivery({
      sourceWorksiteId: scenario.sourceWorksiteId,
      workerId: scenario.workerId,
      deliveredBy: USER_ID,
      items: [{ productId: scenario.firstProductId, quantity: 0.02 }],
    })).rejects.toThrow("Los EPP se entregan en cantidades enteras")

    const stock = await inMemoryDb.query.worksiteStock.findFirst({
      where: and(
        eq(schema.worksiteStock.worksiteId, scenario.sourceWorksiteId),
        eq(schema.worksiteStock.productId, scenario.firstProductId),
      ),
    })
    expect(stock?.quantity).toBe(10)
    const delivery = await inMemoryDb.query.deliveries.findFirst({
      where: and(
        eq(schema.deliveries.sourceWorksiteId, scenario.sourceWorksiteId),
        eq(schema.deliveries.workerId, scenario.workerId),
      ),
    })
    expect(delivery).toBeUndefined()
  })

  it("rejects a worker assigned to a different worksite than the selected source", async () => {
    const scenario = await makeScenario({ workerAtSource: false })

    await expect(registerWorkerStockDelivery({
      sourceWorksiteId: scenario.sourceWorksiteId,
      workerId: scenario.workerId,
      deliveredBy: USER_ID,
      items: [{ productId: scenario.firstProductId, quantity: 1 }],
    })).rejects.toThrow("El trabajador no pertenece a la faena seleccionada")

    const stock = await inMemoryDb.query.worksiteStock.findFirst({
      where: and(
        eq(schema.worksiteStock.worksiteId, scenario.sourceWorksiteId),
        eq(schema.worksiteStock.productId, scenario.firstProductId),
      ),
    })
    expect(stock?.quantity).toBe(10)
  })

  it("keeps the named-request traceability cap when the source is the worker's faena", async () => {
    const scenario = await makeScenario({ workerAtSource: false })
    const now = new Date().toISOString()
    const suffix = String(scenarioNumber)
    const requestId = `req-trace-${suffix}`
    const requestItemId = `req-item-trace-${suffix}`
    const supplierId = `supplier-trace-${suffix}`
    const orderId = `oc-trace-${suffix}`

    await inMemoryDb.insert(schema.worksiteStock).values({
      id: `stock-trace-${suffix}`,
      worksiteId: scenario.targetWorksiteId,
      productId: scenario.firstProductId,
      quantity: 5,
      minStock: 0,
      lastMovementAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId,
      code: `SOL-TRACE-${suffix}`,
      worksiteId: scenario.targetWorksiteId,
      requesterId: USER_ID,
      urgency: "normal",
      status: "in_purchasing",
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: requestItemId,
      requestId,
      productId: scenario.firstProductId,
      workerId: scenario.workerId,
      quantity: 5,
      unitOfMeasure: "par",
      status: "received",
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({
      id: supplierId, name: `Proveedor traza ${suffix}`, isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseOrders).values({
      id: orderId,
      code: `OC-TRACE-${suffix}`,
      worksiteId: scenario.targetWorksiteId,
      supplierId,
      createdBy: USER_ID,
      status: "received",
      deliveryMode: "directo_faena",
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseOrderItems).values({
      id: `oci-trace-${suffix}`,
      purchaseOrderId: orderId,
      requestItemId,
      productId: scenario.firstProductId,
      quantity: 5,
      quantityReceived: 5,
      unitOfMeasure: "par",
      sortOrder: 0,
    })

    const deliveryId = await registerWorkerStockDelivery({
      sourceWorksiteId: scenario.targetWorksiteId,
      workerId: scenario.workerId,
      deliveredBy: USER_ID,
      items: [{ productId: scenario.firstProductId, quantity: 2, requestItemId }],
    })

    const [deliveryItem] = await inMemoryDb.select().from(schema.deliveryItems)
      .where(eq(schema.deliveryItems.deliveryId, deliveryId))
    const requestItem = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, requestItemId),
    })
    const stock = await inMemoryDb.query.worksiteStock.findFirst({
      where: and(
        eq(schema.worksiteStock.worksiteId, scenario.targetWorksiteId),
        eq(schema.worksiteStock.productId, scenario.firstProductId),
      ),
    })

    expect(deliveryItem?.requestItemId).toBe(requestItemId)
    expect(requestItem?.status).toBe("partially_delivered")
    expect(stock?.quantity).toBe(3)
  })

  // La entrega física ocurre en faena y se digita después. La fecha operacional
  // del comprobante la fija el operador; el rastro de auditoría —created_at y el
  // movimiento de kardex— sigue marcando cuándo se digitó.
  it("retrofecha sólo el comprobante y deja el kardex en la hora real", async () => {
    const scenario = await makeScenario()
    const today = todayInChile()
    const backdate = addDaysToPlainDate(today, -365)

    const deliveryId = await registerWorkerStockDelivery({
      sourceWorksiteId: scenario.sourceWorksiteId,
      workerId: scenario.workerId,
      deliveredAt: backdate,
      deliveredBy: USER_ID,
      items: [{ productId: scenario.firstProductId, quantity: 1 }],
    })

    const delivery = await inMemoryDb.query.deliveries.findFirst({
      where: eq(schema.deliveries.id, deliveryId),
    })
    // El anclaje al mediodía UTC es lo que hace que el día chileno sea el
    // elegido: con T00:00:00Z el comprobante mostraría el día anterior.
    expect(todayInChile(delivery!.deliveredAt)).toBe(backdate)
    expect(todayInChile(delivery!.createdAt)).toBe(today)

    const [movement] = await inMemoryDb.select().from(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.referenceId, deliveryId))
    expect(todayInChile(movement!.performedAt)).toBe(today)
  })

  it("sin fecha explícita registra el comprobante con la hora real", async () => {
    const scenario = await makeScenario()

    const deliveryId = await registerWorkerStockDelivery({
      sourceWorksiteId: scenario.sourceWorksiteId,
      workerId: scenario.workerId,
      deliveredBy: USER_ID,
      items: [{ productId: scenario.firstProductId, quantity: 1 }],
    })

    const delivery = await inMemoryDb.query.deliveries.findFirst({
      where: eq(schema.deliveries.id, deliveryId),
    })
    expect(todayInChile(delivery!.deliveredAt)).toBe(todayInChile())
  })
})
