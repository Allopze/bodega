import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { Session } from "next-auth"

// ── In-memory PostgreSQL database & migrations ────────────────────────────
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

/**
 * Prueba de integración PostgreSQL de la separación estricta de unidades
 * (km/L vs L/h) en el análisis de rendimiento por equipo (sección 4/19).
 *
 * El contrato (documentado en `performance-statistics.ts`):
 *   "el llamador es responsable de no mezclar observaciones km/L con L/h"
 *
 * Y en `equipment-performance.ts`:
 *   "Separación estricta por unidad: dos equipos con la misma faena/tipo
 *    pero unidades distintas nunca comparten un grupo estadístico."
 *
 * Estas pruebas verifican que `getEquipmentPerformanceAnalysis` cumple ese
 * contrato — nunca mezcla unidades en un mismo PerformanceGroup.
 */
describe("separación estricta km/L vs L/h en equipment-performance", () => {
  const worksiteId = nanoid()
  const equipmentTypeId = nanoid()
  const vehicleKmPerLiter = nanoid()
  const vehicleLitersPerHour = nanoid()
  const userId = nanoid()
  const batchId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteId, name: "Faena prueba unidades", code: `FU-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Test", email: `test-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: equipmentTypeId, slug: `camion-prueba-${nanoid().slice(0, 6)}`, name: "Camión",
      defaultPerformanceUnit: "km_per_liter", category: "truck",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      {
        id: vehicleKmPerLiter, plate: `KM${nanoid().slice(0, 4).toUpperCase()}`,
        type: "camion", equipmentTypeId, worksiteId, isActive: true,
        performanceUnit: "km_per_liter",
      },
      {
        id: vehicleLitersPerHour, plate: `LH${nanoid().slice(0, 4).toUpperCase()}`,
        type: "camion", equipmentTypeId, worksiteId, isActive: true,
        performanceUnit: "liters_per_hour",
      },
    ])
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "test.xlsx", archivoPath: "test.xlsx",
      hashArchivo: nanoid(64), periodoDesde: "2026-06-01", periodoHasta: "2026-06-30",
      totalFilas: 4, filasValidas: 4, filasInvalidas: 0, totalEquipos: 2,
      totalLitros: 330, totalMonto: 330000, importadoPor: userId,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values([
      // 2 observaciones km_per_liter con rendimiento ~5 km/L
      {
        id: nanoid(), batchId, vehicleId: vehicleKmPerLiter, plate: "KM-1",
        worksiteId, fecha: "2026-06-10", liters: 100, horometro: 500,
        medidoPor: "km", rendimiento: 5, monto: 100000,
      },
      {
        id: nanoid(), batchId, vehicleId: vehicleKmPerLiter, plate: "KM-1",
        worksiteId, fecha: "2026-06-11", liters: 50, horometro: 250,
        medidoPor: "km", rendimiento: 5, monto: 50000,
      },
      // 2 observaciones liters_per_hour con rendimiento ~10 L/h
      {
        id: nanoid(), batchId, vehicleId: vehicleLitersPerHour, plate: "LH-1",
        worksiteId, fecha: "2026-06-10", liters: 100, horometro: 10,
        medidoPor: "hora", rendimiento: 10, monto: 100000,
      },
      {
        id: nanoid(), batchId, vehicleId: vehicleLitersPerHour, plate: "LH-1",
        worksiteId, fecha: "2026-06-11", liters: 80, horometro: 8,
        medidoPor: "hora", rendimiento: 10, monto: 80000,
      },
    ])
  })

  function globalSession(): Session {
    return {
      user: {
        id: userId, name: "Test", email: `test-${nanoid()}@example.com`,
        roles: ["administrador"], permissions: [], worksiteIds: [],
        primaryWorksiteId: null, avatarColor: null, isActive: true,
      },
      expires: "2099-01-01T00:00:00.000Z",
    }
  }

  it("separa km/L y L/h en grupos distintos al agregar por vehículo", async () => {
    const { getEquipmentPerformanceAnalysis } = await import("@/lib/combustibles/equipment-performance")

    const groups = await getEquipmentPerformanceAnalysis(globalSession(), {
      preset: "truck",
      aggregateBy: "vehicle",
      worksiteId,
      from: "2026-06-01",
      to: "2026-06-30",
    })

    // Cada vehículo tiene su propia unidad — deben ser 2 grupos separados
    expect(groups.length).toBe(2)

    const kmGroup = groups.find((g) => g.unit === "km_per_liter")
    const lhGroup = groups.find((g) => g.unit === "liters_per_hour")
    expect(kmGroup).toBeDefined()
    expect(lhGroup).toBeDefined()
    expect(kmGroup!.stats.count).toBe(2)
    expect(lhGroup!.stats.count).toBe(2)
  })

  it("no mezcla unidades aunque se agregue por faena (misma faena, bucket key incluye performanceUnit)", async () => {
    const { getEquipmentPerformanceAnalysis } = await import("@/lib/combustibles/equipment-performance")

    const groups = await getEquipmentPerformanceAnalysis(globalSession(), {
      preset: "truck",
      aggregateBy: "worksite",
      worksiteId,
      from: "2026-06-01",
      to: "2026-06-30",
    })

    // Misma faena, misma preset → si se mezclaran unidades habría 1 grupo.
    // Como bucket key incluye performanceUnit → 2 grupos.
    expect(groups.length).toBe(2)
    expect(groups.every((g) => g.unit === "km_per_liter" || g.unit === "liters_per_hour")).toBe(true)
  })

  it("cada grupo usa solo observaciones de su propia unidad (media correcta, no contaminada)", async () => {
    const { getEquipmentPerformanceAnalysis } = await import("@/lib/combustibles/equipment-performance")

    const groups = await getEquipmentPerformanceAnalysis(globalSession(), {
      preset: "truck",
      aggregateBy: "vehicle",
      worksiteId,
      from: "2026-06-01",
      to: "2026-06-30",
    })

    const kmGroup = groups.find((g) => g.unit === "km_per_liter")!
    const lhGroup = groups.find((g) => g.unit === "liters_per_hour")!

    // km/L: ambas observaciones tienen rendimiento = 5
    expect(kmGroup.stats.mean).toBe(5)
    expect(kmGroup.stats.min).toBe(5)
    expect(kmGroup.stats.max).toBe(5)

    // L/h: ambas observaciones tienen rendimiento = 10
    expect(lhGroup.stats.mean).toBe(10)
    expect(lhGroup.stats.min).toBe(10)
    expect(lhGroup.stats.max).toBe(10)

    // Si se mezclaran, la media sería (5+5+10+10)/4 = 7.5
    expect(kmGroup.stats.mean).not.toBe(7.5)
    expect(lhGroup.stats.mean).not.toBe(7.5)
  })

  it("vehículos con performanceUnit not_applicable no entran al análisis", async () => {
    const { getEquipmentPerformanceAnalysis } = await import("@/lib/combustibles/equipment-performance")

    // Agregar un vehículo not_applicable con observaciones de rendimiento
    const naVehicleId = nanoid()
    const naPlate = `NA${nanoid().slice(0, 4).toUpperCase()}`
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: naVehicleId, plate: naPlate, type: "camion",
      equipmentTypeId, worksiteId, isActive: true,
      performanceUnit: "not_applicable",
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values({
      id: nanoid(), batchId, vehicleId: naVehicleId, plate: naPlate,
      worksiteId, fecha: "2026-06-15", liters: 50,
      horometro: null, medidoPor: null, rendimiento: 3, monto: 50000,
    })

    const groups = await getEquipmentPerformanceAnalysis(globalSession(), {
      preset: "truck",
      aggregateBy: "vehicle",
      worksiteId,
      from: "2026-06-01",
      to: "2026-06-30",
    })

    // not_applicable se filtra en fetchObservations via `<> 'not_applicable'`
    expect(groups.length).toBe(2) // solo km/L y L/h
    expect(groups.some((g) => (g.unit as string) === "not_applicable")).toBe(false)
  })
})

afterAll(async () => {
  await pg.close()
})
