import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { setVehicleWorksiteForTest } from "@/lib/testing/fleet-stays"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { todayInChile } from "@/lib/utils"

/*
 * «Incorporar desde la flota» a una faena distinta de la del vehículo es un TRASLADO (la faena sólo
 * cambia por esa puerta): folio, estadía nueva, asignaciones de proveedor desde hoy. Si el traslado
 * se rechaza, no queda ficha, ni cambio de faena, ni traslado a medias. Y un UPDATE directo de la
 * faena lo frena la base con un error que las acciones traducen a la regla de negocio.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const { createEquipment } = await import("@/lib/services/mantencion/equipment")
type EquipmentInput = import("@/lib/services/mantencion/equipment").EquipmentInput
const { isFleetStayInvariantError } = await import("@/lib/services/fleet-transfers")

const actor = { userId: "u-incorpora", email: "incorpora@example.test" }
const T = "t-camion"
const B = "b-scania"
const WS = { arauco: "ws-arauco", cholguan: "ws-cholguan" } as const

function input(overrides: Partial<EquipmentInput> = {}): EquipmentInput {
  return {
    code: "KA-300", plate: "GHJK-34", noPlate: false, equipmentTypeId: T, brandId: B, model: "R450", year: 2021,
    worksiteId: WS.arauco, newWorksiteName: "", scheduleId: null, initialReading: null, initialReadingDate: null,
    ...overrides,
  }
}

const transfers = () => testDb.select().from(schema.fleetTransfers)
const stays = (vehicleId: string) => testDb.select().from(schema.fuelVehicleWorksiteIntervals).where(eq(schema.fuelVehicleWorksiteIntervals.vehicleId, vehicleId))
const vehicle = async (id: string) => (await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, id)))[0]
const profile = async (id: string) => (await testDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, id)))[0]

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: actor.userId, name: "Quien incorpora", email: actor.email, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([
    { id: WS.arauco, name: "Arauco", code: "FN-ARA", isActive: true },
    { id: WS.cholguan, name: "Cholguán", code: "FN-CHO", isActive: true },
  ])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: T, slug: "test-camion", name: "Camión (prueba)", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  await testDb.insert(schema.mantBrands).values({ id: B, name: "Scania", nameKey: "scania" })
  await testDb.insert(schema.fuelVehicles).values([
    { id: "veh-otra-faena", plate: "GHJK34", code: "KA-300", type: "test-camion", equipmentTypeId: T, worksiteId: WS.cholguan, isActive: true },
    { id: "veh-misma-faena", plate: "BCDF12", code: "KA-301", type: "test-camion", equipmentTypeId: T, worksiteId: WS.arauco, isActive: true },
    { id: "veh-recien", plate: "DFGH56", code: "KA-302", type: "test-camion", equipmentTypeId: T, worksiteId: WS.cholguan, isActive: true },
  ])
  await testDb.insert(schema.fuelProviderMappings).values({
    id: "map-GHJK34", provider: "copec", sourceAccount: "tct:diesel", externalKey: "GHJK34", normalizedValue: "GHJK34",
    worksiteId: WS.cholguan, vehicleId: "veh-otra-faena", decidedBy: actor.userId, reason: "prueba", effectiveFrom: "2026-01-01",
  })
})

describe("incorporar desde la flota a otra faena", () => {
  it("crea el traslado TR-0001 con su motivo, abre la segunda estadía y mueve la asignación de proveedor", async () => {
    const result = await createEquipment(actor, input())
    expect(result).toMatchObject({ ok: true, data: { vehicleId: "veh-otra-faena", incorporated: true } })

    expect(await transfers()).toEqual([expect.objectContaining({
      folio: "TR-0001", toWorksiteId: WS.arauco, effectiveDate: todayInChile(),
      reason: "Incorporación a Mantención de equipos", authorizedBy: "Mantención de equipos", createdBy: actor.userId,
    })])
    const recorrido = await stays("veh-otra-faena")
    expect(recorrido).toHaveLength(2)
    expect(recorrido.find((stay) => stay.endedOn === null)).toMatchObject({ worksiteId: WS.arauco, source: "traslado", startedOn: todayInChile() })
    expect(await vehicle("veh-otra-faena")).toMatchObject({ worksiteId: WS.arauco })
    expect(await profile("veh-otra-faena")).toBeDefined()

    const mappings = await testDb.select().from(schema.fuelProviderMappings).where(eq(schema.fuelProviderMappings.externalKey, "GHJK34"))
    expect(mappings.filter((row) => row.isActive)).toEqual([expect.objectContaining({ worksiteId: WS.arauco, effectiveFrom: todayInChile() })])
  })

  it("en la misma faena no hay traslado: sólo se crea la ficha", async () => {
    const before = (await transfers()).length
    const result = await createEquipment(actor, input({ code: "KA-301", plate: "BCDF-12", worksiteId: WS.arauco }))
    expect(result).toMatchObject({ ok: true, data: { incorporated: true } })
    expect(await transfers()).toHaveLength(before)
    expect(await stays("veh-misma-faena")).toHaveLength(1)
  })

  it("si el traslado se rechaza, lo dice en la faena y no deja ficha, traslado ni cambio de faena", async () => {
    // Llegó a Cholguán hoy: el traslado de hoy no es posterior a su estadía actual.
    await setVehicleWorksiteForTest(testDb, "veh-recien", WS.cholguan, todayInChile())
    const before = (await transfers()).length
    const result = await createEquipment(actor, input({ code: "KA-302", plate: "DFGH-56", worksiteId: WS.arauco }))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.fieldErrors.worksiteId).toMatch(/la fecha debe ser posterior/)
    expect(await vehicle("veh-recien")).toMatchObject({ worksiteId: WS.cholguan })
    expect(await profile("veh-recien")).toBeUndefined()
    expect(await transfers()).toHaveLength(before)
  })
})

describe("un UPDATE directo de la faena", () => {
  it("lo frena la base con FLEET_STAY_INVARIANT, que las acciones traducen a la regla de negocio", async () => {
    const error = await testDb.update(schema.fuelVehicles).set({ worksiteId: WS.cholguan })
      .where(eq(schema.fuelVehicles.id, "veh-misma-faena")).then(() => null, (e: unknown) => e)
    expect(error).not.toBeNull()
    expect(isFleetStayInvariantError(error)).toBe(true)
    expect(await vehicle("veh-misma-faena")).toMatchObject({ worksiteId: WS.arauco })
  })
})
