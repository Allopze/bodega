import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

// El script importa `@/db` estáticamente: se importa dinámicamente dentro de
// cada test, una vez asignado `testGlobal.__db`.

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const ACTOR = "jefatura@chome.test"

async function run(apply: boolean) {
  const { applyCopecDatedMappings20261030 } = await import("../apply-copec-dated-mappings-2026-10-30")
  return applyCopecDatedMappings20261030({ actorEmail: ACTOR, apply })
}

beforeEach(async () => {
  await pg.exec("TRUNCATE audit_log, fuel_provider_mappings, fuel_vehicles, worksites, users CASCADE")
  await inMemoryDb.insert(schema.users).values({ id: "u-actor", name: "Jefatura", email: ACTOR, hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "w-cho", name: "Cholguan - Arauco", code: "CHOLGUAN-ARAUCO", isActive: true },
    { id: "w-ofi", name: "Oficina Central", code: "OFICINA-CENTRAL", isActive: true },
    { id: "w-old", name: "Teno", code: "FA-009", isActive: false },
  ])
  await inMemoryDb.insert(schema.fuelVehicles).values([
    { id: "v-rbyd", plate: "RBYD-98", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-cho" },
    { id: "v-vptr", plate: "VPTR-69", type: "camioneta", equipmentTypeId: "fet-camioneta", worksiteId: "w-ofi" },
    { id: "v-baja", plate: "ZZZZ-11", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-cho", isActive: false },
    { id: "v-old", plate: "YYYY-22", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-old" },
  ])
})

describe("asignaciones Copec con fecha desde 2026-01-01", () => {
  it("en dry-run no escribe nada", async () => {
    const outcomes = await run(false)
    expect(outcomes.filter((o) => o.result === "dry-run")).toHaveLength(4)
    expect(await inMemoryDb.select().from(schema.fuelProviderMappings)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(0)
  })

  it("crea una asignación abierta por vehículo activo y cuenta, en su faena actual, con bitácora", async () => {
    await run(true)
    const mappings = await inMemoryDb.select().from(schema.fuelProviderMappings)
    expect(mappings.map((m) => [m.externalKey, m.sourceAccount, m.worksiteId, m.vehicleId, m.effectiveFrom, m.effectiveTo, m.isActive]).sort()).toEqual([
      ["RBYD98", "tct:bluemax", "w-cho", "v-rbyd", "2026-01-01", null, true],
      ["RBYD98", "tct:diesel", "w-cho", "v-rbyd", "2026-01-01", null, true],
      ["VPTR69", "tct:bluemax", "w-ofi", "v-vptr", "2026-01-01", null, true],
      ["VPTR69", "tct:diesel", "w-ofi", "v-vptr", "2026-01-01", null, true],
    ])
    // Ni el vehículo dado de baja ni el de una faena dada de baja reciben asignación.
    expect(mappings.some((m) => m.vehicleId === "v-baja" || m.vehicleId === "v-old")).toBe(false)
    const audit = await inMemoryDb.select().from(schema.auditLog)
    expect(audit).toHaveLength(4)
    expect(audit.every((row) => row.entityType === "fuel_provider_mapping" && row.userId === "u-actor")).toBe(true)
  })

  // Es el motivo del script: sin asignación con fecha un mes cerrado no se atribuye.
  it("con las asignaciones, el resolvedor atribuye un mes cerrado de 2026 que antes quedaba pendiente", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-30T12:00:00.000Z"))
    try {
      const { loadVehicleResolver } = await import("@/lib/combustibles/plate-resolver")
      const before = await loadVehicleResolver({ provider: "copec", sourceAccount: "tct:diesel" })
      expect(before("RBYD98", "2026-03-01", "2026-03-31")).toBeUndefined()

      await run(true)
      const after = await loadVehicleResolver({ provider: "copec", sourceAccount: "tct:diesel" })
      expect(after("RBYD98", "2026-03-01", "2026-03-31")).toMatchObject({ id: "v-rbyd", worksiteId: "w-cho" })
      // Antes del 2026-01-01 sigue sin evidencia: el historial previo no se inventa.
      expect(after("RBYD98", "2025-12-01", "2025-12-31")).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it("no toca una asignación activa existente y repetir no escribe nada", async () => {
    await inMemoryDb.insert(schema.fuelProviderMappings).values({
      id: "m-prev", provider: "copec", sourceAccount: "tct:diesel", externalKey: "RBYD98", normalizedValue: "RBYD98",
      worksiteId: "w-ofi", vehicleId: "v-rbyd", decidedBy: "u-actor", reason: "vínculo manual", effectiveFrom: "2026-05-01",
    })
    const first = await run(true)
    expect(first.find((o) => o.item === "RBYD-98" && o.action.includes("tct:diesel"))).toMatchObject({ result: "ya estaba", detail: expect.stringMatching(/otro vehículo o faena/) })
    expect((await inMemoryDb.select().from(schema.fuelProviderMappings)).find((m) => m.id === "m-prev")?.worksiteId).toBe("w-ofi")

    const auditAfterFirst = (await inMemoryDb.select().from(schema.auditLog)).length
    const second = await run(true)
    expect(second.filter((o) => o.result === "aplicado")).toEqual([])
    expect((await inMemoryDb.select().from(schema.auditLog)).length).toBe(auditAfterFirst)
  })

  it("no decide entre dos vehículos activos con la misma patente", async () => {
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: "v-dup", plate: "VPTR69", type: "camioneta", equipmentTypeId: "fet-camioneta", worksiteId: "w-cho" })
    const outcomes = await run(true)
    expect(outcomes.filter((o) => o.item.replace("-", "") === "VPTR69").map((o) => o.result)).toEqual(["omitido", "omitido"])
  })

  it("exige un responsable activo para la bitácora", async () => {
    const { applyCopecDatedMappings20261030 } = await import("../apply-copec-dated-mappings-2026-10-30")
    await expect(applyCopecDatedMappings20261030({ actorEmail: "nadie@chome.test", apply: true })).rejects.toThrow(/responsable/)
  })
})
