/**
 * Consultas del Panel de combustible contra un Postgres real (PGlite con todas
 * las migraciones): las tres cifras del período con su historia (alcance por
 * faena, cargas que no entran al promedio, semana, mes y trimestre, el corte del
 * día en hora de Chile y la comparación del período en curso), y lo propio de
 * terreno y contrato (mis cargas, mis equipos, mi última planilla).
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

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

const {
  getMyEquipmentRanking,
  getMyFlaggedLoadKeys,
  getMyLastPlanillaBatch,
  getMyLoadCounts,
  getMyRecentLoads,
  getPanelFigures,
  getPaymentActivity,
  hasMeasuredPerformance,
} = await import("@/lib/combustibles/panel/queries")
const { buildPanelFigures } = await import("@/lib/combustibles/panel/figures")
const { describeFuelPeriod } = await import("@/lib/combustibles/period/parse")

import type { FuelPeriod } from "@/lib/combustibles/period/types"

const W_A = "w-a"
const W_B = "w-b"
const W_C = "w-c"
const ME = "u-me"
const OTHER = "u-other"

function session(options: { id?: string; worksiteIds?: string[]; global?: boolean } = {}): Session {
  return {
    user: {
      id: options.id ?? ME,
      name: "Prueba",
      email: "prueba@example.com",
      roles: [],
      permissions: [],
      worksiteIds: options.worksiteIds ?? [],
      primaryWorksiteId: options.worksiteIds?.[0] ?? null,
      avatarColor: null,
      isActive: true,
      isGlobal: options.global ?? false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}

const globalSession = (id = ME) => session({ id, global: true })
const scopedSession = (worksiteIds: string[], id = ME) => session({ id, worksiteIds })

const resolve = (period: FuelPeriod, today: string) => describeFuelPeriod(period, "url", today)

let seq = 0

interface LoadSpec {
  vehicleId: string
  worksiteId: string
  /** Instante de la carga. */
  at: string
  liters: number
  /** Mes "YYYY-MM"; por omisión el de `at`. */
  month?: string
  review?: "ok" | "flagged" | "approved" | "rejected"
  perf?: "computed" | "first_load"
  /** Avance del medidor y litros acumulados del tramo (con `perf: "computed"`). */
  meterDelta?: number
  accLiters?: number
  unit?: "km_per_liter" | "liters_per_hour"
  voided?: boolean
  duplicateOf?: string
  registeredBy?: string
  taeStatus?: "submitted" | "observed" | "validated" | "voided"
  equipmentCode?: string
}

async function addLoad(spec: LoadSpec): Promise<{ loadId: string; submissionId: string }> {
  seq += 1
  const loadId = `load-${seq}`
  const submissionId = `sub-${seq}`
  await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
    id: submissionId,
    clientSubmissionId: `client-${seq}`,
    publicResultToken: `token-${seq}`,
    source: spec.registeredBy ? "internal_app" : "public_pwa",
    worksiteId: spec.worksiteId,
    vehicleId: spec.vehicleId,
    productId: "prod-diesel",
    equipmentCodeSnapshot: spec.equipmentCode ?? `EQ-${spec.vehicleId}`,
    plateSnapshot: `PL-${seq}`,
    loadedAt: spec.at,
    submittedAt: spec.at,
    driverNameSnapshot: "Conductor",
    supervisorNameSnapshot: "Supervisor",
    meterType: "odometer",
    liters: spec.liters,
    status: spec.taeStatus ?? "submitted",
    registeredBy: spec.registeredBy ?? null,
  })
  await inMemoryDb.insert(schema.fuelEquipmentLoads).values({
    id: loadId,
    source: "field",
    taeSubmissionId: submissionId,
    vehicleId: spec.vehicleId,
    worksiteId: spec.worksiteId,
    occurredAt: spec.at,
    month: spec.month ?? spec.at.slice(0, 7),
    liters: spec.liters,
    meterType: "odometer",
    performanceUnit: spec.unit ?? "km_per_liter",
    performanceStatus: spec.perf ?? "computed",
    reviewStatus: spec.review ?? "ok",
    meterDelta: spec.meterDelta ?? null,
    accumulatedLiters: spec.accLiters ?? null,
    voidedAt: spec.voided ? spec.at : null,
    duplicateOfId: spec.duplicateOf ?? null,
  })
  return { loadId, submissionId }
}

