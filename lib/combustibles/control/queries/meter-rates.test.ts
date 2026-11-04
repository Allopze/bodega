import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, globalSession, scopedSession, seedControlFixtures } from "./test-fixtures"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { getMeterRateSeries } = await import("./meter-rates")

/**
 * CHART-016: el rendimiento por mes sale de `fuel_meter_readings` (Copec). La lectura no lleva faena: el alcance
 * es el del equipo, así que un usuario de la faena A no puede ver ni un tramo de la faena B.
 *
 * Ventana de la prueba: marzo, abril y mayo de 2026. Abril no tiene lecturas ni cobertura del proveedor (un hueco,
 * como septiembre de 2026 en producción); febrero sólo aporta la lectura base del primer par de marzo.
 */
const WINDOW = { monthKeys: ["2026-03", "2026-04", "2026-05"], to: "2026-05-31", today: "2026-11-03" }
const FILTERS = {}

const V = { kmA: "veh-mr-km-a", kmB: "veh-mr-km-b", kmC: "veh-mr-km-c", kmReset: "veh-mr-km-reset" } as const

let n = 0
async function addReadings(
  vehicleId: string,
  readings: Array<{ value: number; at: string; liters: number | null; source?: "copec_tct" | "gps_onway"; meterType?: "odometer" | "hour_meter" }>,
) {
  const ids: string[] = []
  for (const reading of readings) {
    n += 1
    const id = `mr-${n}`
    ids.push(id)
    await testDb.insert(schema.fuelMeterReadings).values({
      id, vehicleId, plate: `PL-${vehicleId}`, source: reading.source ?? "copec_tct", sourceRef: `ref-${id}`,
      occurredAt: `${reading.at}T15:00:00.000Z`, meterType: reading.meterType ?? "odometer", value: reading.value, liters: reading.liters,
    })
  }
  return ids
}

/** Febrero (base) + cuatro cargas de marzo cada 100 km con 40 L, y tres en mayo después del hueco de abril. */
const cleanSeries = (offset: number, litersPerLoad: number) => [
  { value: offset + 9_900, at: "2026-02-27", liters: litersPerLoad },
  { value: offset + 10_000, at: "2026-03-02", liters: litersPerLoad },
  { value: offset + 10_100, at: "2026-03-08", liters: litersPerLoad },
  { value: offset + 10_200, at: "2026-03-14", liters: litersPerLoad },
  { value: offset + 10_300, at: "2026-03-20", liters: litersPerLoad },
  // Marzo → mayo cruza abril, sin datos del proveedor: ese par no se usa.
  { value: offset + 10_400, at: "2026-05-02", liters: litersPerLoad },
  { value: offset + 10_500, at: "2026-05-10", liters: litersPerLoad },
  { value: offset + 10_600, at: "2026-05-18", liters: litersPerLoad },
  { value: offset + 10_700, at: "2026-05-26", liters: litersPerLoad },
]

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelAnomalyRules).values([
    { id: "rule-mr-salto", code: "salto_medidor_implausible", name: "Salto de medidor implausible", severity: "high", isActive: true, config: JSON.stringify({ maxKmPerDay: 1500, maxHoursPerDay: 24 }) },
    { id: "rule-mr-km", code: "kilometraje_regresivo", name: "Kilometraje regresivo", severity: "high", isActive: true, config: "{}" },
  ])
  await testDb.insert(schema.fuelVehicles).values([
    { id: V.kmA, plate: "KM-0001", code: "KM-A", type: "camion", equipmentTypeId: IDS.eqType, meterType: "odometer", performanceUnit: "km_per_liter", worksiteId: IDS.wsA },
    { id: V.kmB, plate: "KM-0002", code: "KM-B", type: "camion", equipmentTypeId: IDS.eqType, meterType: "odometer", performanceUnit: "km_per_liter", worksiteId: IDS.wsB },
    { id: V.kmC, plate: "KM-0003", code: "KM-C", type: "camion", equipmentTypeId: IDS.eqType, meterType: "odometer", performanceUnit: "km_per_liter", worksiteId: IDS.wsC },
    { id: V.kmReset, plate: "KM-0004", code: "KM-R", type: "camion", equipmentTypeId: IDS.eqType, meterType: "odometer", performanceUnit: "km_per_liter", worksiteId: IDS.wsC },
  ])

  // Faena A: 2,5 km/L en marzo (cada 100 km con 40 L). Faena B: 5 km/L. Faena C (otro mandante): 4 km/L.
  await addReadings(V.kmA, [
    ...cleanSeries(0, 40),
    // Otra fuente (GPS): su desfase propio no se mezcla con el de Copec.
    { value: 999_999, at: "2026-03-09", liters: 1, source: "gps_onway" },
  ])
  await addReadings(V.kmB, cleanSeries(50_000, 20))
  await addReadings(V.kmC, cleanSeries(80_000, 25))

  // Horómetro (equipo L/h de la faena A): 10 L/h en marzo.
  await addReadings(IDS.vA, [
    { value: 100, at: "2026-02-26", liters: 80, meterType: "hour_meter" },
    { value: 108, at: "2026-03-03", liters: 80, meterType: "hour_meter" },
    { value: 116, at: "2026-03-10", liters: 80, meterType: "hour_meter" },
    { value: 124, at: "2026-03-17", liters: 80, meterType: "hour_meter" },
    { value: 132, at: "2026-03-24", liters: 80, meterType: "hour_meter" },
    // Lectura de odómetro en un equipo de L/h: el rendimiento de ese equipo es L/h, no se mira.
    { value: 5_000, at: "2026-03-24", liters: 80, meterType: "odometer" },
  ])

  // Un camión de la faena C con un retroceso de odómetro que se aceptó como reset (cambio de tablero).
  const resetIds = await addReadings(V.kmReset, [
    { value: 80_000, at: "2026-03-01", liters: 40 },
    { value: 80_100, at: "2026-03-05", liters: 40 },
    { value: 100, at: "2026-03-10", liters: 40 }, // tablero nuevo: reset aceptado
    { value: 200, at: "2026-03-15", liters: 40 },
    { value: 300, at: "2026-03-20", liters: 40 },
  ])
  await testDb.insert(schema.fuelAnomalyCases).values({
    id: "case-mr-reset", ruleId: "rule-mr-km", ruleCode: "kilometraje_regresivo", severity: "high", vehicleId: V.kmReset,
    referenceEntityType: "fuel_meter_reading", referenceEntityId: resetIds[2]!,
    description: "Lectura de odómetro menor que la carga anterior.", status: "resolved", resolutionKind: "reset_medidor",
  })
}, 60_000)

