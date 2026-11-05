/**
 * Consultas del control de combustible contra un Postgres real (PGlite con todas
 * las migraciones). Cubre el carril D de la corrección de la auditoría
 * 2026-11-05 (`qa/reports/2026-11-05-auditoria-combustibles-codigo.md`):
 *
 * - D1 · el mes del proveedor y de las lecturas de medidor se lee en hora de
 *   Chile: una transacción del 31-mar 22:10 de Chile (`2026-04-01T01:10Z`) es de
 *   marzo, y no inventa abril en `monthsWithReadings`.
 * - D2 · la serie agrupa y rotula con la unidad con que se calculó cada carga:
 *   un equipo cambiado de km/L a L/h no mezcla 4,2 con litros por hora.
 * - D3 · el L/h de las cargas es Σlitros ÷ Σhoras (8,2), no el promedio de las
 *   razones (22,5).
 * - D4 · el filtro `equipo` es igualdad en todas las consultas: `KA-1` no trae
 *   `KA-10`.
 * - D5 · una cookie de período malformada no rompe la página.
 * - D6 · sin desviación (o con menos de dos muestras) no hay rango normal.
 * - D7 · «declarado en planilla» usa la unidad que declaró la fila.
 * - D8 · «rinde peor» respeta el filtro de equipo y no cuenta equipos con una
 *   sola carga válida.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { parseControlFilters } from "@/lib/combustibles/control/filters"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB; __cookie?: string | null }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))
// `period/server.ts` lee la cookie del request: la prueba controla su valor.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (g.__cookie ? { name, value: g.__cookie } : undefined) }),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const reconciliation = await import("@/lib/combustibles/control/queries/reconciliation")
const performance = await import("@/lib/combustibles/control/queries/performance")
const overview = await import("@/lib/combustibles/control/queries/overview")
const detail = await import("@/lib/combustibles/control/queries/performance-detail")
const idleComparison = await import("@/lib/combustibles/control/queries/idle-comparison")
const meterRates = await import("@/lib/combustibles/control/queries/meter-rates")
const normalRange = await import("@/lib/combustibles/equipment/normal-range")
const periodServer = await import("@/lib/combustibles/period/server")
const { chileMonthOf } = await import("@/lib/combustibles/meter-rate-series")

/* ── Sesiones y filtros ──────────────────────────────────────────────────── */

function session(worksiteIds: string[] = []): Session {
  return { user: { id: "u-carril-d", isGlobal: worksiteIds.length === 0, worksiteIds, permissions: [], roles: [] }, expires: "2099-01-01" } as unknown as Session
}
const globalSession = () => session()
/** Año 2026 (el de las pruebas) con los meses indicados. */
const filters = (params: Record<string, string> = {}) => parseControlFilters({ anio: "2026", ...params })

/* ── Faenas, catálogo y equipos ──────────────────────────────────────────── */

const W = { perf: "w-d-perf", idle: "w-d-idle", rec: "w-d-rec", mr: "w-d-mr" } as const

const V = {
  ka1: "v-d-ka1", ka10: "v-d-ka10", ka2: "v-d-ka2", ka20: "v-d-ka20",
  sw: "v-d-sw", ex: "v-d-ex", mr: "v-d-mr",
} as const

let counter = 0

interface LoadSpec {
  vehicleId: string
  worksiteId: string
  /** Instante de la carga (`occurred_at`, timestamptz). */
  at?: string
  /** Mes «YYYY-MM»; por omisión, el de `at`. */
  month?: string
  liters?: number
  /** Unidad con la que se calculó el rendimiento (columna de la carga). */
  unit?: "km_per_liter" | "liters_per_hour" | null
  value?: number | null
  meterDelta?: number | null
  accLiters?: number | null
  status?: "computed" | "first_load"
  review?: "ok" | "flagged" | "approved"
  /** Unidad que declaró la planilla de origen (`fuel_operation_records.tipo_rendimiento`). */
  tipoRendimiento?: "km_lt" | "lt_hr" | null
  declared?: number | null
}