async function reset() {
  await inMemoryDb.delete(schema.fuelEquipmentLoads)
  await inMemoryDb.delete(schema.fuelTaeSubmissions)
  await inMemoryDb.delete(schema.fuelOperationBatches)
  await inMemoryDb.delete(schema.fuelPayments)
  await inMemoryDb.delete(schema.fuelLoads)
  await inMemoryDb.delete(schema.fuelMonthlyStatements)
}

beforeAll(async () => {
  await inMemoryDb.insert(schema.worksites).values([
    { id: W_A, name: "Faena A", code: "FN-A" },
    { id: W_B, name: "Faena B", code: "FN-B" },
    { id: W_C, name: "Faena C", code: "FN-C" },
  ])
  await inMemoryDb.insert(schema.users).values([
    { id: ME, name: "Yo", email: "yo@example.com", hashedPassword: "x", isActive: true },
    { id: OTHER, name: "Otra", email: "otra@example.com", hashedPassword: "x", isActive: true },
  ])
  await inMemoryDb.insert(schema.fuelProducts).values({ id: "prod-diesel", code: "DIESEL-PANEL", name: "Diésel", category: "diesel" }).onConflictDoNothing()
  await inMemoryDb.insert(schema.fuelEquipmentTypes).values([
    { id: "t-truck", slug: "camion-panel", name: "Camión", performanceFamily: "camiones" },
    { id: "t-machine", slug: "maquina-panel", name: "Excavadora", performanceFamily: "maquinaria" },
    { id: "t-pickup", slug: "camioneta-panel", name: "Camioneta", performanceFamily: "cargadores_camionetas" },
  ])
  const vehicle = (id: string, plate: string, code: string, typeId: string, worksiteId: string, unit: "km_per_liter" | "liters_per_hour") => ({
    id, plate, code, type: "camion", equipmentTypeId: typeId, worksiteId, performanceUnit: unit, meterType: unit === "km_per_liter" ? "odometer" : "hour_meter",
  })
  await inMemoryDb.insert(schema.fuelVehicles).values([
    vehicle("v-truck-a", "AAAA11", "CA-14", "t-truck", W_A, "km_per_liter"),
    vehicle("v-truck-b", "BBBB22", "CA-22", "t-truck", W_B, "km_per_liter"),
    vehicle("v-machine-a", "CCCC33", "EX-03", "t-machine", W_A, "liters_per_hour"),
    vehicle("v-pickup-a", "DDDD44", "CM-08", "t-pickup", W_A, "km_per_liter"),
    vehicle("v-truck-c", "EEEE55", "CA-30", "t-truck", W_C, "km_per_liter"),
  ])
  await inMemoryDb.insert(schema.fuelSuppliers).values([
    { id: "sup-copec", name: "Copec" },
    { id: "sup-aramco", name: "Aramco" },
  ])
})

/* ── Las tres cifras ──────────────────────────────────────────────────────── */

