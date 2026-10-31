import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { projectOperationRecords } from "@/lib/combustibles/control/projection"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const userId = "user-fuel-config"
type TestSession = { user: { id: string; email: string; isGlobal: boolean; roles: string[]; worksiteIds: string[] } }
let currentSession: TestSession | null = null

vi.mock("@/lib/auth/can", () => ({
  guardPermission: vi.fn(async () => currentSession
    ? { session: currentSession, error: null }
    : { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }),
}))

const globalSession: TestSession = { user: { id: userId, email: "config@chome.cl", isGlobal: true, roles: ["administrador"], worksiteIds: [] } }
const scopedSession: TestSession = { user: { id: userId, email: "config@chome.cl", isGlobal: false, roles: ["admin_contrato"], worksiteIds: ["ws-cfg-a"] } }

const {
  saveMandanteAction, setMandanteActiveAction, saveSupplyMediumAction, setSupplyMediumActiveAction, setEquipmentTypeFamilyAction,
} = await import("@/app/(app)/combustibles/ajustes/actions")
const { savePerformanceThresholdsAction, recomputeSeriesBatchAction } = await import("@/app/(app)/combustibles/ajustes/actions-thresholds")

async function audits(entityType: string) {
  return testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, entityType))
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: userId, name: "Admin", email: "config@chome.cl", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([
    { id: "ws-cfg-a", name: "Faena A", code: "CFG-A", isActive: true, createdAt: now, updatedAt: now },
    { id: "ws-cfg-b", name: "Faena B", code: "CFG-B", isActive: true, createdAt: now, updatedAt: now },
    { id: "ws-cfg-c", name: "Faena C", code: "CFG-C", isActive: true, createdAt: now, updatedAt: now },
  ])
})

beforeEach(async () => {
  currentSession = globalSession
  await testDb.delete(schema.fuelMandanteWorksites)
  await testDb.delete(schema.fuelMandantes)
})

describe("sin permiso", () => {
  it("ninguna acción escribe", async () => {
    currentSession = null
    const created = await saveMandanteAction({ name: "Arauco", tolerancePct: "2", worksiteIds: [] })
    expect(created.ok).toBe(false)
    expect((await saveSupplyMediumAction({ name: "Nuevo", kind: "other", aliases: "", sortOrder: 0 })).ok).toBe(false)
    expect((await setEquipmentTypeFamilyAction({ equipmentTypeId: "x", family: null })).ok).toBe(false)
    expect((await setMandanteActiveAction({ id: "x", isActive: false })).ok).toBe(false)
    expect((await setSupplyMediumActiveAction({ id: "x", isActive: false })).ok).toBe(false)
    expect(await testDb.select().from(schema.fuelMandantes)).toHaveLength(0)
  })
})