function loadRow(spec: LoadSpec): typeof schema.fuelEquipmentLoads.$inferInsert {
  counter += 1
  return {
    id: `load-d-${counter}`,
    source: "operations_import",
    operationRecordId: `rec-d-${counter}`,
    vehicleId: spec.vehicleId,
    worksiteId: spec.worksiteId,
    occurredAt: spec.at ?? "2026-03-10T15:00:00.000Z",
    month: spec.month ?? (spec.at ?? "2026-03-10T15:00:00.000Z").slice(0, 7),
    liters: spec.liters ?? 10,
    performanceUnit: spec.unit === undefined ? "km_per_liter" : spec.unit,
    performanceValue: spec.value === undefined ? null : spec.value,
    performanceStatus: spec.status ?? (spec.value === undefined || spec.value === null ? "first_load" : "computed"),
    reviewStatus: spec.review ?? "ok",
    meterDelta: spec.meterDelta ?? null,
    accumulatedLiters: spec.accLiters ?? null,
    declaredPerformance: spec.declared ?? null,
  }
}

function recordRow(spec: LoadSpec, loadId: string): typeof schema.fuelOperationRecords.$inferInsert {
  return {
    id: loadId,
    batchId: "batch-d",
    worksiteId: spec.worksiteId,
    vehicleId: spec.vehicleId,
    plate: `P-${spec.vehicleId}`,
    fecha: (spec.at ?? "2026-03-10T15:00:00.000Z").slice(0, 10),
    liters: spec.liters ?? 10,
    tipoRendimiento: spec.tipoRendimiento ?? null,
  }
}

/** Inserta un lote de cargas con su registro de planilla (el origen real de `operations_import`). */
async function addLoads(specs: LoadSpec[]): Promise<void> {
  const loads = specs.map(loadRow)
  const records = specs.map((spec, index) => recordRow(spec, loads[index]!.operationRecordId!))
  await testDb.insert(schema.fuelOperationRecords).values(records)
  await testDb.insert(schema.fuelEquipmentLoads).values(loads)
}