describe("cifras del período (PostgreSQL)", () => {
  const OCT: FuelPeriod = { kind: "month", year: 2026, month: 10 }

  beforeEach(async () => {
    await reset()
    // Octubre, mes en curso (hoy es el 31).
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-05T15:00:00.000Z", liters: 100, meterDelta: 280, accLiters: 100 })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-08T15:00:00.000Z", liters: 200, review: "approved", meterDelta: 540, accLiters: 200 })
    // Por decidir: suma litros, no entra al promedio y se cuenta como excluida.
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-10T15:00:00.000Z", liters: 50, review: "flagged", meterDelta: 140, accLiters: 50 })
    // No cuentan: rechazada, anulada y duplicada de otra.
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-11T15:00:00.000Z", liters: 70, review: "rejected", meterDelta: 196, accLiters: 70 })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-12T15:00:00.000Z", liters: 30, voided: true, meterDelta: 84, accLiters: 30 })
    const first = await addLoad({ vehicleId: "v-pickup-a", worksiteId: W_A, at: "2026-10-13T15:00:00.000Z", liters: 90, meterDelta: 900, accLiters: 90 })
    await addLoad({ vehicleId: "v-pickup-a", worksiteId: W_A, at: "2026-10-13T15:05:00.000Z", liters: 40, duplicateOf: first.loadId, meterDelta: 400, accLiters: 40 })
    // Maquinaria en horas.
    await addLoad({ vehicleId: "v-machine-a", worksiteId: W_A, at: "2026-10-14T15:00:00.000Z", liters: 120, unit: "liters_per_hour", meterDelta: 8, accLiters: 120 })
    await addLoad({ vehicleId: "v-machine-a", worksiteId: W_A, at: "2026-10-15T15:00:00.000Z", liters: 60, unit: "liters_per_hour", review: "flagged", meterDelta: 3, accLiters: 60 })
    // Otra faena.
    await addLoad({ vehicleId: "v-truck-b", worksiteId: W_B, at: "2026-10-16T15:00:00.000Z", liters: 300, meterDelta: 840, accLiters: 300 })
    // Septiembre.
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-09-05T15:00:00.000Z", liters: 150, meterDelta: 400, accLiters: 150 })
    await addLoad({ vehicleId: "v-machine-a", worksiteId: W_A, at: "2026-09-12T15:00:00.000Z", liters: 100, unit: "liters_per_hour", meterDelta: 10, accLiters: 100 })
    await addLoad({ vehicleId: "v-truck-b", worksiteId: W_B, at: "2026-09-20T15:00:00.000Z", liters: 500, meterDelta: 1250, accLiters: 500 })
    // 02:30 UTC del 1 de octubre son las 23:30 del 30 de septiembre en Chile (UTC-3): es de septiembre.
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-01T02:30:00.000Z", liters: 10, month: "2026-09", meterDelta: 30, accLiters: 10 })
    // Agosto.
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-08-10T15:00:00.000Z", liters: 120, meterDelta: 330, accLiters: 120 })
  })

  it("agrupa cada carga en su período y deja cinco, del más antiguo al actual", async () => {
    const raw = await getPanelFigures(globalSession(), resolve(OCT, "2026-10-31"), "2026-10-31")
    expect(raw.buckets).toHaveLength(5)
    expect(raw.buckets.map((bucket) => [bucket.from, bucket.to])).toEqual([
      ["2026-06-01", "2026-06-30"], ["2026-07-01", "2026-07-31"], ["2026-08-01", "2026-08-31"], ["2026-09-01", "2026-09-30"], ["2026-10-01", "2026-10-31"],
    ])
    expect(raw.buckets.map((bucket) => bucket.liters)).toEqual([0, 0, 120, 760, 920])
    expect(raw.buckets.map((bucket) => bucket.loads)).toEqual([0, 0, 1, 4, 7])
  })

  it("el corte del día es el de Chile: 23:30 del 30 de septiembre no es de octubre", async () => {
    const raw = await getPanelFigures(globalSession(), resolve(OCT, "2026-10-31"), "2026-10-31")
    // Septiembre = 150 + 100 + 500 + 10 (la de las 23:30 de Chile).
    expect(raw.buckets[3]?.liters).toBe(760)
    expect(raw.buckets[4]?.liters).toBe(920)
  })

  it("octubre: litros y equipos cuentan lo que cuenta; el promedio sólo lo calculado y sin decisión pendiente", async () => {
    const raw = await getPanelFigures(globalSession(), resolve(OCT, "2026-10-31"), "2026-10-31")
    const october = raw.buckets[4]!
    // Rechazada, anulada y duplicada no suman. La marcada sí (el combustible se cargó).
    expect(october.liters).toBe(100 + 200 + 50 + 90 + 120 + 60 + 300)
    expect(october.equipment).toBe(4)
    // Camiones (km/L): sólo ok y aprobada; la marcada, la rechazada, la anulada y la camioneta quedan fuera.
    expect(october.truckKm).toBe(280 + 540 + 840)
    expect(october.truckLiters).toBe(100 + 200 + 300)
    expect(october.truckExcluded).toBe(1)
    // Maquinaria (L/h): sólo la que no espera decisión.
    expect(october.machineHours).toBe(8)
    expect(october.machineLiters).toBe(120)
    expect(october.machineExcluded).toBe(1)
  })

  it("las cifras armadas: km/L y L/h son razón de sumas, con la variación contra septiembre", async () => {
    const resolved = resolve(OCT, "2026-10-31")
    const figures = buildPanelFigures(await getPanelFigures(globalSession(), resolved, "2026-10-31"), resolved, "2026-10-31")
    expect(figures.liters.value).toBe("920")
    expect(figures.liters.label).toBe("Litros cargados a 4 equipos")
    expect(figures.trucks.value).toBe("2,8")
    expect(figures.trucks.hint).toBe("1 carga por decidir no entra al promedio")
    expect(figures.machinery.value).toBe("15")
    expect(figures.machinery.history.map((point) => point.value)).toEqual([null, null, null, 10, 15])
    // Septiembre: camiones (400 + 1.250 + 30) ÷ (150 + 500 + 10) = 2,545…; octubre 1.660 ÷ 600 = 2,766…
    expect(figures.trucks.variation).toMatchObject({ pct: 9, polarity: "up-good", versus: "septiembre" })
    expect(figures.machinery.variation).toMatchObject({ pct: 50, polarity: "up-bad" })
  })

  it("alcance por faena: cada sesión ve sólo lo suyo", async () => {
    const resolved = resolve(OCT, "2026-10-31")
    const a = (await getPanelFigures(scopedSession([W_A]), resolved, "2026-10-31")).buckets[4]!
    expect(a.liters).toBe(100 + 200 + 50 + 90 + 120 + 60)
    expect(a.equipment).toBe(3)
    expect(a.truckKm).toBe(280 + 540)
    expect(a.truckLiters).toBe(300)

    const b = (await getPanelFigures(scopedSession([W_B]), resolved, "2026-10-31")).buckets[4]!
    expect(b.liters).toBe(300)
    expect(b.equipment).toBe(1)
    expect(b.truckKm).toBe(840)

    const both = (await getPanelFigures(scopedSession([W_A, W_B]), resolved, "2026-10-31")).buckets[4]!
    expect(both.liters).toBe(920)

    const none = await getPanelFigures(scopedSession([]), resolved, "2026-10-31")
    expect(none.buckets.every((bucket) => bucket.liters === 0 && bucket.loads === 0 && bucket.equipment === 0)).toBe(true)
  })

  it("un período en curso se compara con los mismos primeros días del anterior", async () => {
    // El 14 de octubre el mes lleva 14 días: del anterior cuentan sólo del 1 al 14 de septiembre (150 + 100).
    const midMonth = resolve(OCT, "2026-10-14")
    expect(midMonth.status).toBe("en_curso")
    const raw = await getPanelFigures(globalSession(), midMonth, "2026-10-14")
    expect(raw.partialPrevLiters).toBe(250)

    // El 31 el mes está completo y el tramo es todo septiembre (incluida la carga de las 23:30 del 30).
    const endOfMonth = await getPanelFigures(globalSession(), resolve(OCT, "2026-10-31"), "2026-10-31")
    expect(endOfMonth.partialPrevLiters).toBe(760)

    // Un período cerrado se compara contra el anterior entero: no hay tramo.
    const closed = resolve({ kind: "month", year: 2026, month: 9 }, "2026-10-31")
    expect(closed.status).toBe("cerrado")
    expect((await getPanelFigures(globalSession(), closed, "2026-10-31")).partialPrevLiters).toBeNull()
  })

  it("sin ninguna carga todo es cero y las cifras dicen «sin datos»", async () => {
    await reset()
    const resolved = resolve(OCT, "2026-10-31")
    const figures = buildPanelFigures(await getPanelFigures(globalSession(), resolved, "2026-10-31"), resolved, "2026-10-31")
    expect(figures.empty).toBe(true)
    expect(figures.liters.value).toBeNull()
    expect(figures.trucks.value).toBeNull()
    expect(figures.machinery.value).toBeNull()
  })

  it("hasMeasuredPerformance: sólo cuenta con cargas calculadas y sin decisión pendiente, dentro del alcance", async () => {
    const resolved = resolve(OCT, "2026-10-31")
    expect(await hasMeasuredPerformance(globalSession(), resolved)).toBe(true)
    expect(await hasMeasuredPerformance(scopedSession([W_B]), resolved)).toBe(true)
    expect(await hasMeasuredPerformance(scopedSession([]), resolved)).toBe(false)

    // La faena C sólo tiene una carga por decidir: no hay con qué medir.
    await addLoad({ vehicleId: "v-truck-c", worksiteId: W_C, at: "2026-10-20T15:00:00.000Z", liters: 80, review: "flagged", meterDelta: 200, accLiters: 80 })
    expect(await hasMeasuredPerformance(scopedSession([W_C]), resolved)).toBe(false)
    // Fuera del período tampoco.
    expect(await hasMeasuredPerformance(globalSession(), resolve({ kind: "month", year: 2026, month: 3 }, "2026-10-31"))).toBe(false)
  })
})