describe("mandantes", () => {
  it("crea con coma decimal, asigna faenas y audita", async () => {
    const result = await saveMandanteAction({ name: " Arauco ", tolerancePct: "2,5", worksiteIds: ["ws-cfg-a", "ws-cfg-b"] })
    expect(result.ok).toBe(true)
    const id = String(result.data?.id)
    const [row] = await testDb.select().from(schema.fuelMandantes).where(eq(schema.fuelMandantes.id, id))
    expect(row).toMatchObject({ name: "Arauco", tolerancePct: 2.5, isActive: true })
    const links = await testDb.select().from(schema.fuelMandanteWorksites).where(eq(schema.fuelMandanteWorksites.mandanteId, id))
    expect(links.map((link) => link.worksiteId).sort()).toEqual(["ws-cfg-a", "ws-cfg-b"])
    const log = (await audits("fuel_mandante")).find((entry) => entry.entityId === id)
    expect(log?.action).toBe("create")
    expect(JSON.parse(log!.newState!)).toMatchObject({ tolerancePct: 2.5, worksiteIds: ["ws-cfg-a", "ws-cfg-b"] })
  })

  it("rechaza tolerancia fuera de rango y nombre repetido sin importar mayúsculas", async () => {
    expect((await saveMandanteAction({ name: "Arauco", tolerancePct: "101", worksiteIds: [] })).ok).toBe(false)
    expect((await saveMandanteAction({ name: "Arauco", tolerancePct: "2", worksiteIds: [] })).ok).toBe(true)
    const duplicate = await saveMandanteAction({ name: "ARAUCO", tolerancePct: "2", worksiteIds: [] })
    expect(duplicate.ok).toBe(false)
    expect(duplicate.fieldErrors?.name).toBeDefined()
  })

  it("mover una faena de otro mandante exige confirmación y queda auditado", async () => {
    const first = await saveMandanteAction({ name: "Arauco", tolerancePct: "2", worksiteIds: ["ws-cfg-a"] })
    const second = await saveMandanteAction({ name: "CMPC", tolerancePct: "3", worksiteIds: ["ws-cfg-b"] })
    const secondId = String(second.data?.id)

    const refused = await saveMandanteAction({ id: secondId, name: "CMPC", tolerancePct: "3", worksiteIds: ["ws-cfg-a", "ws-cfg-b"] })
    expect(refused.ok).toBe(false)
    expect(refused.data?.conflicts).toEqual([{ worksiteId: "ws-cfg-a", worksiteName: "Faena A", mandanteName: "Arauco" }])
    const [stillThere] = await testDb.select().from(schema.fuelMandanteWorksites).where(eq(schema.fuelMandanteWorksites.worksiteId, "ws-cfg-a"))
    expect(stillThere?.mandanteId).toBe(first.data?.id)

    const moved = await saveMandanteAction({ id: secondId, name: "CMPC", tolerancePct: "3", worksiteIds: ["ws-cfg-a", "ws-cfg-b"], confirmMove: true })
    expect(moved.ok).toBe(true)
    const links = await testDb.select().from(schema.fuelMandanteWorksites).where(eq(schema.fuelMandanteWorksites.mandanteId, secondId))
    expect(links.map((link) => link.worksiteId).sort()).toEqual(["ws-cfg-a", "ws-cfg-b"])
    const log = (await audits("fuel_mandante")).find((entry) => entry.entityId === secondId && entry.action === "update")
    expect(JSON.parse(log!.newState!).movedFromOtherMandante).toEqual([{ worksiteId: "ws-cfg-a", mandanteId: first.data?.id }])
  })

  it("quitar una faena de la lista la libera, y desactivar conserva el registro", async () => {
    const created = await saveMandanteAction({ name: "Arauco", tolerancePct: "2", worksiteIds: ["ws-cfg-a", "ws-cfg-b"] })
    const id = String(created.data?.id)
    await saveMandanteAction({ id, name: "Arauco", tolerancePct: "2", worksiteIds: ["ws-cfg-a"] })
    const links = await testDb.select().from(schema.fuelMandanteWorksites).where(eq(schema.fuelMandanteWorksites.mandanteId, id))
    expect(links.map((link) => link.worksiteId)).toEqual(["ws-cfg-a"])

    expect((await setMandanteActiveAction({ id, isActive: false })).ok).toBe(true)
    const [row] = await testDb.select().from(schema.fuelMandantes).where(eq(schema.fuelMandantes.id, id))
    expect(row?.isActive).toBe(false)
    const log = (await audits("fuel_mandante")).filter((entry) => entry.entityId === id)
    expect(log.some((entry) => JSON.parse(entry.oldState ?? "{}").isActive === true && JSON.parse(entry.newState ?? "{}").isActive === false)).toBe(true)
  })

  it("una faena fuera del alcance de quien edita se rechaza y no se pierde al guardar", async () => {
    const created = await saveMandanteAction({ name: "Arauco", tolerancePct: "2", worksiteIds: ["ws-cfg-a", "ws-cfg-c"] })
    const id = String(created.data?.id)
    currentSession = scopedSession
    const outside = await saveMandanteAction({ id, name: "Arauco", tolerancePct: "2", worksiteIds: ["ws-cfg-b"] })
    expect(outside.ok).toBe(false)
    // Con alcance solo a la faena A, guardar sin A la libera, pero C (fuera de su alcance) se conserva.
    const trimmed = await saveMandanteAction({ id, name: "Arauco", tolerancePct: "2", worksiteIds: [] })
    expect(trimmed.ok).toBe(true)
    const links = await testDb.select().from(schema.fuelMandanteWorksites).where(eq(schema.fuelMandanteWorksites.mandanteId, id))
    expect(links.map((link) => link.worksiteId)).toEqual(["ws-cfg-c"])
  })
})