beforeAll(async () => {
  await testDb.insert(schema.users).values({ id: "u-carril-d", name: "Carril D", email: "carril-d@example.cl", hashedPassword: "x", isActive: true })
  await testDb.insert(schema.worksites).values([
    { id: W.perf, name: "Faena Rendimiento", code: "D-PERF" },
    { id: W.idle, name: "Faena Ralentí", code: "D-IDLE" },
    { id: W.rec, name: "Faena Conciliación", code: "D-REC" },
    { id: W.mr, name: "Faena Medidor", code: "D-MR" },
  ])
  await testDb.insert(schema.fuelProducts).values({ id: "prod-d-ctl", code: "diesel-carril-d", name: "Diésel", category: "diesel" })
  await testDb.insert(schema.fuelEquipmentTypes).values([
    { id: "type-d-truck", slug: "camion-d", name: "Camión", performanceFamily: "camiones" },
    { id: "type-d-machine", slug: "maquina-d", name: "Excavadora", performanceFamily: "maquinaria" },
  ])
  const vehicle = (id: string, code: string, typeId: string, worksiteId: string, unit: "km_per_liter" | "liters_per_hour", brand: string, model: string) => ({
    id, plate: `P-${code}`, code, type: "x", equipmentTypeId: typeId, worksiteId, performanceUnit: unit,
    meterType: unit === "km_per_liter" ? "odometer" : "hour_meter", brand, model,
  })
  await testDb.insert(schema.fuelVehicles).values([
    // KA-1 y KA-10: el filtro `equipo` no puede confundirlos (D4).
    vehicle(V.ka1, "KA-1", "type-d-truck", W.perf, "km_per_liter", "Volvo", "FH"),
    vehicle(V.ka10, "KA-10", "type-d-truck", W.perf, "km_per_liter", "Volvo", "FH"),
    // Mismo modelo, muestras distintas: KA-2 con dos cargas y KA-20 con una (D8).
    vehicle(V.ka2, "KA-2", "type-d-truck", W.perf, "km_per_liter", "Scania", "R"),
    vehicle(V.ka20, "KA-20", "type-d-truck", W.perf, "km_per_liter", "Scania", "R"),
    // SW-1 se corrigió de km/L a L/h: sus cargas viejas siguen siendo km/L (D2).
    vehicle(V.sw, "SW-1", "type-d-machine", W.perf, "liters_per_hour", "Komatsu", "PC200"),
    vehicle(V.ex, "EX-1", "type-d-machine", W.idle, "liters_per_hour", "Cat", "320"),
    vehicle(V.mr, "MR-1", "type-d-truck", W.mr, "km_per_liter", "Volvo", "FH"),
  ])
  await testDb.insert(schema.fuelOperationBatches).values({
    id: "batch-d", archivoNombre: "carril-d.xlsx", hashArchivo: "hash-carril-d", periodoDesde: "2026-03-01", periodoHasta: "2026-03-31", importadoPor: "u-carril-d",
  })

  await addLoads([
    /* D4: KA-1 y KA-10, un mes, una carga cada uno. */
    { vehicleId: V.ka1, worksiteId: W.perf, liters: 20, unit: "km_per_liter", value: 4, meterDelta: 80, accLiters: 20 },
    { vehicleId: V.ka10, worksiteId: W.perf, liters: 30, unit: "km_per_liter", value: 6, meterDelta: 180, accLiters: 30 },
    /* D7: la planilla declara L/h en un equipo km/L, y km/L en el mismo equipo. */
    { vehicleId: V.ka1, worksiteId: W.perf, at: "2026-03-11T15:00:00.000Z", liters: 20, unit: "km_per_liter", value: 5, meterDelta: 100, accLiters: 20, tipoRendimiento: "lt_hr", declared: 12 },
    { vehicleId: V.ka1, worksiteId: W.perf, at: "2026-03-12T15:00:00.000Z", liters: 20, unit: "km_per_liter", value: 6, meterDelta: 120, accLiters: 20, tipoRendimiento: "km_lt", declared: 9.5 },
    /* D8: KA-2 con dos cargas (3 y 5 km/L) y KA-20 con una sola (10 km/L). */
    { vehicleId: V.ka2, worksiteId: W.perf, at: "2026-03-05T15:00:00.000Z", liters: 10, unit: "km_per_liter", value: 3, meterDelta: 30, accLiters: 10 },
    { vehicleId: V.ka2, worksiteId: W.perf, at: "2026-03-06T15:00:00.000Z", liters: 10, unit: "km_per_liter", value: 5, meterDelta: 50, accLiters: 10 },
    { vehicleId: V.ka20, worksiteId: W.perf, at: "2026-03-07T15:00:00.000Z", liters: 10, unit: "km_per_liter", value: 10, meterDelta: 100, accLiters: 10 },
    /* D2: SW-1 tiene dos cargas calculadas en km/L (antes del cambio de unidad) y dos en L/h (después). */
    { vehicleId: V.sw, worksiteId: W.perf, at: "2026-03-02T15:00:00.000Z", liters: 20, unit: "km_per_liter", value: 10, meterDelta: 200, accLiters: 20 },
    { vehicleId: V.sw, worksiteId: W.perf, at: "2026-03-03T15:00:00.000Z", liters: 20, unit: "km_per_liter", value: 12, meterDelta: 240, accLiters: 20 },
    { vehicleId: V.sw, worksiteId: W.perf, at: "2026-03-04T15:00:00.000Z", liters: 40, unit: "liters_per_hour", value: 20, meterDelta: 2, accLiters: 40 },
    { vehicleId: V.sw, worksiteId: W.perf, at: "2026-03-05T15:00:00.000Z", liters: 44, unit: "liters_per_hour", value: 22, meterDelta: 2, accLiters: 44 },
    /* D3: 50 L en 10 h y 40 L en 1 h: Σ 90 L ÷ Σ 11 h = 8,2 L/h (el promedio de razones daría 22,5). */
    { vehicleId: V.ex, worksiteId: W.idle, at: "2026-03-10T15:00:00.000Z", liters: 50, unit: "liters_per_hour", value: 5, meterDelta: 10, accLiters: 50 },
    { vehicleId: V.ex, worksiteId: W.idle, at: "2026-03-11T15:00:00.000Z", liters: 40, unit: "liters_per_hour", value: 40, meterDelta: 1, accLiters: 40 },
  ])

  /* D3: telemetría del mismo equipo y mes, con la misma razón de sumas (90 L en 11 h). */
  await testDb.insert(schema.fuelTelemetryDaily).values({
    id: "tel-d-1", vehicleId: V.ex, source: "visionlink", day: "2026-03-10", month: "2026-03",
    operatingHours: 11, idleHours: 0, litersWorking: 90, litersIdle: 0,
  })

  /* D1: libro del proveedor. 2026-04-01T01:10Z son las 22:10 del 31 de marzo en Chile. */
  await testDb.insert(schema.fuelProviderSyncRuns).values({
    id: "run-d", provider: "copec", requestedFrom: "2026-03-01", requestedTo: "2026-04-30", correlationId: "corr-carril-d",
  })
  // El medio TCT ya viene del catálogo de la migración 0359 (`fsm-tct`, copec/TCT).
  const providerTx = (id: string, at: string, quantity: number): typeof schema.fuelProviderTransactions.$inferInsert => ({
    id, syncRunId: "run-d", provider: "copec", sourceAccount: "tct:diesel", identityKey: id, fingerprint: `fp-${id}`,
    sourceRowKey: id, worksiteId: W.rec, occurredAt: at, quantity, status: "accepted", granularity: "transaction", payloadHash: `ph-${id}`,
  })
  await testDb.insert(schema.fuelProviderTransactions).values([
    providerTx("ptx-mar", "2026-04-01T01:10:00.000Z", 100),
    providerTx("ptx-apr", "2026-04-01T15:00:00.000Z", 50),
  ])
  /* Entregas de terreno con el mismo corte: 2026-04-01T02:00Z son las 23:00 del 31 de marzo en Chile. */
  const submission = (id: string, at: string, liters: number): typeof schema.fuelTaeSubmissions.$inferInsert => ({
    id, clientSubmissionId: `client-${id}`, publicResultToken: `token-${id}`, worksiteId: W.rec, vehicleId: V.mr, productId: "prod-d-ctl",
    equipmentCodeSnapshot: "MR-1", plateSnapshot: "P-MR-1", loadedAt: at, submittedAt: at, driverNameSnapshot: "Conductor",
    supervisorNameSnapshot: "Supervisor", meterType: "odometer", liters,
  })
  await testDb.insert(schema.fuelTaeSubmissions).values([
    submission("sub-d-mar", "2026-04-01T02:00:00.000Z", 30),
    submission("sub-d-apr", "2026-04-02T15:00:00.000Z", 20),
  ])

  /* D1: lecturas de medidor de Copec. La del 31-mar 22:10 de Chile llega como 2026-04-01T01:10Z. */
  const reading = (id: string, at: string, value: number): typeof schema.fuelMeterReadings.$inferInsert => ({
    id, vehicleId: V.mr, plate: "P-MR-1", source: "copec_tct", sourceRef: id, occurredAt: at, meterType: "odometer", value, liters: 40,
  })
  await testDb.insert(schema.fuelMeterReadings).values([
    reading("mr-d-base", "2026-02-25T15:00:00.000Z", 10_000),
    reading("mr-d-mar", "2026-03-05T15:00:00.000Z", 10_100),
    reading("mr-d-mar20", "2026-03-20T15:00:00.000Z", 10_200),
    reading("mr-d-edge", "2026-04-01T01:10:00.000Z", 10_300),
  ])
}, 120_000)

