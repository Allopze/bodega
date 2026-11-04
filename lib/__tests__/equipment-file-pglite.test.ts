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
import { IDS, seedControlFixtures, submission } from "@/lib/combustibles/control/queries/test-fixtures"
import { fillLitersByMonth } from "@/lib/combustibles/equipment/liters-by-month"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))
// Pasa derecho al original; sólo deja a una prueba hacer fallar la sección «litros por mes».
vi.mock("@/lib/combustibles/equipment/liters-by-month", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/combustibles/equipment/liters-by-month")>()
  return { ...actual, fillLitersByMonth: vi.fn(actual.fillLitersByMonth) }
})

const { getEquipmentFile, getEquipmentVehicle } = await import("@/lib/combustibles/equipment/get-equipment-file")

function session(options: { global?: boolean; worksiteIds?: string[]; permissions?: string[] } = {}): Session {
  return {
    user: { id: IDS.user, isGlobal: options.global ?? true, roles: [], worksiteIds: options.worksiteIds ?? [], permissions: options.permissions ?? ["combustibles:view"] },
    expires: "2099-01-01",
  } as unknown as Session
}

const MARCH = describeFuelPeriod({ kind: "month", year: 2026, month: 3 }, "url", "2026-04-15")

let seq = 0
async function addLoad(input: {
  vehicle: string
  worksite: string
  at: string
  perf: number | null
  liters?: number
  review?: "ok" | "flagged" | "approved" | "rejected"
  voided?: boolean
  flagReasons?: string[]
  sealChain?: "ok" | "mismatch" | "no_previous" | "no_seal"
  installedSeal?: string
}) {
  seq += 1
  const sub = submission({
    id: `eqf-sub-${seq}`,
    vehicleId: input.vehicle,
    worksiteId: input.worksite,
    loadedAt: input.at,
    submittedAt: input.at,
    liters: input.liters ?? 100,
    sealChainStatus: input.sealChain ?? "ok",
    sealChainExpected: input.sealChain === "mismatch" ? "I-ESPERADO" : null,
    removedSealNumber: "R-X",
    installedSealNumber: input.installedSeal ?? "I-1",
  })
  await testDb.insert(schema.fuelTaeSubmissions).values(sub)
  await testDb.insert(schema.fuelEquipmentLoads).values({
    id: `eqf-load-${seq}`,
    source: "field",
    taeSubmissionId: sub.id,
    vehicleId: input.vehicle,
    worksiteId: input.worksite,
    occurredAt: input.at,
    month: input.at.slice(0, 7),
    liters: input.liters ?? 100,
    performanceUnit: "liters_per_hour",
    performanceValue: input.perf,
    performanceStatus: input.perf === null ? "first_load" : "computed",
    reviewStatus: input.review ?? "ok",
    flagReasons: input.flagReasons ?? [],
    voidedAt: input.voided ? "2026-03-12T00:00:00.000Z" : null,
  })
  return { loadId: `eqf-load-${seq}`, submissionId: sub.id }
}

