import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
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

import { getStockAvailability } from "@/lib/services/stock-availability"

const NOW = "2026-09-09T12:00:00.000Z"
const USER_ID = "availability-user"
const WS_ALPHA = "availability-alpha"
const WS_BETA = "availability-beta"
const SUPPLIER_ID = "availability-supplier"
const CATEGORY_ID = "availability-category"
const PRODUCT_SMALL = "availability-glove-s"
const PRODUCT_LARGE = "availability-glove-l"
const SERVICE = "availability-service"

function scopedSession(worksiteIds: string[]) {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: {
      id: USER_ID,
      name: "Responsable de faena",
      email: "faena@example.com",
      roles: ["solicitante_faena"],
      permissions: [],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
    },
  }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "Responsable de faena",
    email: "faena@example.com",
    hashedPassword: "x",
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_ALPHA, name: "Faena Alfa", code: "AV-ALFA", isActive: true, createdAt: NOW, updatedAt: NOW },
    { id: WS_BETA, name: "Faena Beta", code: "AV-BETA", isActive: true, createdAt: NOW, updatedAt: NOW },
  ])
  await inMemoryDb.insert(schema.suppliers).values({
    id: SUPPLIER_ID,
    name: "Proveedor disponibilidad",
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: CATEGORY_ID,
    name: "Disponibilidad",
    slug: "availability",
    sortOrder: 1,
  })
  await inMemoryDb.insert(schema.products).values([
    { id: PRODUCT_SMALL, sku: "GUANTE-S", name: "Guante", categoryId: CATEGORY_ID, unitOfMeasure: "par", isActive: true, createdAt: NOW, updatedAt: NOW },
    { id: PRODUCT_LARGE, sku: "GUANTE-L", name: "Guante", categoryId: CATEGORY_ID, unitOfMeasure: "par", isActive: true, createdAt: NOW, updatedAt: NOW },
    { id: SERVICE, sku: "SERV-01", name: "Calibración", categoryId: CATEGORY_ID, unitOfMeasure: "servicio", isService: true, isActive: true, createdAt: NOW, updatedAt: NOW },
  ])
  await inMemoryDb.insert(schema.worksiteStock).values([
    { id: "stock-alpha-s", worksiteId: WS_ALPHA, productId: PRODUCT_SMALL, quantity: 3, minStock: 0, updatedAt: NOW },
    { id: "stock-alpha-l", worksiteId: WS_ALPHA, productId: PRODUCT_LARGE, quantity: 1, minStock: 0, updatedAt: NOW },
    { id: "stock-beta-s", worksiteId: WS_BETA, productId: PRODUCT_SMALL, quantity: 99, minStock: 0, updatedAt: NOW },
  ])

  await inMemoryDb.insert(schema.purchaseRequests).values([
    { id: "request-alpha", code: "SOL-AV-001", worksiteId: WS_ALPHA, requesterId: USER_ID, status: "in_purchasing", createdAt: NOW, updatedAt: NOW },
    { id: "request-terminal", code: "SOL-AV-002", worksiteId: WS_ALPHA, requesterId: USER_ID, status: "closed", createdAt: NOW, updatedAt: NOW },
    { id: "request-beta", code: "SOL-AV-003", worksiteId: WS_BETA, requesterId: USER_ID, status: "in_purchasing", createdAt: NOW, updatedAt: NOW },
  ])
  await inMemoryDb.insert(schema.purchaseRequestItems).values([
    { id: "request-item-s", requestId: "request-alpha", productId: PRODUCT_SMALL, quantity: 10, status: "partially_delivered", createdAt: NOW, updatedAt: NOW },
    { id: "request-item-l", requestId: "request-alpha", productId: PRODUCT_LARGE, quantity: 6, status: "partially_received", createdAt: NOW, updatedAt: NOW },
    { id: "request-item-service", requestId: "request-alpha", productId: SERVICE, quantity: 50, status: "partially_received", createdAt: NOW, updatedAt: NOW },
    { id: "request-item-terminal", requestId: "request-alpha", productId: PRODUCT_SMALL, quantity: 40, status: "received", createdAt: NOW, updatedAt: NOW },
    { id: "request-item-closed-parent", requestId: "request-terminal", productId: PRODUCT_SMALL, quantity: 100, status: "partially_delivered", createdAt: NOW, updatedAt: NOW },
    { id: "request-item-beta", requestId: "request-beta", productId: PRODUCT_SMALL, quantity: 7, status: "partially_received", createdAt: NOW, updatedAt: NOW },
  ])

  await inMemoryDb.insert(schema.purchaseOrders).values([
    { id: "order-via-office", code: "OC-AV-001", worksiteId: WS_ALPHA, supplierId: SUPPLIER_ID, createdBy: USER_ID, status: "partially_office_received", deliveryMode: "via_oficina", createdAt: NOW, updatedAt: NOW },
    { id: "order-direct", code: "OC-AV-002", worksiteId: WS_ALPHA, supplierId: SUPPLIER_ID, createdBy: USER_ID, status: "partially_received", deliveryMode: "directo_faena", createdAt: NOW, updatedAt: NOW },
    { id: "order-cancelled", code: "OC-AV-003", worksiteId: WS_ALPHA, supplierId: SUPPLIER_ID, createdBy: USER_ID, status: "cancelled", deliveryMode: "directo_faena", createdAt: NOW, updatedAt: NOW },
    { id: "order-closed", code: "OC-AV-004", worksiteId: WS_ALPHA, supplierId: SUPPLIER_ID, createdBy: USER_ID, status: "closed", deliveryMode: "directo_faena", createdAt: NOW, updatedAt: NOW },
    { id: "order-beta", code: "OC-AV-005", worksiteId: WS_BETA, supplierId: SUPPLIER_ID, createdBy: USER_ID, status: "sent", deliveryMode: "directo_faena", createdAt: NOW, updatedAt: NOW },
  ])
  await inMemoryDb.insert(schema.purchaseOrderItems).values([
    { id: "order-line-via", purchaseOrderId: "order-via-office", requestItemId: "request-item-s", productId: PRODUCT_SMALL, quantity: 10, quantityOfficeReceived: 6, quantityReceived: 4, status: "issued" },
    { id: "order-line-cancelled", purchaseOrderId: "order-via-office", productId: PRODUCT_SMALL, quantity: 100, status: "cancelled" },
    { id: "order-line-service", purchaseOrderId: "order-via-office", requestItemId: "request-item-service", productId: SERVICE, quantity: 50, status: "issued" },
    { id: "order-line-direct", purchaseOrderId: "order-direct", requestItemId: "request-item-l", productId: PRODUCT_LARGE, quantity: 5, quantityReceived: 1, status: "issued" },
    { id: "order-line-cancelled-parent", purchaseOrderId: "order-cancelled", productId: PRODUCT_SMALL, quantity: 100, status: "issued" },
    { id: "order-line-closed-parent", purchaseOrderId: "order-closed", productId: PRODUCT_SMALL, quantity: 100, status: "issued" },
    { id: "order-line-beta", purchaseOrderId: "order-beta", requestItemId: "request-item-beta", productId: PRODUCT_SMALL, quantity: 9, status: "issued" },
  ])

  await inMemoryDb.insert(schema.deliveries).values([
    { id: "delivery-s", code: "ENT-AV-001", deliveredBy: USER_ID, destinationType: "worker", sourceWorksiteId: WS_ALPHA, worksiteId: WS_ALPHA, createdAt: NOW },
    { id: "delivery-l", code: "ENT-AV-002", deliveredBy: USER_ID, destinationType: "worker", sourceWorksiteId: WS_ALPHA, worksiteId: WS_ALPHA, createdAt: NOW },
    { id: "delivery-void", code: "ENT-AV-003", deliveredBy: USER_ID, destinationType: "worker", sourceWorksiteId: WS_ALPHA, worksiteId: WS_ALPHA, voidedAt: NOW, voidedBy: USER_ID, voidReason: "Registro duplicado", createdAt: NOW },
  ])
  await inMemoryDb.insert(schema.deliveryItems).values([
    { id: "delivery-line-s", deliveryId: "delivery-s", requestItemId: "request-item-s", productId: PRODUCT_SMALL, quantity: 2 },
    { id: "delivery-line-l", deliveryId: "delivery-l", requestItemId: "request-item-l", productId: PRODUCT_LARGE, quantity: 1 },
    { id: "delivery-line-void", deliveryId: "delivery-void", requestItemId: "request-item-s", productId: PRODUCT_SMALL, quantity: 5 },
  ])
})

afterAll(async () => pg.close())

describe("getStockAvailability", () => {
  it("projects direct and via-office lifecycle quantities by final worksite and concrete product", async () => {
    const rows = await getStockAvailability(scopedSession([WS_ALPHA]))

    expect(rows).toEqual([
      {
        worksiteId: WS_ALPHA,
        productId: PRODUCT_LARGE,
        onHand: 1,
        pendingDemand: 5,
        incoming: 4,
        projectedBalance: 0,
      },
      {
        worksiteId: WS_ALPHA,
        productId: PRODUCT_SMALL,
        onHand: 3,
        pendingDemand: 8,
        incoming: 6,
        projectedBalance: 1,
      },
    ])
  })

  it("intersects a selected worksite with the session scope", async () => {
    const rows = await getStockAvailability(scopedSession([WS_ALPHA]), { worksiteId: WS_BETA })

    expect(rows).toEqual([])
  })
})