describe("getMeterRateSeries · fuente y método", () => {
  it("arma el rendimiento de marzo con los pares que cierra, base de febrero incluida, y deja abril como hueco", async () => {
    const { km_per_liter: km } = await getMeterRateSeries(globalSession(), { worksiteId: IDS.wsA }, WINDOW)

    const [march, april, may] = km.months
    // 4 pares de marzo (el primero abre con la lectura de febrero): 400 km con 160 L.
    expect(march).toMatchObject({ month: "2026-03", segments: 4, measure: 400, liters: 160, equipment: 1, status: "ok", partial: false })
    expect(march!.rate).toBeCloseTo(2.5, 10)
    expect(april).toMatchObject({ month: "2026-04", status: "gap", rate: null, segments: 0 })
    // Mayo: el par marzo → mayo cruza el hueco de abril y se descarta; los otros tres cuentan.
    expect(may).toMatchObject({ segments: 3, measure: 300, liters: 120, discarded: 1, status: "ok" })
    // Las lecturas de GPS no se mezclan; las de la ventana son 4 de marzo + 4 de mayo (la de febrero es sólo base).
    expect(km.readings).toBe(8)
    expect(km.rate).toBeCloseTo(2.5, 10)
  })

  it("los equipos de horómetro dan L/h y su otro medidor no se mira", async () => {
    const { liters_per_hour: hours } = await getMeterRateSeries(globalSession(), { worksiteId: IDS.wsA }, WINDOW)

    expect(hours.months[0]).toMatchObject({ segments: 4, measure: 32, liters: 320, status: "ok" })
    expect(hours.months[0]!.rate).toBeCloseTo(10, 10)
    expect(hours.readings).toBe(4)
  })

  it("un reset aceptado parte la serie y no cuenta como par descartado", async () => {
    const { km_per_liter: km } = await getMeterRateSeries(globalSession(), { mandanteId: IDS.m2, worksiteId: IDS.wsC }, WINDOW)

    // kmC: 4 pares de marzo con 100 km y 25 L. kmReset: 80.000→80.100 y 100→200, 200→300 (3 pares; el retroceso es el reset).
    expect(km.months[0]).toMatchObject({ segments: 4 + 3, discarded: 0, status: "ok" })
  })
})