let flaggedLoadId = ""
let flaggedSubmissionId = ""
let mismatchSubmissionId = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  // A y B son del mismo modelo (y de la misma unidad, L/h): comparables entre sí. C es de otra marca.
  await testDb.update(schema.fuelVehicles).set({ brand: "Cat", model: "320" }).where(eq(schema.fuelVehicles.id, IDS.vA))
  await testDb.update(schema.fuelVehicles).set({ brand: "Cat", model: "320" }).where(eq(schema.fuelVehicles.id, IDS.vB))
  await testDb.update(schema.fuelVehicles).set({ brand: "Volvo", model: "EC", tankCapacityLiters: 400 }).where(eq(schema.fuelVehicles.id, IDS.vC))

  // Historial de A (los 12 meses antes de marzo): 12 L/h de promedio, muy parejo.
  for (const [at, perf] of [
    ["2025-08-10T15:00:00.000Z", 11], ["2025-09-10T15:00:00.000Z", 12], ["2025-10-10T15:00:00.000Z", 12],
    ["2025-11-10T15:00:00.000Z", 13], ["2025-12-10T15:00:00.000Z", 12], ["2026-01-10T15:00:00.000Z", 12],
  ] as const) await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at, perf })

  // Marzo de A: rinde mucho peor (20 y 22 L/h; en L/h más es peor). Una carga con la cadena de sellos rota.
  await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-03-05T15:00:00.000Z", perf: 20, sealChain: "mismatch", installedSeal: "I-8" })
  mismatchSubmissionId = `eqf-sub-${seq}`
  await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-03-20T15:00:00.000Z", perf: 22, installedSeal: "I-9" })
  // Una por decidir (no entra al promedio) y una anulada (no cuenta ni aparece).
  const flagged = await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-03-25T15:00:00.000Z", perf: 99, review: "flagged", flagReasons: ["outlier", "implausible"] })
  flaggedLoadId = flagged.loadId
  flaggedSubmissionId = flagged.submissionId
  await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-03-26T15:00:00.000Z", perf: 50, voided: true })

  // B, el otro Cat 320: 15 L/h en marzo.
  await addLoad({ vehicle: IDS.vB, worksite: IDS.wsB, at: "2026-03-06T15:00:00.000Z", perf: 15 })
  await addLoad({ vehicle: IDS.vB, worksite: IDS.wsB, at: "2026-03-16T15:00:00.000Z", perf: 15 })

  // Telemetría de A en marzo: 18 h de funcionamiento con 6 h en vacío.
  await testDb.insert(schema.fuelTelemetryDaily).values([
    { id: "eqf-tel-1", vehicleId: IDS.vA, source: "visionlink", day: "2026-03-02", month: "2026-03", operatingHours: 10, idleHours: 2, litersIdle: 12 },
    { id: "eqf-tel-2", vehicleId: IDS.vA, source: "visionlink", day: "2026-03-03", month: "2026-03", operatingHours: 8, idleHours: 4, litersIdle: 20 },
    { id: "eqf-tel-3", vehicleId: IDS.vB, source: "visionlink", day: "2026-03-02", month: "2026-03", operatingHours: 5, idleHours: 1 },
    // CHART-024: un día de minutos con el motor andando (no dibuja porcentaje), una segunda fuente el mismo día (no se suma,
    // manda la de más horas) y un día de febrero, fuera del período (abril sigue sin telemetría: el otro test lo exige).
    { id: "eqf-tel-4", vehicleId: IDS.vA, source: "visionlink", day: "2026-03-04", month: "2026-03", operatingHours: 0.5, idleHours: 0.5 },
    { id: "eqf-tel-5", vehicleId: IDS.vA, source: "otra", day: "2026-03-02", month: "2026-03", operatingHours: 3, idleHours: 3 },
    { id: "eqf-tel-6", vehicleId: IDS.vA, source: "visionlink", day: "2026-02-27", month: "2026-02", operatingHours: 7, idleHours: 1 },
  ])

  // Un caso vigente y un pedido de revisión abierto de A; uno cerrado que no debe salir.
  await testDb.insert(schema.fuelAnomalyRules).values({ id: "eqf-rule", code: "eqf_regla", name: "Sello repetido", severity: "high" })
  await testDb.insert(schema.fuelAnomalyCases).values([
    { id: "eqf-case-open", ruleId: "eqf-rule", ruleCode: "eqf_regla", severity: "high", worksiteId: IDS.wsA, vehicleId: IDS.vA, description: "Sello repetido en dos cargas", status: "open" },
    { id: "eqf-case-done", ruleId: "eqf-rule", ruleCode: "eqf_regla", severity: "low", worksiteId: IDS.wsA, vehicleId: IDS.vA, description: "Ya resuelto", status: "resolved" },
    { id: "eqf-case-b", ruleId: "eqf-rule", ruleCode: "eqf_regla", severity: "low", worksiteId: IDS.wsB, vehicleId: IDS.vB, description: "De otro equipo", status: "open" },
  ])
  await testDb.insert(schema.fuelReviewMarks).values([
    { id: "eqf-mark-open", entityType: "fuel_tae_submission", entityId: mismatchSubmissionId, worksiteId: IDS.wsA, markedBy: IDS.user, notes: "Revisar el sello", status: "open" },
    { id: "eqf-mark-withdrawn", entityType: "fuel_tae_submission", entityId: mismatchSubmissionId, worksiteId: IDS.wsA, markedBy: IDS.user, notes: "Retirado", status: "withdrawn" },
  ])
}, 120_000)

