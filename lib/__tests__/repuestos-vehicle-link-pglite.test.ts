/**
 * Vínculo del ítem de solicitud con el equipo de flota y la OT (2026-11-07):
 * las dos restricciones nuevas de `purchase_request_items` y que la compra
 * parcial no pierda el vínculo en el remanente.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema })
const testGlobal = globalThis as unknown as { __db?: typeof testDb }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("@/lib/email/smtp", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { IDS, seedMantFixtures } = await import("./mantencion-sync-fixtures")
const { createWorkOrderWithClient } = await import("@/lib/services/mantencion/work-orders/create")
const { createOrder } = await import("@/lib/services/purchasing")

const now = new Date().toISOString()
let workOrderId = ""

/** El mensaje del error de Postgres, venga directo o envuelto por drizzle. */
async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause
    return `${String((error as Error).message)} ${cause ? String((cause as Error).message ?? cause) : ""}`
  }
  throw new Error("Se esperaba que la escritura fallara")
}

async function insertRequest(id: string, status = "approved") {
  await testDb.insert(schema.purchaseRequests).values({
    id, code: `REP-T-${id}`, worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: "repuestos",
    status, urgency: "high", deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
  })
}

describe("purchase_request_items · vehículo, OT y precio estimado", () => {
  beforeAll(async () => {
    await seedMantFixtures(testDb as unknown as DB)
    await testDb.insert(schema.suppliers).values({
      id: "sup-rep", name: "Repuestos del Sur", rut: "76.000.111-1", isActive: true, createdAt: now, updatedAt: now,
    })
    const created = await testDb.transaction((tx) => createWorkOrderWithClient(tx as never, {
      vehicleId: IDS.truckBio, inspectionFindingId: null, repair: true, maintenance: false,
      repairDescription: "Fuga hidráulica", observations: null, requesterName: "Alexis Morales",
    }, { userId: IDS.jefe, name: "Alexis Morales" }))
    workOrderId = created.id
    await insertRequest("req-a")
  })

  afterAll(async () => {
    await pg.close()
  })

  it("rechaza work_order_id sin vehicle_id", async () => {
    const message = await failure(() => testDb.insert(schema.purchaseRequestItems).values({
      id: "item-bad-ot", requestId: "req-a", productNameFree: "Manguera", quantity: 1, status: "approved",
      workOrderId, createdAt: now, updatedAt: now,
    }))
    expect(message).toContain("purchase_request_items_work_order_needs_vehicle")
  })

  it("rechaza vehicle_id junto a equipment_id", async () => {
    await testDb.insert(schema.serviceEquipment).values({
      id: "eq-mono", code: "MONO-1", name: "Monogás", kind: "monogas", worksiteId: IDS.wsBio, isActive: true, createdAt: now, updatedAt: now,
    })
    const message = await failure(() => testDb.insert(schema.purchaseRequestItems).values({
      id: "item-bad-subject", requestId: "req-a", productNameFree: "Sensor", quantity: 1, status: "approved",
      vehicleId: IDS.truckBio, equipmentId: "eq-mono", createdAt: now, updatedAt: now,
    }))
    expect(message).toContain("purchase_request_items_one_asset_subject")
  })

  it("la compra parcial conserva vehículo, OT y precio estimado en el remanente", async () => {
    await insertRequest("req-split")
    await testDb.insert(schema.purchaseRequestItems).values({
      id: "item-split", requestId: "req-split", productNameFree: "Filtro hidráulico", quantity: 4, status: "approved",
      vehicleId: IDS.truckBio, workOrderId, estimatedUnitPrice: 35_000, createdAt: now, updatedAt: now,
    })

    await createOrder({
      worksiteId: IDS.wsBio, supplierId: "sup-rep", createdBy: IDS.jefe,
      items: [{ requestItemId: "item-split", productId: null, productNameFree: "Filtro hidráulico", quantity: 1, unitOfMeasure: "unidad", unitPrice: 34_000 }],
    })

    const siblings = await testDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.splitFromItemId, "item-split"))
    expect(siblings).toHaveLength(1)
    expect(siblings[0]).toMatchObject({
      quantity: 3, vehicleId: IDS.truckBio, workOrderId, estimatedUnitPrice: 35_000,
    })
  })
})
