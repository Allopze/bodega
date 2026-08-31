import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
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

import {
  EPP_DELIVERY_SCALE_CORRECTION_REASON,
  reconcileEppDeliveryScale,
} from "@/lib/services/epp-delivery-scale-reconciliation"

const USER_ID = "user-epp-scale"
const WORKSITE_ID = "ws-epp-scale"
const PRODUCT_ID = "product-epp-scale"
const DELIVERY_ID = "delivery-epp-scale"
const DELIVERY_ITEM_ID = "delivery-item-epp-scale"

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = "2026-08-21T14:00:00.000Z"
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "Operador de bodega",
    email: "operador-epp-scale@test.cl",
    hashedPassword: "x",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: WORKSITE_ID,
    code: "EPP-SCALE",
    name: "Faena escala EPP",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await inMemoryDb.insert(schema.workers).values({
    id: "worker-epp-scale",
    firstName: "Andrea",
    lastName: "Rojas",
    worksiteId: WORKSITE_ID,
    isActive: true,
    createdAt: now,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: "category-epp-scale",
    name: "EPP escala",
    slug: "epp-escala",
    sortOrder: 0,
  })
  await inMemoryDb.insert(schema.products).values({
    id: PRODUCT_ID,
    sku: "EPP-SCALE-001",
    name: "Casco EPP escala",
    categoryId: "category-epp-scale",
    unitOfMeasure: "unidad",
    isActive: true,
    isService: false,
    isEpp: true,
    createdAt: now,
    updatedAt: now,
  })
  await inMemoryDb.insert(schema.worksiteStock).values({
    id: "stock-epp-scale",
    worksiteId: WORKSITE_ID,
    productId: PRODUCT_ID,
    quantity: 3.98,
    minStock: 0,
    lastMovementAt: now,
    updatedAt: now,
  })
  await inMemoryDb.insert(schema.deliveries).values({
    id: DELIVERY_ID,
    code: "ENT-2026-SCALE",
    deliveredBy: USER_ID,
    deliveredAt: now,
    destinationType: "worker",
    sourceWorksiteId: WORKSITE_ID,
    worksiteId: WORKSITE_ID,
    workerId: "worker-epp-scale",
    createdAt: now,
  })
  await inMemoryDb.insert(schema.deliveryItems).values({
    id: DELIVERY_ITEM_ID,
    deliveryId: DELIVERY_ID,
    productId: PRODUCT_ID,
    quantity: 0.02,
    unitOfMeasure: "unidad",
  })
  await inMemoryDb.insert(schema.inventoryMovements).values({
    id: "movement-epp-scale-original",
    worksiteId: WORKSITE_ID,
    productId: PRODUCT_ID,
    type: "egreso_entrega",
    quantity: -0.02,
    referenceType: "delivery",
    referenceId: DELIVERY_ID,
    stockBefore: 4,
    stockAfter: 3.98,
    performedBy: USER_ID,
    performedAt: now,
  })
})

afterAll(async () => { await pg.close() })

describe("reconcileEppDeliveryScale", () => {
  it("corrige 0,02 a 2, compensa 1,98 de stock y no se reaplica", async () => {
    const first = await reconcileEppDeliveryScale()

    expect(first.correctedDeliveries).toBe(1)
    expect(first.totalOriginalQuantity).toBeCloseTo(0.02)
    expect(first.totalCorrectedQuantity).toBe(2)
    expect(first.totalStockAdjustment).toBeCloseTo(1.98)
    expect(first.adjustmentCodes).toHaveLength(1)

    const item = await inMemoryDb.query.deliveryItems.findFirst({
      where: eq(schema.deliveryItems.id, DELIVERY_ITEM_ID),
    })
    expect(item).toMatchObject({ quantity: 2 })
    expect(item?.quantityOriginal).toBeCloseTo(0.02)
    expect(item?.quantityCorrectedAt).toBeTruthy()
    expect(item?.quantityCorrectionReason).toBe(EPP_DELIVERY_SCALE_CORRECTION_REASON)

    const stock = await inMemoryDb.query.worksiteStock.findFirst({
      where: and(
        eq(schema.worksiteStock.worksiteId, WORKSITE_ID),
        eq(schema.worksiteStock.productId, PRODUCT_ID),
      ),
    })
    expect(stock?.quantity).toBeCloseTo(2)

    const adjustment = await inMemoryDb.query.stockAdjustments.findFirst({
      where: eq(schema.stockAdjustments.productId, PRODUCT_ID),
    })
    expect(adjustment?.quantity).toBeCloseTo(-1.98)
    expect(adjustment?.reason).toBe(EPP_DELIVERY_SCALE_CORRECTION_REASON)

    const movements = await inMemoryDb.query.inventoryMovements.findMany({
      where: eq(schema.inventoryMovements.productId, PRODUCT_ID),
    })
    expect(movements).toHaveLength(2)
    expect(movements.find((movement) => movement.type === "egreso_entrega")?.quantity).toBeCloseTo(-0.02)
    expect(movements.find((movement) => movement.type === "ajuste")?.quantity).toBeCloseTo(-1.98)

    const audit = await inMemoryDb.query.auditLog.findFirst({
      where: and(
        eq(schema.auditLog.entityType, "delivery_item"),
        eq(schema.auditLog.entityId, DELIVERY_ITEM_ID),
      ),
    })
    expect(audit?.oldState).toContain("0.02")
    expect(audit?.newState).toContain("2")

    const second = await reconcileEppDeliveryScale()
    expect(second.correctedDeliveries).toBe(0)
    expect(await inMemoryDb.select().from(schema.stockAdjustments)).toHaveLength(1)
  })
})