describe("semana y trimestre (PostgreSQL)", () => {
  beforeEach(reset)

  it("semana ISO: cada barra es una semana de lunes a domingo", async () => {
    // Semana 44 de 2026: del lunes 26 de octubre al domingo 1 de noviembre.
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-27T15:00:00.000Z", liters: 40, meterDelta: 100, accLiters: 40 })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-20T15:00:00.000Z", liters: 100, meterDelta: 270, accLiters: 100 })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-13T15:00:00.000Z", liters: 60, meterDelta: 150, accLiters: 60 })
    // Domingo 25 a las 23:00 de Chile (02:00 UTC del lunes 26) sigue siendo de la semana 43.
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-26T02:00:00.000Z", liters: 5, meterDelta: 10, accLiters: 5 })
    const resolved = resolve({ kind: "week", year: 2026, week: 44 }, "2026-10-29")
    const raw = await getPanelFigures(globalSession(), resolved, "2026-10-29")
    expect(raw.buckets.map((bucket) => bucket.from)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"])
    expect(raw.buckets.map((bucket) => bucket.liters)).toEqual([0, 0, 60, 105, 40])
    // El jueves 29 la semana lleva 4 días: se compara con los primeros 4 días de la anterior (lunes 19 a jueves 22).
    expect(raw.partialPrevLiters).toBe(100)
  })

  it("trimestre: cinco trimestres terminando en el actual", async () => {
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-11-05T15:00:00.000Z", liters: 200, meterDelta: 540, accLiters: 200 })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-07-10T15:00:00.000Z", liters: 100, meterDelta: 280, accLiters: 100 })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-02-01T15:00:00.000Z", liters: 50, meterDelta: 140, accLiters: 50 })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2025-10-31T15:00:00.000Z", liters: 30, meterDelta: 80, accLiters: 30 })
    const resolved = resolve({ kind: "quarter", year: 2026, quarter: 4 }, "2026-12-31")
    const raw = await getPanelFigures(globalSession(), resolved, "2026-12-31")
    expect(raw.buckets.map((bucket) => [bucket.from, bucket.to])).toEqual([
      ["2025-10-01", "2025-12-31"], ["2026-01-01", "2026-03-31"], ["2026-04-01", "2026-06-30"], ["2026-07-01", "2026-09-30"], ["2026-10-01", "2026-12-31"],
    ])
    expect(raw.buckets.map((bucket) => bucket.liters)).toEqual([30, 50, 0, 100, 200])
    const figures = buildPanelFigures(raw, resolved, "2026-12-31")
    expect(figures.liters.history.map((point) => point.label)).toEqual(["4T 25", "1T 26", "2T 26", "3T 26", "4T 26"])
    expect(figures.liters.variation).toMatchObject({ pct: 100, versus: "el 3.er trimestre" })
  })

  it("año y rango también arman sus cinco períodos", async () => {
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-06-10T15:00:00.000Z", liters: 70, meterDelta: 190, accLiters: 70 })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2025-06-10T15:00:00.000Z", liters: 20, meterDelta: 50, accLiters: 20 })
    const year = await getPanelFigures(globalSession(), resolve({ kind: "year", year: 2026 }, "2026-12-31"), "2026-12-31")
    expect(year.buckets.map((bucket) => bucket.liters)).toEqual([0, 0, 0, 20, 70])
    // Un rango de 30 días: los cuatro anteriores tienen su mismo largo.
    const range = await getPanelFigures(globalSession(), resolve({ kind: "range", from: "2026-06-01", to: "2026-06-30" }, "2026-07-15"), "2026-07-15")
    expect(range.buckets.map((bucket) => bucket.from)).toEqual(["2026-02-01", "2026-03-03", "2026-04-02", "2026-05-02", "2026-06-01"])
    expect(range.buckets[4]?.liters).toBe(70)
  })
})

