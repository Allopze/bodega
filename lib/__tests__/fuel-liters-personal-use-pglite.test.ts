import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describeFuelPeriod } from "@/lib/combustibles/period/parse"
import { IDS, filtersFor, globalSession, scopedSession, seedControlFixtures, submission } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Litros de las cargas en terreno sin los días de uso personal, contra Postgres de verdad: el Panel
 * (cifras y nota), los indicadores, la vista general del control, la comparación de L/h, los totales TAE
 * y la ficha del equipo. La bitácora, «Por revisar» y los pagos no cambian.
 *
 * vA estuvo en uso personal del 10 al 19 de octubre; vB no. Cargas de vA (litros · avance de horas · L/h):
 * - 05: 100 · 10 · 10
 * - 12: 200 · 10 · 20   (dentro del período: no suma en gestión)
 * - 22: 300 · 5 · 60    (primera después: sus litros cuentan, su rendimiento no)
 * - 28: 400 · 40 · 10
 * vB: 70 L · 7 h el 12.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getPanelFigures, hasMeasuredPerformance, getMyEquipmentRanking, getPersonalUseDaysInPeriod, getPaymentActivity } = await import("@/lib/combustibles/panel/queries")
const { getIndicatorFigures, getLitersByEquipmentType, getLitersByWorksite } = await import("@/lib/combustibles/indicators/queries")
const { getLitersByMonthAndMedium, getMeterSeries, getOverviewHeader } = await import("@/lib/combustibles/control/queries/overview")
const { getLitersPerHourComparison } = await import("@/lib/combustibles/control/queries/idle-comparison")
const { getTaeGroupedTotals } = await import("@/lib/combustibles/tae-dashboard")
const { getEquipmentFile } = await import("@/lib/combustibles/equipment/get-equipment-file")

const OCT = describeFuelPeriod({ kind: "month", year: 2026, month: 10 }, "url", "2026-10-31")
const NOV = describeFuelPeriod({ kind: "month", year: 2026, month: 11 }, "url", "2026-11-30")

function fileSession(): Session {
  const base = globalSession()
  return { ...base, user: { ...base.user, permissions: ["combustibles:view"] } } as Session
}

