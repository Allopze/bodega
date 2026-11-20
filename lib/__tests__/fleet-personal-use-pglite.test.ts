import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * Servicio de períodos de uso personal contra Postgres de verdad: cada alta,
 * cambio o baja valida contra los demás períodos del equipo, deja auditoría con
 * el estado anterior y el nuevo, y quitar un período no deja nada cacheado.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const {
  createPersonalUsePeriod, updatePersonalUsePeriod, deletePersonalUsePeriod,
  listPersonalUsePeriods, loadPersonalUseIndex,
} = await import("@/lib/services/fleet-personal-use")
const { isPersonalUseDay } = await import("@/lib/fleet/personal-use")

const ACTOR = { userId: "u-t", email: "ana@example.com" }

async function auditOf(id: string) {
  return testDb.select().from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityType, "fuel_vehicle_personal_use"), eq(schema.auditLog.entityId, id)))
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.worksites).values({ id: "ws-a", name: "Santa Fe", code: "FN-A", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-t", slug: "t-t", name: "Camión", category: "truck", defaultMeterType: "odometer" })
  await testDb.insert(schema.users).values({ id: "u-t", name: "Ana Pérez", email: "ana@example.com", hashedPassword: "x" })
  await testDb.insert(schema.fuelVehicles).values([
    { id: "v-1", plate: "PU-1", code: "KA-1", type: "Camión", equipmentTypeId: "fet-t", worksiteId: "ws-a", isActive: true },
    { id: "v-2", plate: "PU-2", code: "KA-2", type: "Camión", equipmentTypeId: "fet-t", worksiteId: "ws-a", isActive: true },
  ])
})

describe("createPersonalUsePeriod", () => {
  it("crea un período válido y deja auditoría", async () => {
    const result = await createPersonalUsePeriod(ACTOR, { vehicleId: "v-1", startedOn: "2026-10-10", endedOn: "2026-10-19", note: "Viaje del dueño" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const audit = await auditOf(result.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]!.action).toBe("create")
    expect(JSON.parse(audit[0]!.newState!)).toMatchObject({ vehicleId: "v-1", startedOn: "2026-10-10", endedOn: "2026-10-19", note: "Viaje del dueño" })
    expect(audit[0]!.userId).toBe("u-t")
  })

  it("rechaza un solape y nombra las fechas del otro período", async () => {
    const result = await createPersonalUsePeriod(ACTOR, { vehicleId: "v-1", startedOn: "2026-10-15", endedOn: "2026-10-25", note: null })
    expect(result).toEqual({ ok: false, message: expect.stringContaining("10-10-2026") })
  })

  it("rechaza una fecha futura", async () => {
    const result = await createPersonalUsePeriod(ACTOR, { vehicleId: "v-2", startedOn: "2099-01-01", endedOn: null, note: null })
    expect(result.ok).toBe(false)
  })

  it("rechaza un equipo que no existe", async () => {
    const result = await createPersonalUsePeriod(ACTOR, { vehicleId: "v-nope", startedOn: "2026-10-01", endedOn: null, note: null })
    expect(result.ok).toBe(false)
  })

  it("guarda una nota vacía como nula", async () => {
    const result = await createPersonalUsePeriod(ACTOR, { vehicleId: "v-2", startedOn: "2026-09-01", endedOn: "2026-09-02", note: "   " })
    expect(result.ok).toBe(true)
    const [period] = await listPersonalUsePeriods("v-2")
    expect(period!.note).toBeNull()
  })
})

describe("updatePersonalUsePeriod", () => {
  it("cierra un período abierto y audita el estado anterior", async () => {
    const created = await createPersonalUsePeriod(ACTOR, { vehicleId: "v-1", startedOn: "2026-11-01", endedOn: null, note: null })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const updated = await updatePersonalUsePeriod(ACTOR, created.id, { startedOn: "2026-11-01", endedOn: "2026-11-05", note: "Volvió" })
    expect(updated).toEqual({ ok: true, id: created.id })
    const audit = (await auditOf(created.id)).find((row) => row.action === "update")!
    expect(JSON.parse(audit.oldState!)).toMatchObject({ endedOn: null, note: null })
    expect(JSON.parse(audit.newState!)).toMatchObject({ endedOn: "2026-11-05", note: "Volvió" })
  })

  it("no choca consigo mismo al editar, pero sí con otro período", async () => {
    const periods = await listPersonalUsePeriods("v-1")
    const october = periods.find((p) => p.startedOn === "2026-10-10")!
    expect((await updatePersonalUsePeriod(ACTOR, october.id, { startedOn: "2026-10-09", endedOn: "2026-10-19", note: null })).ok).toBe(true)
    const clash = await updatePersonalUsePeriod(ACTOR, october.id, { startedOn: "2026-10-09", endedOn: "2026-11-02", note: null })
    expect(clash).toEqual({ ok: false, message: expect.stringContaining("01-11-2026") })
  })

  it("rechaza un período que ya no existe", async () => {
    expect((await updatePersonalUsePeriod(ACTOR, "pu-nope", { startedOn: "2026-10-01", endedOn: null, note: null })).ok).toBe(false)
  })
})

describe("deletePersonalUsePeriod", () => {
  it("quita el período, audita la baja y el índice ya no lo trae", async () => {
    const created = await createPersonalUsePeriod(ACTOR, { vehicleId: "v-2", startedOn: "2026-10-20", endedOn: "2026-10-22", note: null })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(isPersonalUseDay(await loadPersonalUseIndex(["v-2"]), "v-2", "2026-10-21", "2026-11-20")).toBe(true)

    expect(await deletePersonalUsePeriod(ACTOR, created.id)).toEqual({ ok: true, id: created.id })
    const rows = await testDb.select().from(schema.fuelVehiclePersonalUsePeriods).where(eq(schema.fuelVehiclePersonalUsePeriods.id, created.id))
    expect(rows).toHaveLength(0)
    const audit = (await auditOf(created.id)).find((row) => row.action === "delete")!
    expect(JSON.parse(audit.oldState!)).toMatchObject({ vehicleId: "v-2", startedOn: "2026-10-20", endedOn: "2026-10-22" })
    expect(isPersonalUseDay(await loadPersonalUseIndex(["v-2"]), "v-2", "2026-10-21", "2026-11-20")).toBe(false)
  })

  it("rechaza un período que ya no existe", async () => {
    expect((await deletePersonalUsePeriod(ACTOR, "pu-nope")).ok).toBe(false)
  })
})

describe("listPersonalUsePeriods / loadPersonalUseIndex", () => {
  it("lista del más reciente al más antiguo", async () => {
    const periods = await listPersonalUsePeriods("v-1")
    expect(periods.map((p) => p.startedOn)).toEqual(["2026-11-01", "2026-10-09"])
  })

  it("carga el índice de varios equipos de una vez y uno vacío sin consultar", async () => {
    const index = await loadPersonalUseIndex(["v-1", "v-2"])
    expect(index.get("v-1")).toHaveLength(2)
    expect(index.get("v-2")).toHaveLength(1)
    expect((await loadPersonalUseIndex([])).size).toBe(0)
  })
})
