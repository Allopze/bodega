import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { setVehicleWorksiteForTest } from "@/lib/testing/fleet-stays"

/**
 * Invariante de las estadías por faena contra Postgres de verdad:
 * `fuel_vehicles.worksite_id` es siempre la faena de la estadía abierta, y lo
 * hace cumplir la base (trigger diferido), no una convención del código.
 */

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB

/**
 * Drizzle envuelve el error de Postgres en un `DrizzleQueryError` ("Failed query: …") y deja el
 * original en `cause`: el mensaje del trigger hay que buscarlo en toda la cadena.
 */
async function rejectionText(promise: PromiseLike<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const parts: string[] = []
    for (let current: unknown = error; current instanceof Error; current = current.cause) parts.push(current.message)
    return parts.join(" | ")
  }
  throw new Error("Se esperaba un rechazo y la operación terminó bien")
}

let seq = 0
async function newVehicle(worksiteId = "ws-a"): Promise<string> {
  seq += 1
  const id = `v-stay-${seq}`
  await db.insert(schema.fuelVehicles).values({
    id, plate: `ST-${seq}`, type: "Camión", equipmentTypeId: "fet-stay", worksiteId,
    fileName: "x", filePath: "x",
  })
  return id
}

async function staysOf(vehicleId: string) {
  return db.select({
    worksiteId: schema.fuelVehicleWorksiteIntervals.worksiteId,
    startedOn: schema.fuelVehicleWorksiteIntervals.startedOn,
    endedOn: schema.fuelVehicleWorksiteIntervals.endedOn,
    source: schema.fuelVehicleWorksiteIntervals.source,
  }).from(schema.fuelVehicleWorksiteIntervals)
    .where(eq(schema.fuelVehicleWorksiteIntervals.vehicleId, vehicleId))
    .orderBy(sql`${schema.fuelVehicleWorksiteIntervals.startedOn} ASC NULLS FIRST`)
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await db.insert(schema.worksites).values([
    { id: "ws-a", name: "Faena A", code: "FN-A", isActive: true, createdAt: now, updatedAt: now },
    { id: "ws-b", name: "Faena B", code: "FN-B", isActive: true, createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.fuelEquipmentTypes).values({ id: "fet-stay", slug: "t-stay", name: "Camión", category: "truck", defaultMeterType: "odometer" })
})

describe("estadías por faena", () => {
  it("al crear un vehículo abre su primera estadía sin inicio", async () => {
    const id = await newVehicle()
    expect(await staysOf(id)).toEqual([{ worksiteId: "ws-a", startedOn: null, endedOn: null, source: "alta" }])
  })

  it("rechaza cambiar la faena sin mover la estadía", async () => {
    const id = await newVehicle()
    const text = await rejectionText(db.update(schema.fuelVehicles).set({ worksiteId: "ws-b" }).where(eq(schema.fuelVehicles.id, id)))
    expect(text).toContain("FLEET_STAY_INVARIANT")
    const [row] = await db.select({ worksiteId: schema.fuelVehicles.worksiteId }).from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, id))
    expect(row.worksiteId).toBe("ws-a")
  })

  it("acepta cambiar faena y estadía en la misma transacción", async () => {
    const id = await newVehicle()
    await setVehicleWorksiteForTest(db, id, "ws-b", "2026-11-15")
    expect(await staysOf(id)).toEqual([
      { worksiteId: "ws-a", startedOn: null, endedOn: "2026-11-14", source: "alta" },
      { worksiteId: "ws-b", startedOn: "2026-11-15", endedOn: null, source: "reconstruccion" },
    ])
  })

  it("rechaza un hueco entre estadías", async () => {
    const id = await newVehicle()
    const text = await rejectionText(db.transaction(async (tx) => {
      await tx.update(schema.fuelVehicleWorksiteIntervals)
        .set({ endedOn: "2026-11-10" })
        .where(eq(schema.fuelVehicleWorksiteIntervals.vehicleId, id))
      await tx.insert(schema.fuelVehicleWorksiteIntervals).values({
        id: `gap-${id}`, vehicleId: id, worksiteId: "ws-b", startedOn: "2026-11-15", source: "reconstruccion",
      })
      await tx.update(schema.fuelVehicles).set({ worksiteId: "ws-b" }).where(eq(schema.fuelVehicles.id, id))
    }))
    expect(text).toContain("FLEET_STAY_INVARIANT")
  })

  it("las filas GPS ya no arrastran la faena", async () => {
    const id = await newVehicle()
    await db.insert(schema.fleetGpsSyncRuns).values({ id: `run-${id}`, provider: "onway", trigger: "manual", status: "success" })
    await db.insert(schema.fleetGpsPositionHistory).values({
      id: `gph-${id}`, provider: "onway", externalDeviceId: `dev-${id}`, externalPointKey: "p1",
      vehicleId: id, worksiteId: "ws-a", occurredAt: "2026-11-01T12:00:00Z", latitude: -37.1, longitude: -72.5, speedKph: 10,
    })
    await setVehicleWorksiteForTest(db, id, "ws-b", "2026-11-15")
    const [row] = await db.select({ worksiteId: schema.fleetGpsPositionHistory.worksiteId })
      .from(schema.fleetGpsPositionHistory).where(eq(schema.fleetGpsPositionHistory.id, `gph-${id}`))
    expect(row.worksiteId).toBe("ws-a")
  })
})