async function addLoad(id: string, vehicleId: string, worksiteId: string, day: string, liters: number, meterDelta: number, perf: number) {
  const at = `${day}T15:00:00.000Z`
  const sub = submission({ vehicleId, worksiteId, loadedAt: at, submittedAt: at, liters })
  await testDb.insert(schema.fuelTaeSubmissions).values(sub)
  await testDb.insert(schema.fuelEquipmentLoads).values({
    id, source: "field", taeSubmissionId: sub.id, vehicleId, worksiteId, occurredAt: at, month: day.slice(0, 7), liters,
    meterDelta, accumulatedLiters: liters, performanceUnit: "liters_per_hour", performanceValue: perf, performanceStatus: "computed", reviewStatus: "ok",
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  // La maquinaria se mide en L/h (el Panel la separa de los camiones por la familia del tipo).
  await testDb.update(schema.fuelEquipmentTypes).set({ performanceFamily: "maquinaria" }).where(eq(schema.fuelEquipmentTypes.id, IDS.eqType))
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values([
    { id: "ll-pu-a", vehicleId: IDS.vA, startedOn: "2026-10-10", endedOn: "2026-10-19" },
    // Abierto desde el 25: cuenta hasta hoy.
    { id: "ll-pu-c", vehicleId: IDS.vC, startedOn: "2026-10-25", endedOn: null },
  ])

  await addLoad("ll-a-05", IDS.vA, IDS.wsA, "2026-10-05", 100, 10, 10)
  await addLoad("ll-a-12", IDS.vA, IDS.wsA, "2026-10-12", 200, 10, 20)
  await addLoad("ll-a-22", IDS.vA, IDS.wsA, "2026-10-22", 300, 5, 60)
  await addLoad("ll-a-28", IDS.vA, IDS.wsA, "2026-10-28", 400, 40, 10)
  await addLoad("ll-b-12", IDS.vB, IDS.wsB, "2026-10-12", 70, 7, 10)

  // Telemetría de vA fuera del período (la comparación de L/h la necesita para existir).
  await testDb.insert(schema.fuelTelemetryDaily).values(["2026-10-08", "2026-10-25"].map((day, i) => ({
    id: `ll-tel-${i}`, vehicleId: IDS.vA, source: "visionlink", day, month: "2026-10", operatingHours: 8, idleHours: 2, litersWorking: 60, litersIdle: 10,
  })))

  // Una carga facturada de vA dentro del período: los pagos la ven.
  await testDb.insert(schema.fuelSuppliers).values({ id: "ll-sup", name: "Copec" })
  await testDb.insert(schema.fuelLoads).values({
    id: "ll-fl", loadDate: "2026-10-12", month: "2026-10", serviceType: "TCT", vehicleId: IDS.vA, fuelSupplierId: "ll-sup", worksiteId: IDS.wsA,
    product: "PETROLEO DIESEL", productId: IDS.product, liters: 200, baseAmount: 240_000, totalAmount: 240_000, status: "registered", createdBy: IDS.user,
  })
}, 60_000)

describe("Panel de combustible", () => {
  it("los litros del período pierden las cargas de uso personal; los litros de la primera carga después sí cuentan", async () => {
    const raw = await getPanelFigures(globalSession(), OCT, "2026-10-31")
    expect(raw.buckets[4]!.liters).toBe(870) // 100 + 300 + 400 de vA y 70 de vB; la del 12 queda fuera
    expect(raw.buckets[4]!.loads).toBe(4)
  })

  it("el L/h sólo promedia tramos sanos: sin los del período ni la primera carga después", async () => {
    const october = (await getPanelFigures(globalSession(), OCT, "2026-10-31")).buckets[4]!
    expect(october.machineHours).toBe(10 + 40 + 7)
    expect(october.machineLiters).toBe(100 + 400 + 70)
  })

  it("expone los días de uso personal del período y del alcance para la nota", async () => {
    // 10 de vA (10 al 19) + 7 de vC (abierto desde el 25, hasta el 31).
    expect((await getPanelFigures(globalSession(), OCT, "2026-10-31")).personalUseDaysInPeriod).toBe(17)
    expect(await getPersonalUseDaysInPeriod(globalSession(), OCT.from, OCT.to, { today: "2026-10-31" })).toBe(17)
    // Un período abierto cuenta hasta hoy: el 27 sólo van 3 días de vC (25, 26 y 27).
    expect(await getPersonalUseDaysInPeriod(globalSession(), OCT.from, OCT.to, { today: "2026-10-27", worksiteId: IDS.wsC })).toBe(3)
    // Acotado a la faena de otro equipo, o fuera del alcance de la persona, no hay nada que avisar.
    expect(await getPersonalUseDaysInPeriod(globalSession(), OCT.from, OCT.to, { today: "2026-10-31", worksiteId: IDS.wsB })).toBe(0)
    expect(await getPersonalUseDaysInPeriod(scopedSession([IDS.wsB]), OCT.from, OCT.to, { today: "2026-10-31" })).toBe(0)
    // Un período sin días marcados no avisa.
    expect(await getPersonalUseDaysInPeriod(globalSession(), "2026-09-01", "2026-09-30", { today: "2026-10-31" })).toBe(0)
    expect(await getPersonalUseDaysInPeriod(globalSession(), NOV.from, NOV.to, { today: "2026-10-31" })).toBe(0)
  })

  it("«equipos con más litros» y «hay rendimiento medido» siguen la regla de gestión", async () => {
    const ranking = await getMyEquipmentRanking(globalSession(), OCT)
    expect(ranking.find((row) => row.vehicleId === IDS.vA)!.liters).toBe(800)
    expect(ranking.find((row) => row.vehicleId === IDS.vB)!.liters).toBe(70)
    expect(await hasMeasuredPerformance(globalSession(), OCT)).toBe(true)
    // Noviembre no tiene cargas.
    expect(await hasMeasuredPerformance(globalSession(), NOV)).toBe(false)
  })

  it("los pagos no cambian: la carga facturada de un día de uso personal sigue contando", async () => {
    expect(await getPaymentActivity(OCT)).toEqual({ statements: 0, invoicedLoads: 1 })
  })
})

describe("indicadores de combustible", () => {
  it("son las mismas cifras del Panel y exponen los días de uso personal", async () => {
    const panel = await getPanelFigures(globalSession(), OCT, "2026-10-31")
    const mine = await getIndicatorFigures(globalSession(), OCT, { today: "2026-10-31" })
    expect(mine.buckets).toEqual(panel.buckets.slice(-2))
    expect(mine.personalUseDaysInPeriod).toBe(17)
    // Con la faena de vB acotada, ni los litros de vA ni sus días entran.
    const onlyB = await getIndicatorFigures(globalSession(), OCT, { today: "2026-10-31", worksiteId: IDS.wsB })
    expect(onlyB.buckets[1]!.liters).toBe(70)
    expect(onlyB.personalUseDaysInPeriod).toBe(0)
  })

  it("litros por faena y por tipo de equipo suman lo que dice la cifra", async () => {
    const filters = { ...filtersFor({ meses: "10" }), months: [] as number[], from: OCT.from, to: OCT.to }
    const byWorksite = await getLitersByWorksite(globalSession(), filters)
    expect(byWorksite.find((row) => row.worksiteId === IDS.wsA)!.liters).toBe(800)
    expect(byWorksite.find((row) => row.worksiteId === IDS.wsB)!.liters).toBe(70)
    const byType = await getLitersByEquipmentType(globalSession(), filters)
    expect(byType).toHaveLength(1)
    expect(byType[0]!.liters).toBe(870)
  })
})

describe("vista general del control", () => {
  it("cabecera, litros por mes y serie del medidor no cuentan el uso personal", async () => {
    const filters = filtersFor({ meses: "10" })
    const header = await getOverviewHeader(globalSession(), filters)
    expect(header.totalLiters).toBe(870)
    expect(header.loadCount).toBe(4)
    expect(header.litersPerHour).toBeCloseTo((100 + 400 + 70) / (10 + 40 + 7), 6)
    const byMonth = await getLitersByMonthAndMedium(globalSession(), filters)
    expect(byMonth.reduce((sum, row) => sum + row.liters, 0)).toBe(870)
    const series = await getMeterSeries(globalSession(), filters)
    expect(series.liters_per_hour.totalMeasure).toBe(57)
    expect(series.liters_per_hour.totalLiters).toBe(570)
  })

  it("la comparación de L/h por cargas usa los mismos tramos que la telemetría", async () => {
    const rows = await getLitersPerHourComparison(globalSession(), filtersFor({ meses: "10" }))
    const vA = rows.find((row) => row.vehicleId === IDS.vA)!
    // Sólo cuentan la del 05 y la del 28: (100 + 400) ÷ (10 + 40) = 10 L/h; con todas serían 1.000 ÷ 65.
    expect(vA.loadCount).toBe(2)
    expect(vA.loadsLph).toBeCloseTo(10, 6)
  })
})

describe("TAE", () => {
  it("Cuadratura › Sellos ve TODAS las cargas por punto de suministro, también las del uso personal", async () => {
    // `getTaeGroupedTotals` sólo alimenta Cuadratura › Sellos: es cuadratura, no gestión (anti-objetivo 1).
    const rows = await getTaeGroupedTotals(globalSession(), { from: OCT.from, to: OCT.to }, "loadingPoint")
    expect(rows).toHaveLength(1)
    expect(rows[0]!.liters).toBe(1070)
    expect(rows[0]!.count).toBe(5)
  })
})

describe("ficha del equipo", () => {
  it("lista todas las cargas con su marca, pero los litros de gestión no cuentan las de uso personal", async () => {
    const file = await getEquipmentFile(fileSession(), IDS.vA, OCT)
    expect(file).not.toBeNull()
    const { loads } = file!
    // El registro lo ve todo: cuatro filas, una con la marca.
    expect(loads.rows).toHaveLength(4)
    expect(loads.rows.filter((row) => row.personalUse).map((row) => row.id)).toEqual(["ll-a-12"])
    expect(loads.count).toBe(4)
    expect(loads.liters).toBe(1000)
    // La cifra de gestión no.
    expect(loads.keptCount).toBe(3)
    expect(loads.keptLiters).toBe(800)
    expect(file!.litersByMonth.find((point) => point.month === "2026-10")!.liters).toBe(800)
  })

  it("el rendimiento de la ficha deja fuera las cargas del período y la primera después", async () => {
    const file = await getEquipmentFile(fileSession(), IDS.vA, OCT)
    expect(file!.performance).not.toBeNull()
    expect(file!.performance!.series.map((point) => point.value)).toEqual([10, 10])
  })
})
