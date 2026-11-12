import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/*
 * Administración de los catálogos de mantención contra Postgres de verdad: alta sin duplicar por
 * name_key, reactivación de una entrada inactiva, renombre con choque, baja que no toca al equipo que
 * ya la usa, conteo de usos, auditoría y la huella (ETag) del catálogo de la app.
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

const { createCatalogEntry, renameCatalogEntry, setCatalogEntryActive, listCatalogAdminRows } = await import("@/lib/services/mantencion/catalog-admin")
const { listMantCatalogs, MANT_CATALOG_KEYS } = await import("@/lib/services/mantencion/catalogs")
const { catalogVersion } = await import("@/lib/services/mantencion/sync-catalog-version")

const actor = { userId: "u-jefe-cat", email: "jefe.catalogos@example.test" }
const viewer = { userId: actor.userId, email: actor.email, permissions: [] as string[], worksiteIds: [] as string[], isGlobal: true }

async function brandRow(name: string) {
  const rows = await testDb.select().from(schema.mantBrands).where(eq(schema.mantBrands.name, name))
  return rows[0]
}
async function audits(entityType: string, entityId: string) {
  const rows = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, entityType), eq(schema.auditLog.entityId, entityId)))
  // Los estados de la bitácora son jsonb; PGlite los devuelve como texto.
  return rows.map((row) => ({
    ...row,
    oldState: typeof row.oldState === "string" ? JSON.parse(row.oldState) : row.oldState,
    newState: typeof row.newState === "string" ? JSON.parse(row.newState) : row.newState,
  }))
}
async function idOf(result: Awaited<ReturnType<typeof createCatalogEntry>>): Promise<string> {
  if (!result.ok) throw new Error(`Alta fallida: ${result.message}`)
  return result.data.id
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: actor.userId, name: "Jefatura Catálogos", email: actor.email, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values({ id: "ws-cat", name: "Faena catálogos", code: "FN-CAT", isActive: true })
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "t-cat", slug: "test-cat", name: "Camión (prueba)", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  await testDb.insert(schema.mantBrands).values({ id: "b-scania", name: "Scania", nameKey: "scania" })
  await testDb.insert(schema.fuelVehicles).values({ id: "veh-cat", plate: "GHJK34", code: "KA-900", type: "test-cat", equipmentTypeId: "t-cat", worksiteId: "ws-cat", isActive: true })
  await testDb.insert(schema.mantEquipmentProfiles).values({ vehicleId: "veh-cat", brandId: "b-scania" })
})

describe("alta", () => {
  it("crea la entrada con el nombre limpio, al final del orden, y la audita", async () => {
    const result = await createCatalogEntry({ catalog: "brands", name: "  Kia   Motors ", actor })
    expect(result).toMatchObject({ ok: true, data: { name: "Kia Motors", reactivated: false } })
    const id = await idOf(result)
    const row = await brandRow("Kia Motors")
    expect(row).toMatchObject({ id, nameKey: "kia motors", isActive: true, updatedBy: actor.userId })
    const [scania] = await testDb.select().from(schema.mantBrands).where(eq(schema.mantBrands.id, "b-scania"))
    expect(row!.sortOrder).toBeGreaterThan(scania!.sortOrder)
    const trail = await audits("mant_brand", id)
    expect(trail).toHaveLength(1)
    expect(trail[0]).toMatchObject({ action: "create", userId: actor.userId, entityCode: "Kia Motors" })
  })

  it("no duplica una entrada activa aunque cambien tildes, mayúsculas y espacios", async () => {
    const result = await createCatalogEntry({ catalog: "brands", name: "KIA motors", actor })
    expect(result).toMatchObject({ ok: false, field: "name" })
    expect(!result.ok && result.message).toContain("Ya existe una marca llamada «Kia Motors»")
    const all = await testDb.select().from(schema.mantBrands).where(eq(schema.mantBrands.nameKey, "kia motors"))
    expect(all).toHaveLength(1)
  })

  it("reactiva una inactiva con el mismo nombre en vez de duplicarla, y lo dice", async () => {
    const id = await idOf(await createCatalogEntry({ catalog: "workshops", name: "Taller Los Aromos", actor }))
    await setCatalogEntryActive({ catalog: "workshops", id, active: false, actor })
    const again = await createCatalogEntry({ catalog: "workshops", name: "taller los aromos", actor })
    expect(again).toMatchObject({ ok: true, data: { id, name: "Taller Los Aromos", reactivated: true } })
    expect(again.ok && again.message).toMatch(/ya existía desactivado|ya existía desactivada/)
    const rows = await testDb.select().from(schema.mantWorkshops).where(eq(schema.mantWorkshops.nameKey, "taller los aromos"))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.isActive).toBe(true)
    const trail = (await audits("mant_workshop", id)).map((row) => row.action).sort()
    expect(trail).toEqual(["create", "status_change", "status_change"])
  })

  it("valida el largo del nombre", async () => {
    expect(await createCatalogEntry({ catalog: "oils", name: " a ", actor })).toMatchObject({ ok: false, field: "name" })
    expect(await createCatalogEntry({ catalog: "oils", name: "x".repeat(81), actor })).toMatchObject({ ok: false, field: "name" })
    expect(await testDb.select().from(schema.mantOils)).toHaveLength(0)
  })

  it("funciona en los cinco catálogos", async () => {
    for (const catalog of MANT_CATALOG_KEYS) {
      expect(await createCatalogEntry({ catalog, name: `QA_${catalog}`, actor })).toMatchObject({ ok: true })
    }
    const all = await listMantCatalogs({ includeInactive: true })
    for (const catalog of MANT_CATALOG_KEYS) expect(all[catalog].some((entry) => entry.name === `QA_${catalog}`)).toBe(true)
  })
})

describe("renombre", () => {
  it("cambia el nombre y su clave, y audita el antes y el después", async () => {
    const id = await idOf(await createCatalogEntry({ catalog: "brands", name: "Hyundai Motor", actor }))
    const renamed = await renameCatalogEntry({ catalog: "brands", id, name: " Hyundai ", actor })
    expect(renamed).toMatchObject({ ok: true, data: { id, name: "Hyundai" } })
    expect(await brandRow("Hyundai")).toMatchObject({ id, nameKey: "hyundai" })
    const trail = (await audits("mant_brand", id)).find((row) => row.action === "update")
    expect(trail).toMatchObject({ oldState: { name: "Hyundai Motor" }, newState: { name: "Hyundai" } })
  })

  it("rechaza un nombre que ya tiene otra entrada (también inactiva) y no cambia nada", async () => {
    const toyota = await idOf(await createCatalogEntry({ catalog: "brands", name: "Toyota", actor }))
    const other = await idOf(await createCatalogEntry({ catalog: "brands", name: "Maxus", actor }))
    await setCatalogEntryActive({ catalog: "brands", id: other, active: false, actor })
    const clash = await renameCatalogEntry({ catalog: "brands", id: toyota, name: "MAXUS", actor })
    expect(clash).toMatchObject({ ok: false, field: "name" })
    expect(!clash.ok && clash.message).toContain("«Maxus»")
    expect(await brandRow("Toyota")).toMatchObject({ id: toyota, nameKey: "toyota" })
  })

  it("permite cambiar sólo la grafía del mismo nombre (tildes, mayúsculas)", async () => {
    const id = await idOf(await createCatalogEntry({ catalog: "workshops", name: "taller cholguan", actor }))
    expect(await renameCatalogEntry({ catalog: "workshops", id, name: "Taller Cholguán", actor })).toMatchObject({ ok: true, data: { name: "Taller Cholguán" } })
    const [row] = await testDb.select().from(schema.mantWorkshops).where(eq(schema.mantWorkshops.id, id))
    expect(row).toMatchObject({ name: "Taller Cholguán", nameKey: "taller cholguan" })
  })

  it("avisa si la entrada ya no existe", async () => {
    expect(await renameCatalogEntry({ catalog: "brands", id: "no-existe", name: "Algo", actor })).toMatchObject({ ok: false })
  })
})

describe("baja y alta", () => {
  it("desactivar no toca al equipo que usa la marca; sigue ligado y la lista ya no la ofrece", async () => {
    const result = await setCatalogEntryActive({ catalog: "brands", id: "b-scania", active: false, actor })
    expect(result).toMatchObject({ ok: true, data: { isActive: false } })
    const [profile] = await testDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, "veh-cat"))
    expect(profile!.brandId).toBe("b-scania")
    expect((await listMantCatalogs()).brands.some((brand) => brand.id === "b-scania")).toBe(false)
    expect((await listMantCatalogs({ includeInactive: true })).brands.some((brand) => brand.id === "b-scania")).toBe(true)
    const trail = (await audits("mant_brand", "b-scania")).find((row) => row.action === "status_change")
    expect(trail).toMatchObject({ oldState: { isActive: true }, newState: { isActive: false } })

    expect(await setCatalogEntryActive({ catalog: "brands", id: "b-scania", active: true, actor })).toMatchObject({ ok: true, data: { isActive: true } })
    expect((await listMantCatalogs()).brands.some((brand) => brand.id === "b-scania")).toBe(true)
  })

  it("repetir el mismo estado es inocuo y no escribe otra fila de auditoría", async () => {
    const before = (await audits("mant_brand", "b-scania")).length
    expect(await setCatalogEntryActive({ catalog: "brands", id: "b-scania", active: true, actor })).toMatchObject({ ok: true })
    expect((await audits("mant_brand", "b-scania")).length).toBe(before)
  })

  it("una entrada inexistente se informa, no se inventa", async () => {
    expect(await setCatalogEntryActive({ catalog: "oils", id: "no-existe", active: false, actor })).toMatchObject({ ok: false })
  })
})

describe("usos", () => {
  it("cuenta los equipos de una marca y deja los aceites sin conteo", async () => {
    const brands = await listCatalogAdminRows("brands")
    expect(brands.find((brand) => brand.id === "b-scania")).toMatchObject({ usage: 1, usageText: "1 equipo" })
    expect(brands.find((brand) => brand.name === "Kia Motors")).toMatchObject({ usage: 0, usageText: "" })
    const oils = await listCatalogAdminRows("oils")
    expect(oils.length).toBeGreaterThan(0)
    expect(oils.every((oil) => oil.usage === null)).toBe(true)
  })

  it("incluye inactivas y los otros catálogos devuelven cero usos", async () => {
    const workshops = await listCatalogAdminRows("workshops")
    expect(workshops.length).toBeGreaterThan(0)
    expect(workshops.every((entry) => entry.usage === 0)).toBe(true)
    for (const key of ["drivers", "workTypes"] as const) {
      expect((await listCatalogAdminRows(key)).every((entry) => entry.usage === 0)).toBe(true)
    }
  })
})

describe("huella (ETag) del catálogo de la app", () => {
  it("cambia con un alta, un renombre y una baja en cada una de las cinco tablas", async () => {
    for (const catalog of MANT_CATALOG_KEYS) {
      const v0 = await catalogVersion(viewer, "todos")
      await new Promise((resolve) => setTimeout(resolve, 5))
      const id = await idOf(await createCatalogEntry({ catalog, name: `Huella ${catalog}`, actor }))
      const v1 = await catalogVersion(viewer, "todos")
      expect(v1, `alta en ${catalog}`).not.toBe(v0)
      await new Promise((resolve) => setTimeout(resolve, 5))
      await renameCatalogEntry({ catalog, id, name: `Huella ${catalog} 2`, actor })
      const v2 = await catalogVersion(viewer, "todos")
      expect(v2, `renombre en ${catalog}`).not.toBe(v1)
      await new Promise((resolve) => setTimeout(resolve, 5))
      await setCatalogEntryActive({ catalog, id, active: false, actor })
      const v3 = await catalogVersion(viewer, "todos")
      expect(v3, `baja en ${catalog}`).not.toBe(v2)
    }
  })
})
