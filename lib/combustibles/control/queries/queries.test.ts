import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { parseControlFilters } from "@/lib/combustibles/control/filters"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const overview = await import("./overview")
const performance = await import("./performance")
const detail = await import("./performance-detail")

const globalSession = { user: { id: "u1", isGlobal: true, worksiteIds: [], permissions: [] } } as unknown as Session
const faenaASession = { user: { id: "u2", isGlobal: false, worksiteIds: ["w-a"], permissions: [] } } as unknown as Session
const year2026 = parseControlFilters({ anio: "2026" })

let seq = 0
async function addLoad(input: {
  vehicle: string | null
  worksite: string
  medium?: string | null
  liters: number
  perf?: number | null
  delta?: number | null
  month?: string
  at?: string
  status?: string
  review?: string
  voided?: boolean
  supervisor?: string
}) {
  seq += 1
  const month = input.month ?? "2026-03"
  await testDb.insert(schema.fuelOperationRecords).values({
    id: `rec-${seq}`, batchId: "batch-1", worksiteId: input.worksite, vehicleId: input.vehicle, plate: input.vehicle ?? "SIN", fecha: `${month}-10`, liters: input.liters,
  })
  await testDb.insert(schema.fuelEquipmentLoads).values({
    id: `load-${seq}`,
    source: "operations_import",
    operationRecordId: `rec-${seq}`,
    vehicleId: input.vehicle,
    worksiteId: input.worksite,
    supplyMediumId: input.medium ?? null,
    occurredAt: input.at ?? `${month}-10T15:00:00Z`,
    month,
    liters: input.liters,
    meterDelta: input.delta ?? null,
    accumulatedLiters: input.perf == null ? null : input.liters,
    performanceValue: input.perf ?? null,
    performanceStatus: input.status ?? (input.perf == null ? "first_load" : "computed"),
    reviewStatus: input.review ?? "ok",
    supervisorName: input.supervisor ?? null,
    voidedAt: input.voided ? "2026-03-11T00:00:00Z" : null,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([
    { id: "w-a", name: "Faena A", code: "A" },
    { id: "w-b", name: "Faena B", code: "B" },
  ])
  await testDb.insert(schema.users).values({ id: "u-imp", name: "Importador", email: "imp@q.cl", hashedPassword: "x", isActive: true })
  await testDb.insert(schema.fuelOperationBatches).values({
    id: "batch-1", archivoNombre: "x.xlsx", hashArchivo: "h", periodoDesde: "2026-01-01", periodoHasta: "2026-12-31", importadoPor: "u-imp",
  })
  const types = await testDb.select({ id: schema.fuelEquipmentTypes.id, slug: schema.fuelEquipmentTypes.slug }).from(schema.fuelEquipmentTypes)
  const typeId = (slug: string) => types.find((type) => type.slug === slug)!.id
  const vehicle = (id: string, code: string, worksiteId: string, slug: string, unit: string, brand: string, model: string) => ({
    id, plate: `P-${code}`, code, type: slug, equipmentTypeId: typeId(slug), worksiteId, performanceUnit: unit, meterType: unit === "km_per_liter" ? "odometer" : "hour_meter", brand, model,
  })
  await testDb.insert(schema.fuelVehicles).values([
    vehicle("v1", "KA-01", "w-a", "camion", "km_per_liter", "Volvo", "FH"),
    vehicle("v2", "KA-02", "w-a", "camion", "km_per_liter", "Volvo", "FH"),
    vehicle("v3", "KA-03", "w-b", "camion", "km_per_liter", "Scania", "R"),
    vehicle("v4", "EX-01", "w-a", "excavadora", "liters_per_hour", "Cat", "320"),
  ])

  // v1: tres cargas válidas (3, 4, 5 km/L), una en revisión, una rechazada y una anulada.
  await addLoad({ vehicle: "v1", worksite: "w-a", medium: "fsm-tct", liters: 10, perf: 3, delta: 30, supervisor: "Sup Uno" })
  await addLoad({ vehicle: "v1", worksite: "w-a", medium: "fsm-tct", liters: 10, perf: 4, delta: 40 })
  await addLoad({ vehicle: "v1", worksite: "w-a", medium: "fsm-tct", liters: 10, perf: 5, delta: 50 })
  await addLoad({ vehicle: "v1", worksite: "w-a", medium: "fsm-tae", liters: 10, perf: 9, delta: 90, review: "flagged" })
  await addLoad({ vehicle: "v1", worksite: "w-a", medium: "fsm-tct", liters: 100, perf: 7, delta: 700, review: "rejected" })
  await addLoad({ vehicle: "v1", worksite: "w-a", medium: "fsm-tct", liters: 50, perf: 5, delta: 250, voided: true })
  // Histórico de v1: el año anterior, fuera del filtro 2026 pero dentro de los 12 meses previos a marzo.
  await addLoad({ vehicle: "v1", worksite: "w-a", medium: "fsm-tct", liters: 10, perf: 6, delta: 60, month: "2025-06" })
  // v2: mismo modelo que v1.
  await addLoad({ vehicle: "v2", worksite: "w-a", medium: "fsm-tct", liters: 20, perf: 5, delta: 100 })
  await addLoad({ vehicle: "v2", worksite: "w-a", medium: "fsm-tct", liters: 20, perf: 5, delta: 100 })
  await addLoad({ vehicle: "v2", worksite: "w-a", medium: "fsm-tae", liters: 10, perf: 5, delta: 50, month: "2026-05" })
  // v3: una sola carga válida, sin medio informado, otra faena.
  await addLoad({ vehicle: "v3", worksite: "w-b", medium: null, liters: 15, perf: 2, delta: 30 })
  // v4: horómetro (L/h).
  await addLoad({ vehicle: "v4", worksite: "w-a", medium: "fsm-cmpc", liters: 100, perf: 20, delta: 5 })
  await addLoad({ vehicle: "v4", worksite: "w-a", medium: "fsm-cmpc", liters: 132, perf: 22, delta: 6 })
  // Carga sin ficha de equipo: suma litros, no entra a ninguna razón.
  await addLoad({ vehicle: null, worksite: "w-a", medium: "fsm-tct", liters: 3 })
}, 120_000)

describe("vista general", () => {
  it("cabecera: litros contables, razones globales y cargas en revisión", async () => {
    const header = await overview.getOverviewHeader(globalSession, year2026)
    // No cuentan la rechazada (100) ni la anulada (50) ni la de 2025 (10).
    expect(header.totalLiters).toBe(30 + 10 + 20 + 20 + 10 + 15 + 232 + 3)
    // km/L = Σkm ÷ Σlitros de los tramos válidos (3, 4, 5 de v1; v2 ×3; v3). La de revisión (9) no entra.
    expect(header.kmPerLiter).toBeCloseTo((30 + 40 + 50 + 100 + 100 + 50 + 30) / (10 + 10 + 10 + 20 + 20 + 10 + 15), 6)
    expect(header.litersPerHour).toBeCloseTo(232 / 11, 6)
    expect(header.flaggedCount).toBe(1)
    expect(header.excludedKm).toBe(1)
    expect(header.excludedHours).toBe(0)
  })

  it("el alcance de faena recorta litros y razones", async () => {
    const header = await overview.getOverviewHeader(faenaASession, year2026)
    expect(header.totalLiters).toBe(30 + 10 + 20 + 20 + 10 + 232 + 3)
    expect(header.kmPerLiter).toBeCloseTo((30 + 40 + 50 + 100 + 100 + 50) / (10 + 10 + 10 + 20 + 20 + 10), 6)
  })

  it("una faena fuera del alcance devuelve cero filas, no las de esa faena", async () => {
    const header = await overview.getOverviewHeader(faenaASession, parseControlFilters({ anio: "2026", faena: "w-b" }))
    expect(header.totalLiters).toBe(0)
    expect(header.kmPerLiter).toBeNull()
  })

  it("litros por mes y medio, con «sin medio» como medio nulo", async () => {
    const rows = await overview.getLitersByMonthAndMedium(globalSession, year2026)
    const get = (month: string, mediumId: string | null) => rows.find((row) => row.month === month && row.mediumId === mediumId)?.liters
    expect(get("2026-03", "fsm-tct")).toBe(30 + 20 + 20 + 3)
    expect(get("2026-03", "fsm-tae")).toBe(10)
    expect(get("2026-03", null)).toBe(15)
    expect(get("2026-03", "fsm-cmpc")).toBe(232)
    expect(get("2026-05", "fsm-tae")).toBe(10)
    expect(rows.some((row) => row.month === "2025-06")).toBe(false)
  })

  it("tabla cruzada km/L: totales de fila, columna y general cuadran, y las faenas vienen por total descendente", async () => {
    const crosstab = await overview.getWorksiteMediumCrosstab(globalSession, year2026, "km_per_liter")
    expect(crosstab.rows.map((row) => row.worksiteName)).toEqual(["Faena A", "Faena B"])
    expect(crosstab.rows[0]).toMatchObject({ total: 30 + 10 + 40 + 10 })
    expect(crosstab.rows[0]!.cells["fsm-tct"]).toBe(70)
    expect(crosstab.rows[1]!.cells["_none"]).toBe(15)
    expect(crosstab.grandTotal).toBe(105)
    expect(Object.values(crosstab.columnTotals).reduce((sum, value) => sum + value, 0)).toBe(crosstab.grandTotal)
    // El equipo sin ficha y las horas no entran en la tabla de km/L.
    expect(crosstab.columns.map((column) => column.key)).toEqual(["fsm-tct", "fsm-tae", "_none"])
  })

  it("tabla cruzada L/h solo trae equipos de horómetro", async () => {
    const crosstab = await overview.getWorksiteMediumCrosstab(globalSession, year2026, "liters_per_hour")
    expect(crosstab.grandTotal).toBe(232)
    expect(crosstab.columns).toEqual([{ key: "fsm-cmpc", label: "Surtidor CMPC" }])
  })

  it("serie mensual: razón de sumas por unidad, sin mezclar km con horas", async () => {
    const series = await overview.getMeterSeries(globalSession, year2026)
    expect(series.km_per_liter.points.map((point) => point.month)).toEqual(["2026-03", "2026-05"])
    expect(series.km_per_liter.points[0]).toMatchObject({ measure: 30 + 40 + 50 + 100 + 100 + 30, liters: 10 + 10 + 10 + 20 + 20 + 15, segments: 6 })
    expect(series.km_per_liter.ratio).toBeCloseTo(400 / 95, 6)
    expect(series.liters_per_hour.totalMeasure).toBe(11)
    expect(series.liters_per_hour.ratio).toBeCloseTo(232 / 11, 6)
  })
})

describe("rendimiento por familia", () => {
  const camiones = parseControlFilters({ anio: "2026" }, { family: "camiones" })

  it("por faena: promedio y desviación muestral en SQL, σ nula con n = 1", async () => {
    const rows = await performance.getWorksiteStats(globalSession, camiones)
    const a = rows.find((row) => row.worksiteId === "w-a")!
    const b = rows.find((row) => row.worksiteId === "w-b")!
    expect(rows.every((row) => row.unit === "km_per_liter")).toBe(true)
    expect(a.n).toBe(6)
    expect(a.mean).toBeCloseTo(4.5, 6)
    expect(a.sd).toBeCloseTo(Math.sqrt(3.5 / 5), 6)
    expect(a.cv).toBeCloseTo(a.sd! / 4.5, 6)
    expect(b).toMatchObject({ n: 1, mean: 2, sd: null, cv: null })
  })

  it("la familia acota los equipos: maquinaria solo trae L/h", async () => {
    const rows = await performance.getWorksiteStats(globalSession, parseControlFilters({ anio: "2026" }, { family: "maquinaria" }))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ unit: "liters_per_hour", n: 2, mean: 21 })
    expect(rows[0]!.sd).toBeCloseTo(Math.SQRT2, 6)
  })

  it("cuenta las cargas en revisión que no entran al promedio", async () => {
    expect(await performance.getReviewExclusions(globalSession, camiones)).toEqual({ km_per_liter: 1, liters_per_hour: 0 })
  })

  it("por equipo: promedio del modelo (sin el propio equipo) y su histórico de 12 meses", async () => {
    const { rows, pagination } = await performance.getEquipmentStats(globalSession, parseControlFilters({ anio: "2026", meses: "3" }, { family: "camiones" }))
    expect(pagination.totalItems).toBe(3)
    expect(rows.map((row) => row.code)).toEqual(["KA-01", "KA-02", "KA-03"])
    const [v1, v2, v3] = rows
    expect(v1).toMatchObject({ n: 3, mean: 4, sd: 1, modelMean: 5, historyMean: 6, equipmentType: "Camión", worksiteName: "Faena A" })
    expect(v1!.deltaModelPct).toBeCloseTo(-20, 6)
    expect(v1!.deltaHistoryPct).toBeCloseTo(-100 / 3, 6)
    expect(v1!.worseThanModel).toBe(true)
    expect(v1!.worseThanHistory).toBe(true)
    // KA-02 compara contra KA-01 (media 4): rinde mejor que el modelo, no peor.
    expect(v2).toMatchObject({ n: 2, mean: 5, sd: 0, modelMean: 4, historyMean: null })
    expect(v2!.worseThanModel).toBe(false)
    // Sin otro equipo de su modelo no hay comparación.
    expect(v3).toMatchObject({ n: 1, sd: null, modelMean: null, deltaModelPct: null })
  })

  it("filtrar por equipo acota la lista, no el promedio del modelo", async () => {
    const { rows } = await performance.getEquipmentStats(globalSession, parseControlFilters({ anio: "2026", meses: "3", equipo: "ka-02" }, { family: "camiones" }))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ code: "KA-02", modelMean: 4 })
  })

  it("pagina en SQL", async () => {
    const second = await performance.getEquipmentStats(globalSession, camiones, { page: 2, pageSize: 2 })
    expect(second.pagination).toMatchObject({ page: 2, totalPages: 2, totalItems: 3 })
    expect(second.rows.map((row) => row.code)).toEqual(["KA-03"])
  })

  it("el alcance de faena oculta equipos de otras faenas", async () => {
    const { rows } = await performance.getEquipmentStats(faenaASession, camiones)
    expect(rows.map((row) => row.code)).toEqual(["KA-01", "KA-02"])
  })

  it("detalle: incluye rechazadas y en revisión, excluye anuladas, y el supervisor sale solo con permiso", async () => {
    const masked = await detail.getLoadDetail(globalSession, camiones, { includePersonal: false })
    expect(masked.pagination.totalItems).toBe(5 + 3 + 1)
    expect(masked.rows.every((row) => row.supervisor === null)).toBe(true)
    expect(masked.rows.map((row) => row.reviewStatus)).toContain("rejected")
    expect(masked.rows.some((row) => row.liters === 50)).toBe(false)
    const withPersonal = await detail.getLoadDetail(globalSession, camiones, { includePersonal: true })
    expect(withPersonal.rows.find((row) => row.supervisor)?.supervisor).toBe("Sup Uno")
  })

  it("opciones de equipo: solo la familia y el alcance del usuario", async () => {
    expect((await detail.getFamilyVehicleOptions(faenaASession, "camiones")).map((option) => option.code)).toEqual(["KA-01", "KA-02"])
    expect((await detail.getFamilyVehicleOptions(globalSession, "maquinaria")).map((option) => option.code)).toEqual(["EX-01"])
  })

  it("las cargas válidas de un equipo recién aprobado entran al promedio", async () => {
    await testDb.update(schema.fuelEquipmentLoads).set({ reviewStatus: "approved" }).where(eq(schema.fuelEquipmentLoads.reviewStatus, "flagged"))
    const { rows } = await performance.getEquipmentStats(globalSession, parseControlFilters({ anio: "2026", meses: "3" }, { family: "camiones" }))
    expect(rows[0]).toMatchObject({ code: "KA-01", n: 4 })
    expect(rows[0]!.mean).toBeCloseTo(21 / 4, 6)
    expect(await performance.getReviewExclusions(globalSession, camiones)).toEqual({ km_per_liter: 0, liters_per_hour: 0 })
  })
})