/* ── Pagos ────────────────────────────────────────────────────────────────── */

describe("actividad de pagos (PostgreSQL)", () => {
  beforeEach(async () => {
    await reset()
    await inMemoryDb.insert(schema.fuelMonthlyStatements).values([
      { id: "st-oct", month: "2026-10", fuelSupplierId: "sup-copec", createdBy: ME },
      { id: "st-oct-x", month: "2026-10", fuelSupplierId: "sup-aramco", status: "cancelled", createdBy: ME },
      { id: "st-sep", month: "2026-09", fuelSupplierId: "sup-copec", createdBy: ME },
    ])
    const invoiced = (id: string, month: string, status: string) => ({
      id, loadDate: `${month}-10`, month, serviceType: "TCT", vehicleId: "v-truck-a", fuelSupplierId: "sup-copec", worksiteId: W_A,
      product: "PETROLEO DIESEL", productId: "prod-diesel", liters: 10, baseAmount: 1000, totalAmount: 1190, status, createdBy: ME,
    })
    await inMemoryDb.insert(schema.fuelLoads).values([
      invoiced("fl-1", "2026-10", "registered"),
      invoiced("fl-2", "2026-10", "cancelled"),
      invoiced("fl-3", "2026-08", "registered"),
    ])
  })

  it("cuenta estados de cuenta y cargas facturadas de los meses del período, sin las anuladas", async () => {
    expect(await getPaymentActivity(resolve({ kind: "month", year: 2026, month: 10 }, "2026-10-31"))).toEqual({ statements: 1, invoicedLoads: 1 })
    expect(await getPaymentActivity(resolve({ kind: "quarter", year: 2026, quarter: 3 }, "2026-10-31"))).toEqual({ statements: 1, invoicedLoads: 1 })
    expect(await getPaymentActivity(resolve({ kind: "month", year: 2026, month: 5 }, "2026-10-31"))).toEqual({ statements: 0, invoicedLoads: 0 })
  })

  it("una semana mira los meses que toca", async () => {
    // La semana 40 va del 28 de septiembre al 4 de octubre: toca septiembre y octubre.
    expect(await getPaymentActivity(resolve({ kind: "week", year: 2026, week: 40 }, "2026-10-31"))).toEqual({ statements: 2, invoicedLoads: 1 })
  })
})

