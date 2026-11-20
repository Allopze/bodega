import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, filtersFor, globalSession, seedControlFixtures, submission } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Uso personal en el rendimiento (km/L, L/h) de gestión: las cargas del período y la
 * PRIMERA después no entran a promedios ni a desviaciones (su `performance_value` se
 * calculó contra una lectura anterior y trae los km/horas del dueño); las siguientes
 * vuelven a contar. También la serie mensual de rendimiento por lecturas de medidor
 * y el rendimiento del log operacional alrededor de una salida de taller.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getWorksiteStats, getEquipmentStats, getReviewExclusions } = await import("@/lib/combustibles/control/queries/performance")
const { getMeterRateSeries } = await import("@/lib/combustibles/control/queries/meter-rates")
const { getWorkOrderConsumptionImpact } = await import("@/lib/services/fleet")

const L = schema.fuelEquipmentLoads
let seq = 0

async function addLoad(day: string, performanceValue: number, reviewStatus = "ok") {
  const id = `pp-l-${++seq}`
  const sub = submission({ vehicleId: IDS.vA, loadedAt: `${day}T15:00:00.000Z`, submittedAt: `${day}T15:00:00.000Z` })
  await testDb.insert(schema.fuelTaeSubmissions).values(sub)
  await testDb.insert(L).values({
    id, source: "field", taeSubmissionId: sub.id, vehicleId: IDS.vA, worksiteId: IDS.wsA, occurredAt: `${day}T15:00:00.000Z`,
    month: day.slice(0, 7), liters: 100, performanceUnit: "liters_per_hour", performanceValue, performanceStatus: "computed", reviewStatus,
  })
}

async function markPersonalUse(vehicleId: string, startedOn: string, endedOn: string | null) {
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values({ id: `pp-pu-${++seq}`, vehicleId, startedOn, endedOn })
}

const OCTOBER = filtersFor({ meses: "10", faena: IDS.wsA })
const NOVEMBER = filtersFor({ meses: "11", faena: IDS.wsA })

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  // Cargas de vA los días 5, 12 (dentro del período 10-15), 18 (la primera después) y 25; y una en noviembre.
  await addLoad("2026-10-05", 10)
  await addLoad("2026-10-12", 20)
  await addLoad("2026-10-18", 30)
  await addLoad("2026-10-25", 12)
  await addLoad("2026-11-03", 14)
  // Una carga en revisión dentro del período no se cuenta como «excluida por revisión».
  await addLoad("2026-10-13", 99, "flagged")
}, 60_000)

afterEach(async () => {
  await testDb.delete(schema.fuelVehiclePersonalUsePeriods)
})

const octoberStats = async () => {
  const rows = await getWorksiteStats(globalSession(), OCTOBER)
  return rows.find((row) => row.worksiteId === IDS.wsA && row.unit === "liters_per_hour")
}

describe("rendimiento por faena", () => {
  it("sin uso personal promedia todas las cargas válidas", async () => {
    expect(await octoberStats()).toMatchObject({ n: 4, mean: 18 })
  })

  it("excluye la carga del período (12) y la primera después (18); incluye la del 5 y la del 25", async () => {
    await markPersonalUse(IDS.vA, "2026-10-10", "2026-10-15")
    expect(await octoberStats()).toMatchObject({ n: 2, mean: 11 })
  })

  it("quitar el período devuelve el promedio de siempre", async () => {
    await markPersonalUse(IDS.vA, "2026-10-10", "2026-10-15")
    await testDb.delete(schema.fuelVehiclePersonalUsePeriods)
    expect(await octoberStats()).toMatchObject({ n: 4, mean: 18 })
  })

  it("un período abierto contamina las cargas desde su inicio y la primera antes de él no", async () => {
    await markPersonalUse(IDS.vA, "2026-10-10", null)
    expect(await octoberStats()).toMatchObject({ n: 1, mean: 10 })
  })

  it("las cargas en revisión del período no se cuentan entre las excluidas por revisión", async () => {
    expect((await getReviewExclusions(globalSession(), OCTOBER)).liters_per_hour).toBe(1)
    await markPersonalUse(IDS.vA, "2026-10-10", "2026-10-15")
    expect((await getReviewExclusions(globalSession(), OCTOBER)).liters_per_hour).toBe(0)
  })
})

describe("rendimiento por equipo", () => {
  it("el promedio del equipo y su histórico de 12 meses sacan las cargas contaminadas", async () => {
    await markPersonalUse(IDS.vA, "2026-10-10", "2026-10-15")
    const october = await getEquipmentStats(globalSession(), OCTOBER)
    expect(october.rows.find((row) => row.vehicleId === IDS.vA)).toMatchObject({ n: 2, mean: 11 })
    // Noviembre: su carga cuenta (14) y el histórico (octubre) ya no trae la del 12 ni la del 18.
    const november = await getEquipmentStats(globalSession(), NOVEMBER)
    expect(november.rows.find((row) => row.vehicleId === IDS.vA)).toMatchObject({ n: 1, mean: 14, historyMean: 11 })
  })

  it("sin uso personal el histórico incluye todas las cargas", async () => {
    const november = await getEquipmentStats(globalSession(), NOVEMBER)
    expect(november.rows.find((row) => row.vehicleId === IDS.vA)).toMatchObject({ n: 1, mean: 14, historyMean: 18 })
  })
})