/* ── D1 · el mes del proveedor y de las lecturas, en hora de Chile ────────── */

describe("D1 · calendario chileno en el texto UTC", () => {
  it("una transacción del 31-mar 22:10 de Chile cuenta en marzo, no en abril", async () => {
    const flow = await reconciliation.getReconciliationFlow(globalSession(), filters({ faena: W.rec }), null)

    const march = flow.months.find((row) => row.month === "2026-03")!
    const april = flow.months.find((row) => row.month === "2026-04")!
    // Marzo: los 100 L del proveedor (texto UTC de abril) y la entrega de las 23:00 del 31.
    expect(march).toMatchObject({ inputLiters: 100, directLiters: 30 })
    // Abril: sólo lo que de verdad ocurrió el 1 de abril en Chile.
    expect(april).toMatchObject({ inputLiters: 50, directLiters: 20 })
    expect(flow.months.map((row) => row.month)).toEqual(["2026-03", "2026-04"])
  })

  it("el período del libro del proveedor se filtra por el mismo calendario (mes y rango de días)", async () => {
    const march = await reconciliation.getReconciliationFlow(globalSession(), filters({ faena: W.rec, meses: "3" }), null)
    expect(march.totals.inputLiters).toBe(100)

    const april = await reconciliation.getReconciliationFlow(globalSession(), filters({ faena: W.rec, meses: "4" }), null)
    expect(april.totals.inputLiters).toBe(50)

    // Rango de días: el 31 de marzo incluye la transacción de las 22:10 de Chile.
    const day = await reconciliation.getReconciliationFlow(globalSession(), filters({ faena: W.rec, desde: "2026-03-31", hasta: "2026-03-31" }), null)
    expect(day.totals.inputLiters).toBe(100)
  })

  it("una lectura del 31-mar 22:10 de Chile es de marzo y abril sigue siendo un hueco", async () => {
    const series = await meterRates.getMeterRateSeries(globalSession(), { worksiteId: W.mr }, {
      monthKeys: ["2026-03", "2026-04"], to: "2026-04-30", today: "2026-06-30",
    })

    const [march, april] = series.km_per_liter.months
    // Tres tramos de marzo: febrero → 5-mar, 5-mar → 20-mar y 20-mar → 31-mar (la lectura de las 22:10 de Chile).
    expect(march).toMatchObject({ month: "2026-03", segments: 3, measure: 300, liters: 120, status: "ok" })
    expect(march!.rate).toBeCloseTo(2.5, 10)
    // Abril no tiene lecturas: el proveedor no trajo nada y no se inventa con la lectura de fin de marzo.
    expect(april).toMatchObject({ month: "2026-04", segments: 0, status: "gap", rate: null })
    expect(series.km_per_liter.readings).toBe(3)
  })

  it("el mes civil chileno de un instante se lee sin depender de la zona del proceso", () => {
    expect(chileMonthOf("2026-04-01T01:10:00.000Z")).toBe("2026-03")
    expect(chileMonthOf("2026-04-01T15:00:00.000Z")).toBe("2026-04")
    expect(chileMonthOf("2026-03-01")).toBe("2026-03")
  })
})