describe("medios de suministro", () => {
  it("crea con slug único, alias en mayúsculas y mapeo Aramco sin canal", async () => {
    const result = await saveSupplyMediumAction({ name: "CMPC", kind: "mandante_dispenser", providerMapping: "aramco", aliases: "cmpc norte, Surtidor norte", sortOrder: "35", isActive: true })
    expect(result.ok).toBe(true)
    const [row] = await testDb.select().from(schema.fuelSupplyMedia).where(eq(schema.fuelSupplyMedia.id, String(result.data?.id)))
    expect(row).toMatchObject({ slug: "cmpc-2", providerCode: "aramco", providerChannel: null, aliases: ["CMPC NORTE", "SURTIDOR NORTE"], sortOrder: 35 })
    expect((await audits("fuel_supply_medium")).some((entry) => entry.entityId === row!.id && entry.action === "create")).toBe(true)
  })

  it("rechaza nombre repetido y alias que ya usa otro medio", async () => {
    const sameName = await saveSupplyMediumAction({ name: "surtidor cmpc", kind: "other", aliases: "", sortOrder: 0 })
    expect(sameName.ok).toBe(false)
    expect(sameName.fieldErrors?.name).toBeDefined()
    const alias = await saveSupplyMediumAction({ name: "Otro medio", kind: "other", aliases: "tct, propio", sortOrder: 0 })
    expect(alias.ok).toBe(false)
    expect(alias.fieldErrors?.aliases?.[0]).toContain("TCT")
  })

  it("edita sin cambiar el slug y desactiva con auditoría", async () => {
    const [seeded] = await testDb.select().from(schema.fuelSupplyMedia).where(eq(schema.fuelSupplyMedia.id, "fsm-tae"))
    const edited = await saveSupplyMediumAction({
      id: "fsm-tae", name: "TAE Copec", kind: "card", providerMapping: "copec_tae", aliases: seeded!.aliases.join(", "), sortOrder: 20, isActive: true,
    })
    expect(edited.ok).toBe(true)
    const [after] = await testDb.select().from(schema.fuelSupplyMedia).where(eq(schema.fuelSupplyMedia.id, "fsm-tae"))
    expect(after).toMatchObject({ slug: "tae", name: "TAE Copec", providerCode: "copec", providerChannel: "TAE" })
    expect((await setSupplyMediumActiveAction({ id: "fsm-tae", isActive: false })).ok).toBe(true)
    const [off] = await testDb.select().from(schema.fuelSupplyMedia).where(eq(schema.fuelSupplyMedia.id, "fsm-tae"))
    expect(off?.isActive).toBe(false)
  })
})

describe("familias de equipos", () => {
  it("cambia la familia, permite dejarla fuera de las vistas y audita ambos valores", async () => {
    const [type] = await testDb.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.slug, "grua"))
    expect(type).toBeDefined()
    expect((await setEquipmentTypeFamilyAction({ equipmentTypeId: type!.id, family: "maquinaria" })).ok).toBe(true)
    expect((await setEquipmentTypeFamilyAction({ equipmentTypeId: type!.id, family: null })).ok).toBe(true)
    const [after] = await testDb.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.id, type!.id))
    expect(after?.performanceFamily).toBeNull()
    const log = (await audits("fuel_equipment_type")).filter((entry) => entry.entityId === type!.id)
    expect(log.map((entry) => JSON.parse(entry.newState!).performanceFamily)).toEqual(expect.arrayContaining(["maquinaria", null]))
    const invalid = await setEquipmentTypeFamilyAction({ equipmentTypeId: type!.id, family: "heavy" as never })
    expect(invalid.ok).toBe(false)
  })

  it("un tipo inexistente se informa", async () => {
    const result = await setEquipmentTypeFamilyAction({ equipmentTypeId: "no-existe", family: "camiones" })
    expect(result.ok).toBe(false)
  })
})