describe("ficha de equipo: alcance", () => {
  it("un equipo que no existe o queda fuera de la faena del usuario da null, sin distinguir los dos casos", async () => {
    expect(await getEquipmentFile(session(), "no-existe", MARCH)).toBeNull()
    expect(await getEquipmentFile(session({ global: false, worksiteIds: [IDS.wsB] }), IDS.vA, MARCH)).toBeNull()
    expect(await getEquipmentVehicle(session({ global: false, worksiteIds: [IDS.wsB] }), IDS.vA)).toBeNull()
  })

  it("con la faena del equipo en su alcance, o con alcance global, la ficha existe con sus datos", async () => {
    const scoped = await getEquipmentFile(session({ global: false, worksiteIds: [IDS.wsA] }), IDS.vA, MARCH)
    expect(scoped?.vehicle).toMatchObject({ id: IDS.vA, label: "KA-1 · AA-0001", worksiteName: "Faena A", unit: "liters_per_hour", meterType: "hour_meter", brand: "Cat", model: "320" })
    const all = await getEquipmentFile(session(), IDS.vC, MARCH)
    expect(all?.vehicle).toMatchObject({ label: "CC-0003", tankCapacityLiters: 400, worksiteName: "Faena C" })
  })

  it("el alcance también recorta lo que muestra la ficha: un usuario de otra faena no ve las cargas de A", async () => {
    const other = await getEquipmentFile(session({ global: false, worksiteIds: [IDS.wsB] }), IDS.vB, MARCH)
    expect(other?.loads.count).toBe(2)
    expect(other?.cases).toEqual([expect.objectContaining({ kind: "caso", detail: "De otro equipo" })])
  })
})

describe("ficha de equipo: cargas del período", () => {
  it("cuenta litros y cargas que cuentan (con la por decidir, sin la anulada) y enlaza cada una a su ficha", async () => {
    const file = (await getEquipmentFile(session(), IDS.vA, MARCH))!
    expect(file.loads).toMatchObject({ count: 3, liters: 300, hiddenCount: 0 })
    expect(file.loads.rows.map((row) => row.performanceValue)).toEqual([99, 22, 20])
    const flagged = file.loads.rows[0]!
    expect(flagged).toMatchObject({ reviewStatus: "flagged", liters: 100 })
    expect(flagged.href).toBe(`/combustibles/cargas/terreno/${encodeURIComponent(flaggedSubmissionId)}`)
    expect(file.degraded).toEqual([])
  })

  it("sólo trae lo del período: abril no tiene cargas", async () => {
    const april = describeFuelPeriod({ kind: "month", year: 2026, month: 4 }, "url", "2026-04-15")
    const file = (await getEquipmentFile(session(), IDS.vA, april))!
    expect(file.loads).toMatchObject({ count: 0, liters: 0, rows: [] })
    expect(file.idle).toBeNull()
  })
})