describe("rendimiento por mes (lecturas de medidor)", () => {
  const WINDOW = { monthKeys: ["2026-10"], to: "2026-10-31", today: "2026-11-20" }
  const hours = (day: string, value: number) => ({ day, value })

  beforeAll(async () => {
    // vA (L/h): +10 h y 20 L en cada lectura. Pares: 01→05, 05→08, 08→12, 12→17, 17→20, 20→24.
    const rows = [hours("2026-10-01", 1_000), hours("2026-10-05", 1_010), hours("2026-10-08", 1_020), hours("2026-10-12", 1_030),
      hours("2026-10-17", 1_040), hours("2026-10-20", 1_050), hours("2026-10-24", 1_060)]
    await testDb.insert(schema.fuelMeterReadings).values(rows.map((row, i) => ({
      id: `pp-mr-${i}`, vehicleId: IDS.vA, plate: "AA0001", source: "copec_tct", sourceRef: `pp-ref-${i}`,
      occurredAt: `${row.day}T15:00:00.000Z`, meterType: "hour_meter", value: row.value, liters: 20,
    })))
  })

  it("sin uso personal cuenta los seis pares", async () => {
    const series = (await getMeterRateSeries(globalSession(), {}, WINDOW)).liters_per_hour
    expect(series).toMatchObject({ segments: 6, measure: 60, liters: 120 })
  })

  it("descarta los pares que recorren días del período, aunque no tengan lectura en ellos", async () => {
    await markPersonalUse(IDS.vA, "2026-10-10", "2026-10-15")
    const series = (await getMeterRateSeries(globalSession(), {}, WINDOW)).liters_per_hour
    // 08→12 y 12→17 recorren los días 10 a 15 y salen; quedan 01→05, 05→08, 17→20 y 20→24.
    expect(series).toMatchObject({ segments: 4, measure: 40, liters: 80 })
  })
})

describe("rendimiento antes y después de la salida de taller", () => {
  beforeAll(async () => {
    await testDb.insert(schema.fuelOperationBatches).values({
      id: "pp-batch", archivoNombre: "x.xlsx", hashArchivo: "pp-hash", periodoDesde: "2026-10-01", periodoHasta: "2026-11-30", importadoPor: IDS.user,
    })
    const record = (id: string, fecha: string, rendimiento: number) => ({
      id, batchId: "pp-batch", worksiteId: IDS.wsA, vehicleId: IDS.vA, plate: "AA0001", fecha, liters: 50, rendimiento,
    })
    await testDb.insert(schema.fuelOperationRecords).values([
      record("pp-op-1", "2026-10-10", 4), record("pp-op-2", "2026-10-15", 8), record("pp-op-3", "2026-10-25", 6),
    ])
    await testDb.insert(schema.mantWorkOrders).values({
      id: "pp-ot", folio: "OT-PP-1", vehicleId: IDS.vA, worksiteId: IDS.wsA,
      equipmentSnapshot: { code: "KA-1", plate: "AA0001", noPlate: false, type: "Tipo", brand: "x", model: "y", year: 2020, worksite: "Faena A", unit: "h" },
      repair: true, maintenance: false, requestDate: "2026-10-01", requestedByUserId: IDS.user, requesterName: "Alexis Morales",
      repairDescription: "Falla de frenos en la cabina", status: "trabajo_terminado",
      assignedToUserId: IDS.user, assignedByUserId: IDS.user, assignedAt: "2026-10-02T12:00:00Z",
      workshopKind: "interno", workshopEntryAt: "2026-10-18T12:00:00Z", estimatedDeliveryDate: "2026-10-20",
      startedAt: "2026-10-18T12:00:00Z", startedByUserId: IDS.user,
      workshopExitAt: "2026-10-20T15:00:00Z", finishedAt: "2026-10-20T15:00:00Z", finishedByUserId: IDS.user,
    })
  })

  const impact = async () => (await getWorkOrderConsumptionImpact([{ id: "pp-ot", status: "cerrada", workshopExitAt: "2026-10-20T15:00:00Z" }]))[0]

  it("sin uso personal promedia todos los registros de la ventana", async () => {
    expect(await impact()).toMatchObject({ avgBefore: 6, avgAfter: 6 })
  })

  it("el registro de un día de uso personal no cuenta para juzgar la salida de taller", async () => {
    await markPersonalUse(IDS.vA, "2026-10-12", "2026-10-16")
    expect(await impact()).toMatchObject({ avgBefore: 4, avgAfter: 6 })
  })
})
