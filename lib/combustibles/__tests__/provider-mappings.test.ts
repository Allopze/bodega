import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"

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

const { moveProviderMappingsWithVehicleTx } = await import("../provider-mappings")
const { loadVehicleResolver } = await import("../plate-resolver")

async function move(worksiteId: string, effectiveFrom: string) {
  return testDb.transaction((tx) => moveProviderMappingsWithVehicleTx(tx as unknown as Tx, { vehicleId: "v-1", worksiteId, actorUserId: "u-1", effectiveFrom }))
}

const mappings = () => testDb.select().from(schema.fuelProviderMappings).orderBy(asc(schema.fuelProviderMappings.sourceAccount), asc(schema.fuelProviderMappings.version))

beforeEach(async () => {
  await pg.exec("TRUNCATE audit_log, fuel_provider_mappings, fuel_vehicles, worksites, users CASCADE")
  await testDb.insert(schema.users).values({ id: "u-1", name: "Jefatura", email: "j@chome.test", hashedPassword: "x" })
  await testDb.insert(schema.worksites).values([
    { id: "w-a", name: "Arauco", code: "W-A", isActive: true },
    { id: "w-b", name: "Biodiversa", code: "W-B", isActive: true },
  ])
  // El vehículo ya está en su faena nueva: el traslado lo hace quien llama.
  await testDb.insert(schema.fuelVehicles).values({ id: "v-1", plate: "RBYD-98", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-b" })
  await testDb.insert(schema.fuelProviderMappings).values(["tct:diesel", "tct:bluemax"].map((sourceAccount) => ({
    id: `m-${sourceAccount}`, provider: "copec", sourceAccount, externalKey: "RBYD98", normalizedValue: "RBYD98",
    worksiteId: "w-a", vehicleId: "v-1", decidedBy: "u-1", reason: "desde 2026", effectiveFrom: "2026-01-01",
  })))
})

describe("las asignaciones de proveedor siguen al vehículo cuando cambia de faena", () => {
  it("cierra la vigente el día anterior y abre una versión nueva en la faena nueva, con bitácora", async () => {
    expect(await move("w-b", "2026-11-10")).toBe(2)
    const rows = await mappings()
    expect(rows.map((m) => [m.sourceAccount, m.version, m.worksiteId, m.effectiveFrom, m.effectiveTo, m.isActive, m.supersedesId])).toEqual([
      ["tct:bluemax", 1, "w-a", "2026-01-01", "2026-11-09", false, null],
      ["tct:bluemax", 2, "w-b", "2026-11-10", null, true, "m-tct:bluemax"],
      ["tct:diesel", 1, "w-a", "2026-01-01", "2026-11-09", false, null],
      ["tct:diesel", 2, "w-b", "2026-11-10", null, true, "m-tct:diesel"],
    ])
    const audit = await testDb.select().from(schema.auditLog)
    expect(audit).toHaveLength(2)
    expect(audit.every((row) => row.entityType === "fuel_provider_mapping" && row.userId === "u-1")).toBe(true)
  })

  it("con el traslado, el resolvedor reparte por fecha y deja pendiente el agregado del mes que lo cruza", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"))
    try {
      await move("w-b", "2026-11-10")
      const resolve = await loadVehicleResolver({ provider: "copec", sourceAccount: "tct:diesel" })
      expect(resolve("RBYD98", "2026-10-01", "2026-10-31")).toMatchObject({ id: "v-1", worksiteId: "w-a" })
      expect(resolve("RBYD98", "2026-11-15", "2026-11-15")).toMatchObject({ id: "v-1", worksiteId: "w-b" })
      expect(resolve("RBYD98", "2026-11-01", "2026-11-30")).toBeUndefined()
      // Sin fecha (mes en curso) manda la versión activa.
      expect(resolve("RBYD98")).toMatchObject({ worksiteId: "w-b" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("una asignación que todavía no entraba en vigor se corrige en el lugar", async () => {
    await testDb.update(schema.fuelProviderMappings).set({ effectiveFrom: "2026-11-10" })
    expect(await move("w-b", "2026-11-10")).toBe(2)
    const rows = await mappings()
    expect(rows.map((m) => [m.version, m.worksiteId, m.effectiveFrom, m.isActive])).toEqual([
      [1, "w-b", "2026-11-10", true],
      [1, "w-b", "2026-11-10", true],
    ])
  })

  it("no toca nada si las asignaciones ya están en la faena del vehículo", async () => {
    expect(await move("w-a", "2026-11-10")).toBe(0)
    expect((await mappings()).every((m) => m.version === 1 && m.isActive)).toBe(true)
    expect(await testDb.select().from(schema.auditLog)).toHaveLength(0)
  })

  it("no toca las asignaciones de otro vehículo", async () => {
    await testDb.insert(schema.fuelVehicles).values({ id: "v-2", plate: "SGCP-77", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-a" })
    await testDb.insert(schema.fuelProviderMappings).values({
      id: "m-otro", provider: "copec", sourceAccount: "tct:diesel", externalKey: "SGCP77", normalizedValue: "SGCP77",
      worksiteId: "w-a", vehicleId: "v-2", decidedBy: "u-1", reason: "x", effectiveFrom: "2026-01-01",
    })
    await move("w-b", "2026-11-10")
    expect((await testDb.select().from(schema.fuelProviderMappings).where(eq(schema.fuelProviderMappings.id, "m-otro")))[0]).toMatchObject({ worksiteId: "w-a", isActive: true })
  })
})