describe("ficha de equipo: rendimiento contra su modelo y su historial", () => {
  it("en L/h más es peor: contra el otro Cat 320 y contra sus 12 meses previos", async () => {
    const { performance } = (await getEquipmentFile(session(), IDS.vA, MARCH))!
    expect(performance).not.toBeNull()
    // Promedio de marzo: 20 y 22 (la por decidir y la anulada no entran).
    expect(performance).toMatchObject({ unit: "liters_per_hour", n: 2, mean: 21, modelMean: 15, historyMean: 12, excludedInReview: 1 })
    expect(performance!.deltaModelPct).toBeCloseTo(40, 6)
    expect(performance!.deltaHistoryPct).toBeCloseTo(75, 6)
    expect(performance!.worseThanModel).toBe(true)
    expect(performance!.worseThanHistory).toBe(true)
    expect(performance!.regularity).toBe("parejo")
  })

  it("el otro Cat 320 compara contra A: rinde mejor, no peor", async () => {
    const { performance } = (await getEquipmentFile(session(), IDS.vB, MARCH))!
    expect(performance).toMatchObject({ n: 2, mean: 15, modelMean: 21, historyMean: null, worseThanModel: false, worseThanHistory: false })
    expect(performance!.deltaModelPct).toBeCloseTo((15 - 21) / 21 * 100, 6)
  })

  it("el rango normal sale de su historial previo, y las cargas de marzo quedan fuera de él desde la primera", async () => {
    const { performance } = (await getEquipmentFile(session(), IDS.vA, MARCH))!
    expect(performance!.normalRange).toMatchObject({ samples: 6, mean: 12, k: 2 })
    expect(performance!.normalRange!.high).toBeLessThan(14)
    expect(performance!.series.map((point) => point.value)).toEqual([11, 12, 12, 13, 12, 12, 20, 22])
    expect(performance!.series.filter((point) => point.outOfRange).map((point) => point.value)).toEqual([20, 22])
    expect(performance!.outOfRangeSince).toMatchObject({ count: 2 })
  })

  it("un equipo sin cargas ni historial no tiene sección de rendimiento", async () => {
    const { performance } = (await getEquipmentFile(session(), IDS.vC, MARCH))!
    expect(performance).toBeNull()
  })
})