describe("getMeterRateSeries · alcance", () => {
  it("cada faena ve sólo los tramos de sus propios equipos", async () => {
    const forA = await getMeterRateSeries(scopedSession([IDS.wsA]), FILTERS, WINDOW)
    const forB = await getMeterRateSeries(scopedSession([IDS.wsB]), FILTERS, WINDOW)

    expect(forA.km_per_liter.months[0]).toMatchObject({ measure: 400, liters: 160, equipment: 1 })
    expect(forA.km_per_liter.months[0]!.rate).toBeCloseTo(2.5, 10)
    // El camión de la faena B rinde 5 km/L: si A lo viera, el global de A no sería 2,5.
    expect(forB.km_per_liter.months[0]).toMatchObject({ measure: 400, liters: 80, equipment: 1 })
    expect(forB.km_per_liter.months[0]!.rate).toBeCloseTo(5, 10)
    expect(forA.liters_per_hour.readings).toBe(4)
    expect(forB.liters_per_hour.readings).toBe(0)
  })

  it("un usuario sin faenas no ve nada: ni lecturas ni un rendimiento", async () => {
    const none = await getMeterRateSeries(scopedSession([]), FILTERS, WINDOW)

    expect(none.km_per_liter).toMatchObject({ readings: 0, status: "empty", rate: null, segments: 0 })
    expect(none.liters_per_hour).toMatchObject({ readings: 0, status: "empty" })
  })

  it("el filtro de faena se intersecta con el alcance: pedir la B desde la A no abre la B", async () => {
    const crossed = await getMeterRateSeries(scopedSession([IDS.wsA]), { worksiteId: IDS.wsB }, WINDOW)

    expect(crossed.km_per_liter.readings).toBe(0)
  })

  it("el mandante acota a sus faenas", async () => {
    const m1 = await getMeterRateSeries(globalSession(), { mandanteId: IDS.m1 }, WINDOW)
    const m2 = await getMeterRateSeries(globalSession(), { mandanteId: IDS.m2 }, WINDOW)

    // M1 = faenas A y B (dos camiones limpios); M2 = faena C (kmC y el del reset).
    expect(m1.km_per_liter.months[0]).toMatchObject({ equipment: 2, segments: 8, measure: 800, liters: 240 })
    expect(m2.km_per_liter.months[0]!.equipment).toBe(2)
  })
})

describe("getMeterRateSeries · ventana", () => {
  it("el mes en curso se marca parcial y las lecturas posteriores al fin de la ventana no entran", async () => {
    const cut = await getMeterRateSeries(globalSession(), { worksiteId: IDS.wsA }, { monthKeys: ["2026-03", "2026-04", "2026-05"], to: "2026-05-12", today: "2026-11-03" })

    const may = cut.km_per_liter.months[2]!
    expect(may.partial).toBe(true)
    // Hasta el 12 de mayo sólo están las del 2 y el 10: la del 18 y la del 26 quedan fuera.
    expect(may.segments).toBe(1)
    expect(cut.km_per_liter.months[0]!.partial).toBe(false)
  })

  it("un período que no empieza el día 1 deja fuera lo anterior a su inicio, pero usa esa lectura como base", async () => {
    const mid = await getMeterRateSeries(globalSession(), { worksiteId: IDS.wsA }, { ...WINDOW, from: "2026-03-14" })

    // Del camión A en marzo (2, 8, 14 y 20): desde el 14 sólo cierran los pares del 14 y el 20; el del 8 → 14 sí (cierra el 14).
    expect(mid.km_per_liter.months[0]).toMatchObject({ segments: 2, measure: 200, liters: 80 })
  })

  it("una ventana vacía no consulta nada ni revienta", async () => {
    const none = await getMeterRateSeries(globalSession(), FILTERS, { monthKeys: [], to: "2026-05-31" })

    expect(none.km_per_liter.months).toEqual([])
    expect(none.km_per_liter.status).toBe("empty")
  })
})
