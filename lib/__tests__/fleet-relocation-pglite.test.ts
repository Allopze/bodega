import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"

/**
 * El traslado de faena de un equipo cierra su contrato y mueve sus mapeos de
 * combustible en una sola operación.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { relocateVehicleWorksiteTx } = await import("@/lib/services/fleet-relocation")

const relocate = (extra: { effectiveFrom?: string } = {}) =>
  testDb.transaction((tx) => relocateVehicleWorksiteTx(tx as unknown as Tx, { vehicleId: "v-1", worksiteId: "w-b", actorUserId: "u-1", ...extra }))

const assignments = () => testDb.select().from(schema.contractVehicleAssignments).orderBy(asc(schema.contractVehicleAssignments.validFrom))
const mappings = () => testDb.select().from(schema.fuelProviderMappings)
  .orderBy(asc(schema.fuelProviderMappings.sourceAccount), asc(schema.fuelProviderMappings.version))

beforeEach(async () => {
  await pg.exec("TRUNCATE audit_log, contract_vehicle_assignments, fuel_provider_mappings, contracts, clients, fuel_vehicles, worksites, users CASCADE")
  await testDb.insert(schema.users).values({ id: "u-1", name: "Jefatura", email: "j@chome.test", hashedPassword: "x" })
  await testDb.insert(schema.worksites).values([
    { id: "w-a", name: "Arauco", code: "W-A", isActive: true },
    { id: "w-b", name: "Biodiversa", code: "W-B", isActive: true },
  ])
  // El vehículo ya está en su faena nueva: el traslado de la fila lo hace quien llama.
  await testDb.insert(schema.fuelVehicles).values({ id: "v-1", plate: "RBYD98", code: "KA-11", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-b" })
  await testDb.insert(schema.clients).values({ id: "cl-1", rut: "76123456-0", name: "Maderas Arauco S.A." })
  await testDb.insert(schema.contracts).values({ id: "c-1", code: "CTR-2026-0001", clientId: "cl-1", name: "Movimiento de residuos", worksiteId: "w-a", billingCycle: "none" })
  await testDb.insert(schema.contractVehicleAssignments).values({ id: "a-1", contractId: "c-1", vehicleId: "v-1", validFrom: "2026-03-01" })
  await testDb.insert(schema.fuelProviderMappings).values(["tct:diesel", "tct:bluemax"].map((sourceAccount) => ({
    id: `m-${sourceAccount}`, provider: "copec", sourceAccount, externalKey: "RBYD98", normalizedValue: "RBYD98",
    worksiteId: "w-a", vehicleId: "v-1", decidedBy: "u-1", reason: "desde 2026", effectiveFrom: "2026-01-01",
  })))
})

describe("relocateVehicleWorksiteTx", () => {
  it("trasladar cierra el contrato y mueve los mapeos el mismo día", async () => {
    expect(await relocate({ effectiveFrom: "2026-11-10" })).toEqual({ movedMappings: 2, closedAssignments: 1 })

    expect((await assignments()).map((a) => [a.contractId, a.validFrom, a.validTo])).toEqual([["c-1", "2026-03-01", "2026-11-09"]])
    expect((await mappings()).map((m) => [m.sourceAccount, m.version, m.worksiteId, m.effectiveFrom, m.effectiveTo, m.isActive])).toEqual([
      ["tct:bluemax", 1, "w-a", "2026-01-01", "2026-11-09", false],
      ["tct:bluemax", 2, "w-b", "2026-11-10", null, true],
      ["tct:diesel", 1, "w-a", "2026-01-01", "2026-11-09", false],
      ["tct:diesel", 2, "w-b", "2026-11-10", null, true],
    ])
  })

  it("sin fecha explícita traslada desde hoy en Chile", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"))
    try {
      expect(await relocate()).toEqual({ movedMappings: 2, closedAssignments: 1 })
      expect((await assignments()).map((a) => a.validTo)).toEqual(["2026-11-19"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("un equipo sin contrato ni mapeos no cambia nada y lo dice con ceros", async () => {
    await pg.exec("TRUNCATE contract_vehicle_assignments, fuel_provider_mappings")
    expect(await relocate({ effectiveFrom: "2026-11-10" })).toEqual({ movedMappings: 0, closedAssignments: 0 })
  })

  it("si un paso falla, ninguno queda aplicado", async () => {
    await expect(testDb.transaction(async (tx) => {
      await relocateVehicleWorksiteTx(tx as unknown as Tx, { vehicleId: "v-1", worksiteId: "w-b", actorUserId: "u-1", effectiveFrom: "2026-11-10" })
      throw new Error("falla posterior del llamador")
    })).rejects.toThrow("falla posterior")
    expect((await assignments()).map((a) => a.validTo)).toEqual([null])
    expect((await mappings()).filter((m) => m.isActive).map((m) => m.worksiteId)).toEqual(["w-a", "w-a"])
  })
})