describe("ficha de equipo: litros por mes", () => {
  // Un equipo propio de esta sección, para no mover las cifras de A y B que miden las demás.
  const LIT = "eqf-veh-lit"
  const APRIL = describeFuelPeriod({ kind: "month", year: 2026, month: 4 }, "url", "2026-04-15")
  /** `mes → [litros, cargas]`: lo que muestra el gráfico, sin los meses en cero. */
  const withLoads = (file: { litersByMonth: Array<{ month: string; liters: number; loads: number }> }) =>
    Object.fromEntries(file.litersByMonth.filter((month) => month.loads > 0).map((month) => [month.month, [month.liters, month.loads]]))

  beforeAll(async () => {
    await testDb.insert(schema.fuelVehicles).values({
      id: LIT, plate: "LT-0001", code: "KL-1", type: "x", equipmentTypeId: IDS.eqType, meterType: "hour_meter", performanceUnit: "liters_per_hour", worksiteId: IDS.wsA,
    })
    const load = (at: string, liters: number, extra: { review?: "ok" | "flagged" | "approved" | "rejected"; voided?: boolean; worksite?: string } = {}) =>
      addLoad({ vehicle: LIT, worksite: extra.worksite ?? IDS.wsA, at, perf: null, liters, review: extra.review, voided: extra.voided })

    // Junio de 2025: dos cargas que cuentan (200 L) y tres que no: rechazada, anulada y duplicada de la primera.
    const original = await load("2025-06-10T15:00:00.000Z", 120)
    await load("2025-06-20T15:00:00.000Z", 80)
    await load("2025-06-25T15:00:00.000Z", 500, { review: "rejected" })
    await load("2025-06-26T15:00:00.000Z", 700, { voided: true })
    const duplicate = await load("2025-06-27T15:00:00.000Z", 900)
    await testDb.update(schema.fuelEquipmentLoads).set({ duplicateOfId: original.loadId }).where(eq(schema.fuelEquipmentLoads.id, duplicate.loadId))
    // La por decidir suma (el combustible se cargó), la aprobada también.
    await load("2025-09-15T15:00:00.000Z", 60, { review: "flagged" })
    await load("2025-12-15T15:00:00.000Z", 40, { review: "approved" })
    // Una carga del mismo equipo registrada en otra faena: un usuario sólo de la faena A no la ve.
    await load("2026-02-18T15:00:00.000Z", 77, { worksite: IDS.wsB })
    await load("2026-03-12T15:00:00.000Z", 250)
    // Fuera de la ventana de marzo: un mes antes del primero (marzo de 2025) y uno después del último (abril de 2026).
    await load("2025-03-20T15:00:00.000Z", 1000)
    await load("2026-04-10T15:00:00.000Z", 333)
  }, 60_000)

  it("trae los 12 meses que terminan en el del período, del más antiguo al más reciente, con ceros donde no hubo cargas", async () => {
    const { litersByMonth } = (await getEquipmentFile(session(), LIT, MARCH))!
    expect(litersByMonth.map((month) => month.month)).toEqual([
      "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09",
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
    ])
    // Los meses sin cargas son ceros explícitos, no huecos.
    expect(litersByMonth.find((month) => month.month === "2026-01")).toEqual({ month: "2026-01", liters: 0, loads: 0 })
    expect(litersByMonth.filter((month) => month.loads === 0)).toHaveLength(7)
  })

  it("suma sólo las cargas que cuentan: la rechazada, la anulada y la duplicada no entran, la por decidir sí", async () => {
    const file = (await getEquipmentFile(session(), LIT, MARCH))!
    expect(withLoads(file)).toEqual({
      "2025-06": [200, 2],
      "2025-09": [60, 1],
      "2025-12": [40, 1],
      "2026-02": [77, 1],
      "2026-03": [250, 1],
    })
    expect(file.degraded).toEqual([])
  })

  it("la ventana no incluye lo anterior a sus 12 meses ni lo posterior al mes del fin del período", async () => {
    const months = (await getEquipmentFile(session(), LIT, MARCH))!.litersByMonth.map((month) => month.month)
    expect(months).not.toContain("2025-03")
    expect(months).not.toContain("2026-04")
    // Con abril como período, la ventana corre un mes: entra abril de 2026 y sale abril de 2025.
    const april = (await getEquipmentFile(session(), LIT, APRIL))!
    expect(april.litersByMonth).toHaveLength(12)
    expect(april.litersByMonth[0]!.month).toBe("2025-05")
    expect(withLoads(april)).toEqual({
      "2025-06": [200, 2], "2025-09": [60, 1], "2025-12": [40, 1], "2026-02": [77, 1], "2026-03": [250, 1], "2026-04": [333, 1],
    })
  })

  it("termina en el mes del fin del período sea cual sea su forma: un rango entre febrero y marzo cierra en marzo", async () => {
    const range = describeFuelPeriod({ kind: "range", from: "2026-02-10", to: "2026-03-05" }, "url", "2026-04-15")
    const file = (await getEquipmentFile(session(), LIT, range))!
    expect(file.litersByMonth.at(-1)!.month).toBe("2026-03")
    expect(file.litersByMonth[0]!.month).toBe("2025-04")
    // El rango sólo fija dónde termina: los meses anteriores al rango siguen con sus litros.
    expect(withLoads(file)["2025-06"]).toEqual([200, 2])
  })

  it("el mes de un período completo coincide con los litros de «Cargas del período»", async () => {
    const a = (await getEquipmentFile(session(), IDS.vA, MARCH))!
    expect(a.litersByMonth.at(-1)).toEqual({ month: "2026-03", liters: a.loads.liters, loads: a.loads.count })
    // Y es del equipo: las cargas de B no se mezclan (cada barra sale de las cargas del equipo, no de la faena).
    expect(withLoads(a)).toEqual({
      "2025-08": [100, 1], "2025-09": [100, 1], "2025-10": [100, 1], "2025-11": [100, 1], "2025-12": [100, 1], "2026-01": [100, 1], "2026-03": [300, 3],
    })
  })

  it("un equipo sin cargas en los 12 meses trae 12 ceros", async () => {
    const { litersByMonth } = (await getEquipmentFile(session(), IDS.vC, MARCH))!
    expect(litersByMonth).toHaveLength(12)
    expect(litersByMonth.every((month) => month.liters === 0 && month.loads === 0)).toBe(true)
  })

  it("respeta el alcance: de la faena A sólo ve lo cargado en A, y de otra faena la ficha no existe", async () => {
    // Global ve la carga que se registró en B (77 L en febrero); quien sólo tiene la faena A, no.
    const global = (await getEquipmentFile(session(), LIT, MARCH))!
    const scopedA = (await getEquipmentFile(session({ global: false, worksiteIds: [IDS.wsA] }), LIT, MARCH))!
    expect(global.litersByMonth.find((month) => month.month === "2026-02")).toEqual({ month: "2026-02", liters: 77, loads: 1 })
    expect(scopedA.litersByMonth.find((month) => month.month === "2026-02")).toEqual({ month: "2026-02", liters: 0, loads: 0 })
    expect(withLoads(scopedA)).toEqual({ "2025-06": [200, 2], "2025-09": [60, 1], "2025-12": [40, 1], "2026-03": [250, 1] })
    // Una sesión de otra faena no recibe ni la ficha: tampoco se filtran sus litros por mes.
    expect(await getEquipmentFile(session({ global: false, worksiteIds: [IDS.wsB] }), LIT, MARCH)).toBeNull()
    expect(await getEquipmentFile(session({ global: false, worksiteIds: [IDS.wsC] }), LIT, MARCH)).toBeNull()
  })

  it("si la sección falla, la ficha sigue: lista vacía, el aviso dice cuál y se sigue contando como fuente", async () => {
    const healthy = (await getEquipmentFile(session(), LIT, MARCH))!
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(fillLitersByMonth).mockImplementationOnce(() => { throw new Error("falla simulada") })
    try {
      const broken = (await getEquipmentFile(session(), LIT, MARCH))!
      expect(broken.litersByMonth).toEqual([])
      expect(broken.degraded).toEqual(["litros por mes"])
      expect(broken.sourceCount).toBe(healthy.sourceCount)
      // Lo demás de la ficha sigue ahí.
      expect(broken.vehicle.id).toBe(LIT)
      expect(broken.loads).toEqual(healthy.loads)
      expect(logged.mock.calls.some(([line]) => String(line).includes("litros por mes falló"))).toBe(true)
    } finally {
      logged.mockRestore()
    }
    expect((await getEquipmentFile(session(), LIT, MARCH))!.degraded).toEqual([])
  })
})

