/**
 * EPP por entregar: saldo trazable de ítems de solicitud recibidos en faena que
 * además tienen stock físico. Fuente única de `/entregas` y de Bodega.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
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

import { registerWorkerStockDelivery } from "@/lib/services/deliveries"
import { countDeliverableEppItems, getDeliverableEppItems } from "@/lib/services/epp-pending-delivery"

const USER_ID = "user-epp-pending"
const NOW = new Date().toISOString()

async function seed(suffix: string, { stock = 10, received = 4, requested = 5 } = {}) {
  const worksiteId = `ws-pend-${suffix}`
  const productId = `prod-pend-${suffix}`
  const requestId = `req-pend-${suffix}`
  const itemId = `item-pend-${suffix}`
  const workerId = `worker-pend-${suffix}`
  await inMemoryDb.insert(schema.worksites).values({
    id: worksiteId, name: `Faena ${suffix}`, code: `PND-${suffix}`, isActive: true, createdAt: NOW, updatedAt: NOW,
  })
  await inMemoryDb.insert(schema.workers).values({
    id: workerId, firstName: "Ana", lastName: suffix, worksiteId, isActive: true, createdAt: NOW,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: `cat-pend-${suffix}`, name: `Cat ${suffix}`, slug: `cat-pend-${suffix}`, sortOrder: 0,
  })
  await inMemoryDb.insert(schema.products).values({
    id: productId, sku: `PND-${suffix}`, name: `Guante ${suffix}`, categoryId: `cat-pend-${suffix}`,
    unitOfMeasure: "par", isActive: true, isService: false, isEpp: true, createdAt: NOW, updatedAt: NOW,
  })
  await inMemoryDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `SOL-PND-${suffix}`, worksiteId, requesterId: USER_ID, requestType: "epp",
    status: "in_purchasing", createdAt: NOW, updatedAt: NOW,
  })
  await inMemoryDb.insert(schema.purchaseRequestItems).values({
    id: itemId, requestId, productId, quantity: requested, unitOfMeasure: "par",
    status: "partially_received", createdAt: NOW, updatedAt: NOW,
  })
  await inMemoryDb.insert(schema.suppliers).values({ id: `sup-pend-${suffix}`, name: `Prov ${suffix}` })
  await inMemoryDb.insert(schema.purchaseOrders).values({
    id: `po-pend-${suffix}`, code: `OC-PND-${suffix}`, worksiteId, supplierId: `sup-pend-${suffix}`, createdBy: USER_ID,
    status: "partially_received",
  })
  await inMemoryDb.insert(schema.purchaseOrderItems).values({
    id: `poi-pend-${suffix}`, purchaseOrderId: `po-pend-${suffix}`, requestItemId: itemId, productId,
    quantity: requested, quantityOfficeReceived: received, quantityReceived: received, unitOfMeasure: "par",
  })
  if (stock > 0) {
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: `stock-pend-${suffix}`, worksiteId, productId, quantity: stock, minStock: 0, lastMovementAt: NOW, updatedAt: NOW,
    })
  }
  return { worksiteId, productId, itemId, workerId }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Bodeguero", email: "epp-pending@chome.cl",
    hashedPassword: "x", isActive: true, createdAt: NOW, updatedAt: NOW,
  })
})

afterAll(async () => { await pg.close() })

describe("getDeliverableEppItems", () => {
  it("lista el saldo recibido en faena con stock y respeta el alcance de faenas", async () => {
    const a = await seed("a")
    const b = await seed("b")

    const scoped = await getDeliverableEppItems({ worksiteIds: [a.worksiteId] })
    expect(scoped).toHaveLength(1)
    expect(scoped[0]).toMatchObject({
      requestItemId: a.itemId,
      worksiteId: a.worksiteId,
      productId: a.productId,
      receivedAtFaena: 4,
      deliveredQuantity: 0,
      remainingQuantity: 4,
      stockQuantity: 10,
    })

    const all = await getDeliverableEppItems({ worksiteIds: "all" })
    expect(all.map((item) => item.requestItemId)).toEqual(expect.arrayContaining([a.itemId, b.itemId]))
    expect(await countDeliverableEppItems({ worksiteIds: [a.worksiteId] })).toBe(1)
    expect(await getDeliverableEppItems({ worksiteIds: [] })).toEqual([])
    expect(await countDeliverableEppItems({ worksiteIds: [] })).toBe(0)
  })

  it("excluye ítems sin stock físico", async () => {
    const empty = await seed("nostock", { stock: 0 })
    expect(await getDeliverableEppItems({ worksiteIds: [empty.worksiteId] })).toEqual([])
  })

  it("descuenta lo ya entregado y deja de listar el ítem al agotar el saldo", async () => {
    const s = await seed("deliv")
    await registerWorkerStockDelivery({
      sourceWorksiteId: s.worksiteId,
      workerId: s.workerId,
      deliveredBy: USER_ID,
      userEmail: "epp-pending@chome.cl",
      items: [{ productId: s.productId, quantity: 1, requestItemId: s.itemId }],
    })
    const after = await getDeliverableEppItems({ worksiteIds: [s.worksiteId] })
    expect(after[0]).toMatchObject({ deliveredQuantity: 1, remainingQuantity: 3, stockQuantity: 9 })

    await registerWorkerStockDelivery({
      sourceWorksiteId: s.worksiteId,
      workerId: s.workerId,
      deliveredBy: USER_ID,
      userEmail: "epp-pending@chome.cl",
      items: [{ productId: s.productId, quantity: 3, requestItemId: s.itemId }],
    })
    expect(await getDeliverableEppItems({ worksiteIds: [s.worksiteId] })).toEqual([])
  })
})