describe("umbrales y recálculo de series", () => {
  const thresholds = (maxLitersPerHour: string) => ({
    minSamples: "5", maxKmPerLiter: "25", maxLitersPerHour, duplicateWindowMinutes: "15", duplicateLitersTolerance: "0,5",
  })
  const loadsOf = () => testDb.select().from(schema.fuelEquipmentLoads)
    .where(eq(schema.fuelEquipmentLoads.vehicleId, "veh-cfg-1"))
    .orderBy(schema.fuelEquipmentLoads.occurredAt)

  beforeAll(async () => {
    await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-cfg", slug: "camion-cfg", name: "Camión de prueba" }).onConflictDoNothing()
    await testDb.insert(schema.fuelVehicles).values({
      id: "veh-cfg-1", plate: "CFGA11", type: "camion", equipmentTypeId: "fet-cfg", worksiteId: "ws-cfg-a", meterType: "hour_meter", performanceUnit: "liters_per_hour",
    })
    await testDb.insert(schema.fuelOperationBatches).values({
      id: "batch-cfg", archivoNombre: "consolidado.xlsx", hashArchivo: "h-cfg", periodoDesde: "2026-01-01", periodoHasta: "2026-03-31", importadoPor: userId,
    })
    for (const [id, fecha, horometro, liters] of [["rec-cfg-1", "2026-02-01", 100, 50], ["rec-cfg-2", "2026-02-02", 110, 500]] as const) {
      await testDb.insert(schema.fuelOperationRecords).values({
        id, batchId: "batch-cfg", worksiteId: "ws-cfg-a", vehicleId: "veh-cfg-1", plate: "CFGA11", fecha, horaCarga: "08:30", horometro, liters,
      })
    }
    await projectOperationRecords(testDb as unknown as Tx, ["rec-cfg-1", "rec-cfg-2"])
  })

  it("guardar los mismos valores no pide recalcular; uno distinto sí, y queda auditado", async () => {
    const same = await savePerformanceThresholdsAction(thresholds("80"))
    expect(same.ok).toBe(true)
    expect(same.data?.changed).toBe(false)

    const different = await savePerformanceThresholdsAction(thresholds("10"))
    expect(different.ok).toBe(true)
    expect(different.data?.changed).toBe(true)
    const log = (await audits("fuel_control_settings")).find((entry) => JSON.parse(entry.newState!).maxLitersPerHour === 10)
    expect(log).toBeDefined()
  })

  it("el recálculo dice cuántas cargas cambiaron: pasan a por decidir con un umbral más bajo y vuelven con el original", async () => {
    await savePerformanceThresholdsAction(thresholds("10"))
    const lowered = await recomputeSeriesBatchAction({ cursor: null })
    expect(lowered.ok).toBe(true)
    expect(lowered.data).toMatchObject({ processed: 1, total: 1, done: true, changedLoads: 1, flagged: 1, released: 0 })
    const [, second] = await loadsOf()
    expect(second).toMatchObject({ reviewStatus: "flagged" })
    expect(second?.flagReasons).toContain("implausible")

    await savePerformanceThresholdsAction(thresholds("80"))
    const restored = await recomputeSeriesBatchAction({ cursor: null })
    expect(restored.data).toMatchObject({ changedLoads: 1, flagged: 0, released: 1 })
    expect((await loadsOf())[1]).toMatchObject({ reviewStatus: "ok" })

    // Sin ningún cambio de umbral, volver a recalcular no mueve nada.
    const idle = await recomputeSeriesBatchAction({ cursor: null })
    expect(idle.data).toMatchObject({ changedLoads: 0, flagged: 0, released: 0 })

    const recompute = (await audits("fuel_control_series_recompute")).map((entry) => JSON.parse(entry.newState!))
    expect(recompute.some((state) => state.changedLoads === 1 && state.flagged === 1)).toBe(true)
  })

  it("un equipo fuera del alcance de quien recalcula no se toca", async () => {
    await savePerformanceThresholdsAction(thresholds("10"))
    currentSession = { user: { id: userId, email: "config@chome.cl", isGlobal: false, roles: ["admin_contrato"], worksiteIds: ["ws-cfg-b"] } }
    const scoped = await recomputeSeriesBatchAction({ cursor: null })
    expect(scoped.ok).toBe(true)
    expect(scoped.data).toMatchObject({ processed: 0, total: 0, done: true, changedLoads: 0 })
    expect((await loadsOf())[1]).toMatchObject({ reviewStatus: "ok" })
    await savePerformanceThresholdsAction(thresholds("80"))
  })

  it("sin permiso no guarda ni recalcula", async () => {
    currentSession = null
    expect((await savePerformanceThresholdsAction(thresholds("10"))).ok).toBe(false)
    expect((await recomputeSeriesBatchAction({ cursor: null })).ok).toBe(false)
  })
})
