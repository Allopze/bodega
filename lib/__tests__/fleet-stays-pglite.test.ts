import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { setVehicleWorksiteForTest } from "@/lib/testing/fleet-stays"
import { stayWorksiteOnDaySql } from "@/lib/fleet/stays-sql"

/**
 * Consultas de estadía contra Postgres de verdad: la faena de un equipo en un
 * día y su recorrido ordenado con el traslado que abrió cada estadía.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { listVehicleStays } = await import("@/lib/services/fleet-stays")

let seq = 0
async function newVehicle(worksiteId = "ws-a"): Promise<string> {
  seq += 1
  const id = `v-q-${seq}`
  await testDb.insert(schema.fuelVehicles).values({
    id, plate: `QS-${seq}`, type: "Camión", equipmentTypeId: "fet-q", worksiteId,
    fileName: "x", filePath: "x",
  })
  return id
}

async function worksiteOn(vehicleId: string, day: string): Promise<string | null> {
  const [row] = await testDb.select({
    worksiteId: stayWorksiteOnDaySql(schema.fuelVehicles.id, sql`${day}::text`),
  }).from(schema.fuelVehicles).where(sql`${schema.fuelVehicles.id} = ${vehicleId}`)
  return row.worksiteId
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.worksites).values([
    { id: "ws-a", name: "Faena A", code: "FN-A", isActive: true, createdAt: now, updatedAt: now },
    { id: "ws-b", name: "Faena B", code: "FN-B", isActive: true, createdAt: now, updatedAt: now },
  ])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-q", slug: "t-q", name: "Camión", category: "truck", defaultMeterType: "odometer" })
  await testDb.insert(schema.users).values({ id: "u-q", name: "Ana Pérez", email: "ana@example.com", hashedPassword: "x" })
})

describe("faena del día según la estadía", () => {
  it("da la faena del día según la estadía", async () => {
    const id = await newVehicle("ws-a")
    await setVehicleWorksiteForTest(testDb, id, "ws-b", "2026-11-15")
    expect(await worksiteOn(id, "2026-11-14")).toBe("ws-a")
    expect(await worksiteOn(id, "2026-11-15")).toBe("ws-b")
    expect(await worksiteOn(id, "2020-01-01")).toBe("ws-a")
    expect(await worksiteOn(id, "2030-01-01")).toBe("ws-b")
  })
})

describe("listVehicleStays", () => {
  it("lista el recorrido en orden con el traslado que abrió cada estadía", async () => {
    const id = await newVehicle("ws-a")
    await testDb.insert(schema.fleetTransfers).values({
      id: "tr-q1", folio: "TR-0001", effectiveDate: "2026-11-15", toWorksiteId: "ws-b",
      reason: "Refuerzo de la faena B", authorizedBy: "Gerencia", createdBy: "u-q",
    })
    await testDb.insert(schema.fleetTransferItems).values({ id: "tri-q1", transferId: "tr-q1", vehicleId: id, fromWorksiteId: "ws-a" })
    await testDb.transaction(async (tx) => {
      await tx.update(schema.fuelVehicleWorksiteIntervals)
        .set({ endedOn: "2026-11-14" })
        .where(sql`${schema.fuelVehicleWorksiteIntervals.vehicleId} = ${id} AND ${schema.fuelVehicleWorksiteIntervals.endedOn} IS NULL`)
      await tx.insert(schema.fuelVehicleWorksiteIntervals).values({
        id: "st-q1", vehicleId: id, worksiteId: "ws-b", startedOn: "2026-11-15", source: "traslado", transferId: "tr-q1",
      })
      await tx.update(schema.fuelVehicles).set({ worksiteId: "ws-b" }).where(sql`${schema.fuelVehicles.id} = ${id}`)
    })

    const stays = await listVehicleStays(id)
    expect(stays).toHaveLength(2)
    expect(stays[0]).toMatchObject({ worksiteId: "ws-a", worksiteName: "Faena A", startedOn: null, endedOn: "2026-11-14", source: "alta", transfer: null })
    expect(stays[1]).toMatchObject({
      worksiteId: "ws-b", worksiteName: "Faena B", startedOn: "2026-11-15", endedOn: null, source: "traslado",
      transfer: {
        id: "tr-q1", folio: "TR-0001", reason: "Refuerzo de la faena B", authorizedBy: "Gerencia",
        createdByName: "Ana Pérez", voided: false,
      },
    })
  })

  it("marca el traslado anulado", async () => {
    const id = await newVehicle("ws-a")
    await testDb.insert(schema.fleetTransfers).values({
      id: "tr-q2", folio: "TR-0002", effectiveDate: "2026-11-16", toWorksiteId: "ws-b",
      reason: "Refuerzo de la faena B", authorizedBy: "Gerencia", createdBy: "u-q",
      voidedAt: new Date().toISOString(), voidedBy: "u-q", voidReason: "Se anula por error de carga",
    })
    await setVehicleWorksiteForTest(testDb, id, "ws-b", "2026-11-16")
    await testDb.update(schema.fuelVehicleWorksiteIntervals)
      .set({ source: "traslado", transferId: "tr-q2" })
      .where(sql`${schema.fuelVehicleWorksiteIntervals.vehicleId} = ${id} AND ${schema.fuelVehicleWorksiteIntervals.startedOn} = '2026-11-16'`)
    const stays = await listVehicleStays(id)
    expect(stays[1].transfer?.voided).toBe(true)
  })
})