/* ── D2 · la unidad de la serie es la del cálculo ────────────────────────── */

describe("D2 · la serie no mezcla km/L con L/h", () => {
  it("agrupa y rotula por la unidad calculada de la carga, no por la que el equipo tiene hoy", async () => {
    const rows = await performance.getWorksiteStats(globalSession(), filters({ faena: W.perf, meses: "3", equipo: "SW-1" }))

    const km = rows.find((row) => row.unit === "km_per_liter")!
    const hours = rows.find((row) => row.unit === "liters_per_hour")!
    expect(km).toMatchObject({ n: 2, mean: 11 })
    expect(hours).toMatchObject({ n: 2, mean: 21 })
  })

  it("la serie mensual separa los tramos viejos en km/L de los nuevos en L/h", async () => {
    const series = await overview.getMeterSeries(globalSession(), filters({ faena: W.perf, meses: "3", equipo: "SW-1" }))

    expect(series.km_per_liter.points).toEqual([{ month: "2026-03", measure: 440, liters: 40, segments: 2 }])
    expect(series.liters_per_hour.points).toEqual([{ month: "2026-03", measure: 4, liters: 84, segments: 2 }])
    expect(series.km_per_liter.ratio).toBeCloseTo(11, 10)
    expect(series.liters_per_hour.ratio).toBeCloseTo(21, 10)
  })

  it("el detalle de cargas rotula cada fila con su unidad calculada", async () => {
    const page = await detail.getLoadDetail(session(), filters({ faena: W.perf, meses: "3", equipo: "SW-1" }), { includePersonal: false })

    expect(page.rows.map((row) => row.unit).sort()).toEqual(["km_per_liter", "km_per_liter", "liters_per_hour", "liters_per_hour"])
  })
})