describe("ficha de equipo: motor en vacío", () => {
  it("suma las horas del equipo en el período y calcula el % desde las horas", async () => {
    const { idle } = (await getEquipmentFile(session(), IDS.vA, MARCH))!
    expect(idle).toMatchObject({ operatingHours: 18.5, idleHours: 6.5, activeDays: 3, litersIdle: 32 })
    expect(idle!.idlePct).toBeCloseTo((6.5 / 18.5) * 100, 6)
  })

  it("CHART-024: trae la serie diaria del equipo, un registro por día y sólo del período", async () => {
    const { idle } = (await getEquipmentFile(session(), IDS.vA, MARCH))!
    // El 2 de marzo dos fuentes informan al equipo: no se suman, manda la de más horas (10 h, no 3 h). El 27 de febrero no entra.
    expect(idle!.daily.map((point) => [point.day, point.operatingHours, point.idleHours])).toEqual([
      ["2026-03-02", 10, 2], ["2026-03-03", 8, 4], ["2026-03-04", 0.5, 0.5],
    ])
    expect(idle!.daily[1]!.idlePct).toBeCloseTo(50, 6)
    // La suma de la serie es la misma que los totales de la sección: el gráfico y las cifras no pueden discrepar.
    expect(idle!.daily.reduce((sum, point) => sum + point.operatingHours, 0)).toBeCloseTo(idle!.operatingHours, 6)
  })

  it("CHART-024: la serie diaria respeta el alcance — un usuario de la faena B no ve ni la ficha de A, y la de B sólo trae lo suyo", async () => {
    // De otra faena la ficha no existe: tampoco hay serie diaria que filtrar.
    expect(await getEquipmentFile(session({ global: false, worksiteIds: [IDS.wsB] }), IDS.vA, MARCH)).toBeNull()
    const own = (await getEquipmentFile(session({ global: false, worksiteIds: [IDS.wsB] }), IDS.vB, MARCH))!
    expect(own.idle!.daily.map((point) => [point.day, point.operatingHours])).toEqual([["2026-03-02", 5]])
    // Y con A en su alcance, ni una hora de B se cuela en la serie de A.
    const forA = (await getEquipmentFile(session({ global: false, worksiteIds: [IDS.wsA] }), IDS.vA, MARCH))!
    expect(forA.idle!.daily).toHaveLength(3)
  })

  it("sin telemetría no hay sección, no un 0 %", async () => {
    expect((await getEquipmentFile(session(), IDS.vC, MARCH))!.idle).toBeNull()
  })
})

