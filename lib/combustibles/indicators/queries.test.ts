/**
 * Consultas de «Indicadores de combustible» contra un Postgres real (PGlite con todas las
 * migraciones). Lo que más importa:
 *
 * - Las cifras (`getIndicatorFigures`) son **las mismas del Panel** (`getPanelFigures`): la
 *   prueba compara bucket por bucket, con y sin período en curso. Sólo agregan el filtro de faena.
 * - El filtro de faena no abre lo que el alcance de la sesión cierra.
 * - Los rankings por faena y por tipo de equipo cuentan las mismas cargas que el total:
 *   rechazadas, anuladas y duplicadas no suman; las que esperan decisión sí.
 *
 * Es una suite PGlite: va en `tests/pglite-files.ts`.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { filtersFor } from "@/lib/combustibles/control/queries/test-fixtures"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("server-only", () => ({}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { getIndicatorFigures, getLitersByEquipmentType, getLitersByWorksite } = await import("./queries")
const { getPanelFigures } = await import("@/lib/combustibles/panel/queries")
const { buildPanelFigures } = await import("@/lib/combustibles/panel/figures")
const { describeFuelPeriod } = await import("@/lib/combustibles/period/parse")

import type { FuelPeriod } from "@/lib/combustibles/period/types"

const W_A = "wi-a"
const W_B = "wi-b"
const ME = "ui-me"

function session(options: { worksiteIds?: string[]; global?: boolean } = {}): Session {
  return {
    user: {
      id: ME, name: "Prueba", email: "prueba@example.com", roles: [], permissions: [],
      worksiteIds: options.worksiteIds ?? [], primaryWorksiteId: options.worksiteIds?.[0] ?? null,
      avatarColor: null, isActive: true, isGlobal: options.global ?? false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}
const globalSession = () => session({ global: true })

const resolve = (period: FuelPeriod, today: string) => describeFuelPeriod(period, "url", today)
const OCT: FuelPeriod = { kind: "month", year: 2026, month: 10 }

let seq = 0

interface LoadSpec {
  vehicleId: string
  worksiteId: string
  at: string
  liters: number
  review?: "ok" | "flagged" | "approved" | "rejected"
  meterDelta?: number
  accLiters?: number
  unit?: "km_per_liter" | "liters_per_hour"
  voided?: boolean
  duplicateOf?: string
}

async function addLoad(spec: LoadSpec): Promise<string> {
  seq += 1
  const loadId = `li-${seq}`
  await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
    id: `si-${seq}`, clientSubmissionId: `ci-${seq}`, publicResultToken: `ti-${seq}`, source: "public_pwa",
    worksiteId: spec.worksiteId, vehicleId: spec.vehicleId, productId: "prod-ind", equipmentCodeSnapshot: `EQ-${spec.vehicleId}`,
    plateSnapshot: `PL-${seq}`, loadedAt: spec.at, submittedAt: spec.at, driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
    meterType: "odometer", liters: spec.liters, status: "submitted",
  })
  await inMemoryDb.insert(schema.fuelEquipmentLoads).values({
    id: loadId, source: "field", taeSubmissionId: `si-${seq}`, vehicleId: spec.vehicleId, worksiteId: spec.worksiteId,
    occurredAt: spec.at, month: spec.at.slice(0, 7), liters: spec.liters, meterType: "odometer",
    performanceUnit: spec.unit ?? "km_per_liter", performanceStatus: "computed", reviewStatus: spec.review ?? "ok",
    meterDelta: spec.meterDelta ?? null, accumulatedLiters: spec.accLiters ?? null,
    voidedAt: spec.voided ? spec.at : null, duplicateOfId: spec.duplicateOf ?? null,
  })
  return loadId
}

beforeAll(async () => {
  await inMemoryDb.insert(schema.worksites).values([
    { id: W_A, name: "Faena Alfa", code: "FI-A" },
    { id: W_B, name: "Faena Beta", code: "FI-B" },
  ])
  await inMemoryDb.insert(schema.users).values({ id: ME, name: "Yo", email: "yo-ind@example.com", hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.fuelProducts).values({ id: "prod-ind", code: "DIESEL-IND", name: "Diésel", category: "diesel" })
  await inMemoryDb.insert(schema.fuelEquipmentTypes).values([
    { id: "ti-truck", slug: "camion-ind", name: "Camión", performanceFamily: "camiones" },
    { id: "ti-machine", slug: "maquina-ind", name: "Excavadora", performanceFamily: "maquinaria" },
    // Un tipo fuera de las tres familias de rendimiento: igual entra a los litros, nunca a un promedio.
    { id: "ti-other", slug: "otro-ind", name: "Grupo electrógeno" },
  ])
  const vehicle = (id: string, plate: string, code: string, typeId: string, worksiteId: string, unit: "km_per_liter" | "liters_per_hour") => ({
    id, plate, code, type: "x", equipmentTypeId: typeId, worksiteId, performanceUnit: unit, meterType: unit === "km_per_liter" ? "odometer" : "hour_meter",
  })
  await inMemoryDb.insert(schema.fuelVehicles).values([
    vehicle("vi-truck-a", "IIAA11", "CA-1", "ti-truck", W_A, "km_per_liter"),
    vehicle("vi-truck-b", "IIBB22", "CA-2", "ti-truck", W_B, "km_per_liter"),
    vehicle("vi-machine-a", "IICC33", "EX-1", "ti-machine", W_A, "liters_per_hour"),
    vehicle("vi-other-b", "IIDD44", "XX-1", "ti-other", W_B, "km_per_liter"),
  ])
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.fuelEquipmentLoads)
  await inMemoryDb.delete(schema.fuelTaeSubmissions)
  // Octubre, mes en curso (hoy es el 31).
  await addLoad({ vehicleId: "vi-truck-a", worksiteId: W_A, at: "2026-10-05T15:00:00.000Z", liters: 100, meterDelta: 280, accLiters: 100 })
  await addLoad({ vehicleId: "vi-truck-a", worksiteId: W_A, at: "2026-10-08T15:00:00.000Z", liters: 200, review: "approved", meterDelta: 540, accLiters: 200 })
  await addLoad({ vehicleId: "vi-truck-a", worksiteId: W_A, at: "2026-10-10T15:00:00.000Z", liters: 50, review: "flagged", meterDelta: 140, accLiters: 50 })
  await addLoad({ vehicleId: "vi-truck-a", worksiteId: W_A, at: "2026-10-11T15:00:00.000Z", liters: 70, review: "rejected", meterDelta: 196, accLiters: 70 })
  await addLoad({ vehicleId: "vi-truck-a", worksiteId: W_A, at: "2026-10-12T15:00:00.000Z", liters: 30, voided: true, meterDelta: 84, accLiters: 30 })
  const first = await addLoad({ vehicleId: "vi-machine-a", worksiteId: W_A, at: "2026-10-14T15:00:00.000Z", liters: 120, unit: "liters_per_hour", meterDelta: 8, accLiters: 120 })
  await addLoad({ vehicleId: "vi-machine-a", worksiteId: W_A, at: "2026-10-14T15:05:00.000Z", liters: 40, unit: "liters_per_hour", duplicateOf: first, meterDelta: 3, accLiters: 40 })
  await addLoad({ vehicleId: "vi-truck-b", worksiteId: W_B, at: "2026-10-16T15:00:00.000Z", liters: 300, meterDelta: 840, accLiters: 300 })
  await addLoad({ vehicleId: "vi-other-b", worksiteId: W_B, at: "2026-10-17T15:00:00.000Z", liters: 25 })
  // Septiembre. La de las 23:30 de Chile del 30 es de septiembre aunque en UTC ya sea octubre.
  await addLoad({ vehicleId: "vi-truck-a", worksiteId: W_A, at: "2026-09-05T15:00:00.000Z", liters: 150, meterDelta: 400, accLiters: 150 })
  await addLoad({ vehicleId: "vi-truck-b", worksiteId: W_B, at: "2026-09-20T15:00:00.000Z", liters: 500, meterDelta: 1250, accLiters: 500 })
  await addLoad({ vehicleId: "vi-truck-a", worksiteId: W_A, at: "2026-10-01T02:30:00.000Z", liters: 10, meterDelta: 30, accLiters: 10 })
})

describe("getIndicatorFigures · las cifras del Panel con filtro de faena", () => {
  it("sin faena devuelve exactamente los dos últimos buckets del Panel (período cerrado)", async () => {
    const resolved = resolve(OCT, "2026-11-13")
    const panel = await getPanelFigures(globalSession(), resolved, "2026-11-13")
    const mine = await getIndicatorFigures(globalSession(), resolved, { today: "2026-11-13" })
    expect(mine.buckets).toEqual(panel.buckets.slice(-2))
    expect(mine.partialPrevLiters).toBe(panel.partialPrevLiters)
    // Y las cifras armadas coinciden: valor y variación.
    const fromPanel = buildPanelFigures(panel, resolved, "2026-11-13")
    const fromMine = buildPanelFigures(mine, resolved, "2026-11-13")
    const core = ({ value, label, hint, variation }: typeof fromPanel.liters) => ({ value, label, hint, variation })
    expect(core(fromMine.liters)).toEqual(core(fromPanel.liters))
    // La historia del Panel tiene cinco períodos; la de acá sólo el anterior y el actual.
    expect(fromMine.liters.history.map((point) => point.value)).toEqual(fromPanel.liters.history.slice(-2).map((point) => point.value))
    expect(fromMine.trucks.value).toBe(fromPanel.trucks.value)
    expect(fromMine.trucks.variation).toEqual(fromPanel.trucks.variation)
    expect(fromMine.machinery.value).toBe(fromPanel.machinery.value)
  })

  it("con el período en curso compara contra los mismos primeros días, igual que el Panel", async () => {
    const resolved = resolve(OCT, "2026-10-16")
    const panel = await getPanelFigures(globalSession(), resolved, "2026-10-16")
    const mine = await getIndicatorFigures(globalSession(), resolved, { today: "2026-10-16" })
    expect(mine.buckets).toEqual(panel.buckets.slice(-2))
    expect(mine.partialPrevLiters).not.toBeNull()
    expect(mine.partialPrevLiters).toBe(panel.partialPrevLiters)
  })

  it("octubre: litros de lo que cuenta; el promedio sólo de lo calculado y sin decisión pendiente", async () => {
    const mine = await getIndicatorFigures(globalSession(), resolve(OCT, "2026-11-13"), { today: "2026-11-13" })
    const [september, october] = mine.buckets
    // Rechazada, anulada y duplicada no suman; la marcada sí.
    expect(october?.liters).toBe(100 + 200 + 50 + 120 + 300 + 25)
    expect(october?.truckKm).toBe(280 + 540 + 840)
    expect(october?.truckExcluded).toBe(1)
    expect(october?.machineHours).toBe(8)
    // Septiembre incluye la carga de las 23:30 de Chile del 30.
    expect(september?.liters).toBe(150 + 500 + 10)
  })

  it("con faena sólo cuenta esa faena", async () => {
    const mine = await getIndicatorFigures(globalSession(), resolve(OCT, "2026-11-13"), { worksiteId: W_B, today: "2026-11-13" })
    const [september, october] = mine.buckets
    expect(october).toMatchObject({ liters: 300 + 25, truckKm: 840, truckLiters: 300, machineHours: 0, equipment: 2 })
    expect(september?.liters).toBe(500)
  })

  it("el alcance de la sesión manda: pedir una faena ajena no devuelve nada", async () => {
    const scoped = session({ worksiteIds: [W_A] })
    const mine = await getIndicatorFigures(scoped, resolve(OCT, "2026-11-13"), { worksiteId: W_B, today: "2026-11-13" })
    expect(mine.buckets.map((bucket) => bucket.liters)).toEqual([0, 0])
    // Y sin pedir faena sólo ve la suya.
    const own = await getIndicatorFigures(scoped, resolve(OCT, "2026-11-13"), { today: "2026-11-13" })
    expect(own.buckets[1]?.liters).toBe(100 + 200 + 50 + 120)
  })
})

describe("getLitersByWorksite", () => {
  it("suma las cargas que cuentan por faena, la de más litros primero", async () => {
    const rows = await getLitersByWorksite(globalSession(), filtersFor({ anio: "2026", meses: "10" }))
    expect(rows.map((row) => [row.name, row.liters, row.equipment])).toEqual([
      // Con año y mes el período es la columna `month`: la carga de las 23:30 del 30 de septiembre trae `month` de octubre.
      ["Faena Alfa", 100 + 200 + 50 + 120 + 10, 2],
      ["Faena Beta", 300 + 25, 2],
    ])
  })

  it("respeta el filtro de faena y el alcance de la sesión", async () => {
    const filtered = await getLitersByWorksite(globalSession(), filtersFor({ anio: "2026", meses: "10", faena: W_A }))
    expect(filtered.map((row) => row.name)).toEqual(["Faena Alfa"])
    const scoped = await getLitersByWorksite(session({ worksiteIds: [W_B] }), filtersFor({ anio: "2026", meses: "10" }))
    expect(scoped.map((row) => row.name)).toEqual(["Faena Beta"])
  })

  it("la suma de las faenas es el total de litros del período del tile", async () => {
    const resolved = resolve(OCT, "2026-11-13")
    const figures = await getIndicatorFigures(globalSession(), resolved, { today: "2026-11-13" })
    const rows = await getLitersByWorksite(globalSession(), { year: 2026, months: [], from: resolved.from, to: resolved.to, page: 1 })
    expect(rows.reduce((sum, row) => sum + row.liters, 0)).toBe(figures.buckets[1]?.liters)
  })
})

describe("getLitersByEquipmentType", () => {
  it("agrupa por tipo de equipo, el de más litros primero", async () => {
    const rows = await getLitersByEquipmentType(globalSession(), filtersFor({ anio: "2026", meses: "10" }))
    expect(rows.map((row) => [row.name, row.liters, row.equipment])).toEqual([
      ["Camión", 100 + 200 + 50 + 300 + 10, 2],
      ["Excavadora", 120, 1],
      ["Grupo electrógeno", 25, 1],
    ])
  })

  it("sólo ve las faenas del alcance", async () => {
    const rows = await getLitersByEquipmentType(session({ worksiteIds: [W_A] }), filtersFor({ anio: "2026", meses: "10" }))
    expect(rows.map((row) => row.name)).toEqual(["Camión", "Excavadora"])
    expect(rows[0]?.liters).toBe(100 + 200 + 50 + 10)
  })
})