/* ── D3 · L/h de las cargas: razón de sumas ──────────────────────────────── */

describe("D3 · L/h desde las cargas", () => {
  it("50 L en 10 h y 40 L en 1 h dan 8,2 L/h, no el promedio de las razones (22,5)", async () => {
    const rows = await idleComparison.getLitersPerHourComparison(globalSession(), filters({ faena: W.idle, meses: "3" }))
    const march = rows.find((row) => row.month === "2026-03")!

    expect(march.loadCount).toBe(2)
    expect(march.loadsLph).toBeCloseTo(90 / 11, 10)
    expect(march.loadsLph).not.toBeCloseTo(22.5, 1)
    // La telemetría del mismo mes informa la misma razón: 90 L en 11 h.
    expect(march.telemetryLph).toBeCloseTo(90 / 11, 10)
    expect(march.differencePct).toBeCloseTo(0, 10)
  })
})

/* ── D4 · el filtro `equipo` es igualdad en todas las consultas ──────────── */

describe("D4 · filtro equipo consistente", () => {
  it("`KA-1` no arrastra `KA-10` ni en la lista por equipo ni en el detalle", async () => {
    const stats = await performance.getEquipmentStats(globalSession(), filters({ faena: W.perf, meses: "3", equipo: "KA-1" }))
    expect(stats.rows.map((row) => row.code)).toEqual(["KA-1"])

    const page = await detail.getLoadDetail(session(), filters({ faena: W.perf, meses: "3", equipo: "KA-1" }), { includePersonal: false, all: true })
    expect(new Set(page.rows.map((row) => row.code))).toEqual(new Set(["KA-1"]))
    expect(page.rows.length).toBe(3)
  })

  it("`KA-10` sigue encontrando su propio equipo", async () => {
    const stats = await performance.getEquipmentStats(globalSession(), filters({ faena: W.perf, meses: "3", equipo: "KA-10" }))

    expect(stats.rows.map((row) => row.code)).toEqual(["KA-10"])
  })
})

/* ── D5 · cookie de período malformada ───────────────────────────────────── */

describe("D5 · cookie de período malformada", () => {
  it("`%E0%A4%A` no rompe la página: el período cae al valor por rol", async () => {
    g.__cookie = "%E0%A4%A"
    const resolved = await periodServer.resolveFuelPeriodForPage(globalSession(), {})
    expect(resolved.source).toBe("default")

    // Una cookie válida sigue mandando.
    g.__cookie = encodeURIComponent("2026-03")
    const fromCookie = await periodServer.resolveFuelPeriodForPage(globalSession(), {})
    expect(fromCookie).toMatchObject({ source: "cookie", from: "2026-03-01", to: "2026-03-31" })
    g.__cookie = null
  })

  it("el decodificador devuelve null en vez de lanzar", () => {
    expect(periodServer.decodeFuelPeriodCookieValue("%E0%A4%A")).toBeNull()
    expect(periodServer.decodeFuelPeriodCookieValue("2026-03")).toBe("2026-03")
    expect(periodServer.decodeFuelPeriodCookieValue(null)).toBeNull()
  })
})

/* ── D6 · rango normal sin desviación ────────────────────────────────────── */