describe("ficha de equipo: cadena de sellos (dato de terreno)", () => {
  it("sin combustibles:tae_view no hay sección de sellos", async () => {
    expect((await getEquipmentFile(session(), IDS.vA, MARCH))!.seals).toBeNull()
  })

  it("con tae_view cuenta las cargas con la cadena rota y dice cuál era el sello esperado", async () => {
    const { seals } = (await getEquipmentFile(session({ permissions: ["combustibles:view", "combustibles:tae_view"] }), IDS.vA, MARCH))!
    expect(seals).toMatchObject({ loads: 4, mismatches: 1, withoutSeal: 0, lastInstalledSeal: "I-1" })
    expect(seals!.issues).toEqual([expect.objectContaining({ submissionId: mismatchSubmissionId, expectedSeal: "I-ESPERADO", removedSeal: "R-X" })])
  })
})

describe("ficha de equipo: lo pendiente", () => {
  it("junta la carga por decidir, el caso vigente y el pedido abierto, y enlaza cada uno a la bandeja", async () => {
    const { cases } = (await getEquipmentFile(session(), IDS.vA, MARCH))!
    expect(cases.map((item) => item.kind).sort()).toEqual(["carga", "caso", "pedido"])
    const byKind = Object.fromEntries(cases.map((item) => [item.kind, item]))
    expect(byKind.carga).toMatchObject({ title: "Rendimiento atípico para el equipo", severity: null })
    expect(byKind.carga!.detail).toContain("100")
    expect(byKind.carga!.detail).toContain("1 motivo más")
    expect(byKind.caso).toMatchObject({ title: "Sello repetido", severity: "high", detail: "Sello repetido en dos cargas" })
    expect(byKind.pedido).toMatchObject({ title: "Pedido de revisión", detail: "Revisar el sello" })
    for (const item of cases) {
      const url = new URL(item.href, "http://x")
      expect(url.pathname).toBe("/combustibles/revisar")
      expect(url.searchParams.get("tipo")).toBe(item.kind)
      expect(url.searchParams.get("item")).toBe(item.key)
    }
    expect(new URL(byKind.carga!.href, "http://x").searchParams.get("item")).toBe(`carga:${flaggedLoadId}`)
    // Ni el caso resuelto ni el pedido retirado ni los de otro equipo.
    expect(cases.some((item) => item.detail === "Ya resuelto" || item.detail === "Retirado" || item.detail === "De otro equipo")).toBe(false)
  })

  it("lo vencido sigue apareciendo aunque el período sea posterior (como en la bandeja)", async () => {
    const may = describeFuelPeriod({ kind: "month", year: 2026, month: 5 }, "url", "2026-06-15")
    const { cases } = (await getEquipmentFile(session(), IDS.vA, may))!
    expect(cases.map((item) => item.kind)).toContain("carga")
  })

  it("un período anterior al de la carga por decidir no la muestra todavía", async () => {
    const february = describeFuelPeriod({ kind: "month", year: 2026, month: 2 }, "url", "2026-06-15")
    const { cases } = (await getEquipmentFile(session(), IDS.vA, february))!
    expect(cases.map((item) => item.kind)).not.toContain("carga")
  })
})
