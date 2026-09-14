/**
 * Los dos daños que dejó el formulario de entregas, reproducidos con la forma
 * exacta que tenían en producción: catorce líneas de entre 0,01 y 0,07 EPP y
 * treinta y un ítems recibidos que nadie terminó de entregar.
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

import {
  findStrandedRequestItems,
  findSuspectDeliveryLines,
} from "@/scripts/diagnose-delivery-quantities"

const USER_ID = "user-diag"
const WORKSITE_ID = "ws-diag"
const WORKER_ID = "wrk-diag"
const CATEGORY_ID = "cat-diag"
const GLOVE_ID = "prod-diag-guante"
const FUEL_ID = "prod-diag-litros"

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()

  await inMemoryDb.insert(schema.worksites).values({
    id: WORKSITE_ID, name: "Faena Diagnóstico", code: "DIAG", isActive: true, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Bodeguero", email: "diag@chome.cl", hashedPassword: "x",
    isActive: true, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.workers).values({
    id: WORKER_ID, firstName: "José Miguel", lastName: "Seguel", worksiteId: WORKSITE_ID,
    isActive: true, createdAt: now,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: CATEGORY_ID, name: "EPP", slug: "epp-diag", sortOrder: 0,
  })
  await inMemoryDb.insert(schema.products).values([
    { id: GLOVE_ID, sku: "G-1", name: "Guante Activex", categoryId: CATEGORY_ID,
      unitOfMeasure: "unidad", isActive: true, isService: false, createdAt: now, updatedAt: now },
    { id: FUEL_ID, sku: "L-1", name: "Desengrasante", categoryId: CATEGORY_ID,
      // CAT-003: la unidad del producto es ahora una FK contra `product_units`;
      // el catálogo sembrado usa el código "litro" (singular). El ítem de
      // entrega de más abajo conserva su texto libre, que no está restringido.
      unitOfMeasure: "litro", isActive: true, isService: false, createdAt: now, updatedAt: now },
  ])

  // La solicitud recibida que nadie terminó de entregar.
  await inMemoryDb.insert(schema.purchaseRequests).values({
    id: "req-diag", code: "SOL-0002", worksiteId: WORKSITE_ID, requesterId: USER_ID,
    urgency: "normal", status: "in_purchasing", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.purchaseRequestItems).values({
    id: "req-item-diag", requestId: "req-diag", productId: GLOVE_ID, quantity: 40,
    unitOfMeasure: "unidad", status: "received", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.suppliers).values({
    id: "sup-diag", name: "Proveedor", isActive: true, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.purchaseOrders).values({
    id: "oc-diag", code: "OC-DIAG", worksiteId: WORKSITE_ID, supplierId: "sup-diag",
    createdBy: USER_ID, status: "received", deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.purchaseOrderItems).values({
    id: "oci-diag", purchaseOrderId: "oc-diag", requestItemId: "req-item-diag",
    productId: GLOVE_ID, quantity: 40, quantityReceived: 40, unitOfMeasure: "unidad", sortOrder: 0,
  })

  await inMemoryDb.insert(schema.deliveries).values([
    { id: "ent-corrupta", code: "ENT-2026-0012", deliveredBy: USER_ID, deliveredAt: now,
      destinationType: "worker", sourceWorksiteId: WORKSITE_ID, worksiteId: WORKSITE_ID,
      workerId: WORKER_ID, receiverName: "José Miguel Seguel", createdAt: now },
    { id: "ent-sana", code: "ENT-2026-0013", deliveredBy: USER_ID, deliveredAt: now,
      destinationType: "worker", sourceWorksiteId: WORKSITE_ID, worksiteId: WORKSITE_ID,
      workerId: WORKER_ID, receiverName: "José Miguel Seguel", createdAt: now },
  ])
  await inMemoryDb.insert(schema.deliveryItems).values([
    // El daño ×100: cuatro clics de la flecha desde un campo vacío.
    { id: "di-corrupta", deliveryId: "ent-corrupta", productId: GLOVE_ID,
      quantity: 0.04, unitOfMeasure: "unidad", requestItemId: null },
    // Fracción legítima: los litros se miden, no se cuentan.
    { id: "di-litros", deliveryId: "ent-sana", productId: FUEL_ID,
      quantity: 2.5, unitOfMeasure: "litros", requestItemId: null },
  ])
})

afterAll(async () => { await pg.close() })

describe("findSuspectDeliveryLines()", () => {
  it("flags a fraction of a counted unit and proposes the ×100 the operador quiso", async () => {
    const rows = await findSuspectDeliveryLines()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      deliveryCode:    "ENT-2026-0012",
      productName:     "Guante Activex",
      recordedQty:     0.04,
      inferredQty:     4,
      linkedToRequest: false,
    })
  })

  it("leaves a measurable unit alone: 2,5 litros es una cantidad real", async () => {
    const rows = await findSuspectDeliveryLines()
    expect(rows.map((row) => row.productName)).not.toContain("Desengrasante")
  })
})

describe("findStrandedRequestItems()", () => {
  it("reports the received item that blocks its request from ever closing", async () => {
    const rows = await findStrandedRequestItems()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      requestCode:  "SOL-0002",
      productName:  "Guante Activex",
      requestedQty: 40,
      receivedQty:  40,
      deliveredQty: 0,
      pendingQty:   40,
    })
  })
})