describe("D6 · rango normal del equipo", () => {
  it("con desviación cero no hay rango ni, por lo tanto, puntos fuera de rango", () => {
    // El caso de la ficha: cinco cargas en 10,0 exactos. La franja sería el punto 10,0
    // y la siguiente carga en 10,5 saldría «fuera de rango» mientras el control la deja `ok`.
    expect(normalRange.computeNormalRange([10, 10, 10, 10, 10], 2, 2)).toBeNull()
    expect(normalRange.computeNormalRange([10, 10, 10], 2, 2)).toBeNull()
  })

  it("con menos de dos muestras tampoco hay rango", () => {
    expect(normalRange.computeNormalRange([10], 2, 1)).toBeNull()
    expect(normalRange.computeNormalRange([], 2, 2)).toBeNull()
  })

  it("con dispersión real el rango se calcula y marca lo que se sale", () => {
    const range = normalRange.computeNormalRange([10, 12, 14], 2, 2)!
    expect(range).toMatchObject({ mean: 12, sd: 2, low: 8, high: 16, samples: 3 })
    expect(normalRange.isOutOfRange("km_per_liter", 7, range)).toBe(true)
    expect(normalRange.isOutOfRange("km_per_liter", 9, range)).toBe(false)
  })
})

/* ── D7 · «declarado en planilla» usa la unidad de la fila ───────────────── */

describe("D7 · unidad del rendimiento declarado", () => {
  it("una fila `lt_hr` en un equipo km/L no se rotula como km/L", async () => {
    const page = await detail.getLoadDetail(session(), filters({ faena: W.perf, meses: "3", equipo: "KA-1" }), { includePersonal: false, all: true })

    const declaredHours = page.rows.find((row) => row.declaredUnit === "liters_per_hour")!
    expect(declaredHours.unit).toBe("km_per_liter")
    // El contraste no se muestra con la unidad equivocada: el número queda fuera y se conserva su unidad.
    expect(declaredHours.declaredPerformance).toBeNull()

    const declaredKm = page.rows.find((row) => row.declaredUnit === "km_per_liter")!
    expect(declaredKm.declaredPerformance).toBe(9.5)
    expect(declaredKm.unit).toBe("km_per_liter")
  })
})

/* ── D8 · «rinde peor» respeta filtros y muestra mínima ──────────────────── */

describe("D8 · «rinde peor»", () => {
  it("con `equipo=KA-2` el conteo es el de la tabla, no el de todo el alcance", async () => {
    const summary = await performance.getEquipmentWorseSummary(globalSession(), filters({ faena: W.perf, meses: "3", equipo: "KA-2" }))

    expect(summary.total).toBe(1)
    // KA-2 (4 km/L) rinde 60 % por debajo del modelo (10 km/L).
    expect(summary.worse).toBe(1)
    expect(summary.examples.map((example) => example.code)).toEqual(["KA-2"])
  })

  it("un equipo con una sola carga no se declara peor", async () => {
    // KA-20 tiene una única carga (10 km/L): su promedio es esa carga, no una muestra.
    const summary = await performance.getEquipmentWorseSummary(globalSession(), filters({ faena: W.perf, meses: "3", equipo: "KA-20" }))
    expect(summary.total).toBe(1)
    expect(summary.worse).toBe(0)

    const { rows } = await performance.getEquipmentStats(globalSession(), filters({ faena: W.perf, meses: "3", equipo: "KA-20" }))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ n: 1, worseThanModel: false, worseThanHistory: false })
  })

  it("la frase y la tabla coinciden sin filtro de equipo", async () => {
    const summary = await performance.getEquipmentWorseSummary(globalSession(), filters({ faena: W.perf, meses: "3" }))
    const { rows } = await performance.getEquipmentStats(globalSession(), filters({ faena: W.perf, meses: "3" }), { all: true })

    expect(summary.total).toBe(rows.length)
    expect(summary.worse).toBe(rows.filter((row) => row.worseThanModel || row.worseThanHistory).length)
  })
})
