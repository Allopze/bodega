import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

// ── PostgreSQL en memoria con las migraciones reales ──────────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime; postgres-js difiere sólo en el tipo HKT del resultado.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { getFuelLogRows, getFuelLogTotal, getFuelLogRowsBySelection, operationPerformanceUnitCode } = await import("@/lib/combustibles/fuel-log")
const { getTaeGroupedTotals } = await import("@/lib/combustibles/tae-dashboard")

/**
 * D-10 (datos personales) y D-11 (filtro de unidad de rendimiento) de la
 * bitácora, contra PostgreSQL real. Lo importante: el enmascarado ocurre en el
 * resultado de la consulta (no solo en la UI) y los filtros por nombre no se
 * pueden usar de oráculo sin el permiso.
 */
function session(permissions: string[]): Session {
  return {
    user: { id: "user-1", name: "U", email: "u@example.com", roles: ["administrador"], permissions, worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}
const withPersonal = () => session(["combustibles:view", "combustibles:view_personal"])
const withoutPersonal = () => session(["combustibles:view"])
const PAGE = { limit: 50, offset: 0, sort: "desc" as const }

describe("bitácora: datos personales y unidad de rendimiento (PostgreSQL)", () => {
  const worksiteId = nanoid()
  const userId = nanoid()
  const productId = nanoid()
  const vehicleId = nanoid()
  const equipmentTypeId = nanoid()
  const taeId = nanoid()
  const batchId = nanoid()
  const opKm = nanoid()
  const opHr = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true })
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Importador", email: `i-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `D-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: vehicleId, plate: `PP${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId, isActive: true })
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: taeId, clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32),
      worksiteId, vehicleId, productId, equipmentCodeSnapshot: "CC-1",
      loadedAt: "2026-06-01T08:00:00.000Z", submittedAt: "2026-06-01T08:00:00.000Z",
      driverNameSnapshot: "Ana Conductora", supervisorNameSnapshot: "Luis Supervisor", meterType: "odometer",
      liters: 40, status: "submitted",
    })
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "log.xlsx", hashArchivo: nanoid(), estado: "importado",
      periodoDesde: "2026-06-01", periodoHasta: "2026-06-30", importadoPor: userId,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values([
      { id: opKm, batchId, worksiteId, plate: "OPKM11", fecha: "2026-06-02", liters: 50, operador: "Pedro Operador", supervisor: "Marta Jefa", rendimiento: 3.1, tipoRendimiento: "km_lt" },
      { id: opHr, batchId, worksiteId, plate: "OPHR22", fecha: "2026-06-03", liters: 30, operador: "Rosa Operadora", supervisor: "Marta Jefa", rendimiento: 12, tipoRendimiento: "lt_hr" },
    ])
  })

  describe("D-10: enmascarado en el resultado de la consulta", () => {
    it("con view_personal devuelve los nombres de las dos fuentes con personas", async () => {
      const rows = await getFuelLogRows(withPersonal(), {}, PAGE)
      const names = rows.flatMap((r) => [r.driverName, r.supervisorName]).filter(Boolean)
      expect(names).toEqual(expect.arrayContaining(["Ana Conductora", "Luis Supervisor", "Pedro Operador", "Marta Jefa"]))
    })

    it("sin view_personal TODAS las filas traen conductor y supervisor en null", async () => {
      const rows = await getFuelLogRows(withoutPersonal(), {}, PAGE)
      expect(rows).toHaveLength(3)
      expect(rows.every((r) => r.driverName === null && r.supervisorName === null)).toBe(true)
      expect(JSON.stringify(rows)).not.toMatch(/Conductora|Supervisor|Operador|Marta|Rosa/)
    })

    it("la selección manual (exportar seleccionadas) también viene enmascarada", async () => {
      const rows = await getFuelLogRowsBySelection(withoutPersonal(), [{ source: "tae_pwa", id: taeId }, { source: "operation_manual", id: opKm }])
      expect(rows).toHaveLength(2)
      expect(rows.every((r) => r.driverName === null && r.supervisorName === null)).toBe(true)
    })

    it("sin view_personal el filtro por nombre no actúa (no sirve de oráculo)", async () => {
      const unfiltered = await getFuelLogTotal(withoutPersonal(), {})
      expect(await getFuelLogTotal(withoutPersonal(), { driverName: "Ana" })).toBe(unfiltered)
      expect(await getFuelLogTotal(withoutPersonal(), { supervisorName: "inexistente-xyz" })).toBe(unfiltered)
    })

    it("sin view_personal la búsqueda de texto no mira nombres", async () => {
      expect(await getFuelLogTotal(withoutPersonal(), { q: "Ana Conductora" })).toBe(0)
      expect(await getFuelLogTotal(withoutPersonal(), { q: "Marta" })).toBe(0)
      // …pero sí encuentra por patente.
      expect(await getFuelLogTotal(withoutPersonal(), { q: "OPKM11" })).toBe(1)
    })

    it("con view_personal el filtro y la búsqueda por nombre siguen funcionando", async () => {
      expect(await getFuelLogTotal(withPersonal(), { driverName: "Ana" })).toBe(1)
      expect(await getFuelLogTotal(withPersonal(), { supervisorName: "Marta" })).toBe(2)
      expect(await getFuelLogTotal(withPersonal(), { q: "Pedro" })).toBe(1)
    })

    it("tae-dashboard: sin view_personal conserva litros y cargas pero rotula 'Reservado N'", async () => {
      const range = { from: "2026-06-01", to: "2026-06-30" }
      const real = await getTaeGroupedTotals(withPersonal(), range, "supervisor")
      expect(real).toEqual([{ group: "Luis Supervisor", liters: 40, count: 1 }])
      const masked = await getTaeGroupedTotals(withoutPersonal(), range, "supervisor")
      expect(masked).toEqual([{ group: "Reservado 1", liters: 40, count: 1 }])
      const maskedDrivers = await getTaeGroupedTotals(withoutPersonal(), range, "driver")
      expect(maskedDrivers.map((g) => g.group)).toEqual(["Reservado 1"])
      expect(JSON.stringify(maskedDrivers)).not.toContain("Ana")
    })
  })

  describe("D-11: filtro de unidad de rendimiento", () => {
    it("mapea el vocabulario del filtro al del log operacional", () => {
      expect(operationPerformanceUnitCode("km_per_liter")).toBe("km_lt")
      expect(operationPerformanceUnitCode("liters_per_hour")).toBe("lt_hr")
    })

    it("km_per_liter ya no descarta el log operacional: devuelve la fila km_lt", async () => {
      const rows = await getFuelLogRows(withPersonal(), { performanceUnit: "km_per_liter", source: "operation_manual" }, PAGE)
      expect(rows.map((r) => r.id)).toEqual([opKm])
    })

    it("liters_per_hour devuelve la fila lt_hr", async () => {
      const rows = await getFuelLogRows(withPersonal(), { performanceUnit: "liters_per_hour", source: "operation_manual" }, PAGE)
      expect(rows.map((r) => r.id)).toEqual([opHr])
    })

    it("en la vista unificada el filtro conserva las filas del log operacional", async () => {
      expect(await getFuelLogTotal(withPersonal(), { performanceUnit: "km_per_liter" })).toBeGreaterThanOrEqual(1)
    })
  })
})