/* ── Terreno y contrato ───────────────────────────────────────────────────── */

describe("lo propio de terreno y contrato (PostgreSQL)", () => {
  const OCT: FuelPeriod = { kind: "month", year: 2026, month: 10 }
  let flagged: { loadId: string; submissionId: string }

  beforeEach(async () => {
    await reset()
    flagged = await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-05T15:00:00.000Z", liters: 100, registeredBy: ME, taeStatus: "submitted", review: "flagged", equipmentCode: "CA-14", meterDelta: 280, accLiters: 100 })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-06T15:00:00.000Z", liters: 50, registeredBy: ME, taeStatus: "observed", equipmentCode: "CA-14" })
    await addLoad({ vehicleId: "v-machine-a", worksiteId: W_A, at: "2026-10-07T15:00:00.000Z", liters: 120, registeredBy: ME, taeStatus: "validated", equipmentCode: "EX-03", unit: "liters_per_hour" })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-08T15:00:00.000Z", liters: 30, registeredBy: ME, taeStatus: "voided", voided: true, review: "flagged", equipmentCode: "CA-14" })
    await addLoad({ vehicleId: "v-truck-b", worksiteId: W_B, at: "2026-10-09T15:00:00.000Z", liters: 300, registeredBy: ME, taeStatus: "submitted", equipmentCode: "CA-22" })
    // Fuera del período, de otra persona y sin registrante (formulario por QR).
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-09-30T15:00:00.000Z", liters: 10, registeredBy: ME, taeStatus: "submitted" })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-10T15:00:00.000Z", liters: 20, registeredBy: OTHER, taeStatus: "submitted", review: "flagged" })
    await addLoad({ vehicleId: "v-truck-a", worksiteId: W_A, at: "2026-10-11T15:00:00.000Z", liters: 25, taeStatus: "submitted" })
  })

  it("cuenta mis cargas del período por estado, sin las anuladas", async () => {
    expect(await getMyLoadCounts(globalSession(), resolve(OCT, "2026-10-31"))).toEqual({ all: 4, toValidate: 2, withObservation: 1 })
  })

  it("el alcance por faena también recorta mis cargas", async () => {
    expect(await getMyLoadCounts(scopedSession([W_A]), resolve(OCT, "2026-10-31"))).toEqual({ all: 3, toValidate: 1, withObservation: 1 })
    expect(await getMyLoadCounts(scopedSession([]), resolve(OCT, "2026-10-31"))).toEqual({ all: 0, toValidate: 0, withObservation: 0 })
    // Cada persona ve las suyas.
    expect(await getMyLoadCounts(globalSession(OTHER), resolve(OCT, "2026-10-31"))).toEqual({ all: 1, toValidate: 1, withObservation: 0 })
  })

  it("lista mis últimas cargas, la más reciente primero, con su equipo y faena", async () => {
    const recent = await getMyRecentLoads(globalSession(), resolve(OCT, "2026-10-31"), 3)
    expect(recent.map((load) => [load.equipmentCode, load.worksiteName, load.liters, load.status])).toEqual([
      ["CA-22", "Faena B", 300, "submitted"],
      ["EX-03", "Faena A", 120, "validated"],
      ["CA-14", "Faena A", 50, "observed"],
    ])
    const scoped = await getMyRecentLoads(scopedSession([W_A]), resolve(OCT, "2026-10-31"), 5)
    expect(scoped.map((load) => load.equipmentCode)).toEqual(["EX-03", "CA-14", "CA-14"])
  })

  it("reconoce mis cargas por decidir (la carga y su registro) y deja fuera las ajenas y las anuladas", async () => {
    const keys = await getMyFlaggedLoadKeys(globalSession())
    expect(keys.sort()).toEqual([flagged.loadId, flagged.submissionId].sort())
    expect(await getMyFlaggedLoadKeys(scopedSession([W_B]))).toEqual([])
    expect(await getMyFlaggedLoadKeys(globalSession(OTHER))).toHaveLength(2)
  })

  it("rankea los litros por equipo dentro de mi alcance, sin lo que no cuenta", async () => {
    // Los 30 L anulados no cuentan; sí las cargas de cualquier persona dentro de la faena (el ranking es del alcance, no mío):
    // CA-14 = 100 (por decidir) + 50 + 20 (de otra persona) + 25 (QR).
    const global = await getMyEquipmentRanking(globalSession(), resolve(OCT, "2026-10-31"))
    expect(global.map((entry) => [entry.label, entry.liters])).toEqual([
      ["CA-22 · Faena B", 300],
      ["CA-14 · Faena A", 195],
      ["EX-03 · Faena A", 120],
    ])
    const scoped = await getMyEquipmentRanking(scopedSession([W_A]), resolve(OCT, "2026-10-31"))
    expect(scoped.map((entry) => entry.label)).toEqual(["CA-14 · Faena A", "EX-03 · Faena A"])
    expect(scoped[0]?.liters).toBe(195)
    expect((await getMyEquipmentRanking(scopedSession([W_A]), resolve(OCT, "2026-10-31"), 1))).toHaveLength(1)
    expect(await getMyEquipmentRanking(scopedSession([]), resolve(OCT, "2026-10-31"))).toEqual([])
  })

  it("devuelve mi última planilla vigente, no la revertida ni las de otras personas", async () => {
    const batch = (id: string, by: string, estado: string, createdAt: string, valid: number, invalid: number) => ({
      id, archivoNombre: `${id}.xlsx`, hashArchivo: `hash-${id}`, estado, periodoDesde: "2026-10-01", periodoHasta: "2026-10-28",
      totalFilas: valid + invalid, filasValidas: valid, filasInvalidas: invalid, importadoPor: by, createdAt,
    })
    await inMemoryDb.insert(schema.fuelOperationBatches).values([
      batch("b-old", ME, "importado", "2026-10-14T12:00:00.000Z", 1190, 0),
      batch("b-reverted", ME, "revertido", "2026-10-29T12:00:00.000Z", 5, 0),
      batch("b-other", OTHER, "importado", "2026-10-30T12:00:00.000Z", 7, 0),
      batch("b-last", ME, "importado", "2026-10-28T20:02:00.000Z", 1228, 12),
    ])
    const last = await getMyLastPlanillaBatch(globalSession())
    expect(last).toMatchObject({ id: "b-last", fileName: "b-last.xlsx", validRows: 1228, invalidRows: 12 })
    expect(await getMyLastPlanillaBatch(globalSession("u-nadie"))).toBeNull()
  })
})
