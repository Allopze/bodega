import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
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
} = await import("@/app/(app)/combustibles/control/configuracion/actions")

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
