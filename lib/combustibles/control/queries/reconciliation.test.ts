import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, filtersFor, globalSession, scopedSession, seedControlFixtures, submission } from "./test-fixtures"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { getMandante, getMediumCross, getReconciliationFlow, getReconciliationFlowsByMandante } = await import("./reconciliation")
const { getMandantesReconciliation, getMandantesReconciliationSummary, reconciliationVerdict } = await import("./reconciliation-summary")
const { describeFuelPeriod } = await import("@/lib/combustibles/period/parse")
const { wholeMonthRange } = await import("./field-filters")

let txCounter = 0
function providerTx(overrides: Partial<typeof schema.fuelProviderTransactions.$inferInsert>): typeof schema.fuelProviderTransactions.$inferInsert {
  txCounter += 1
  return {
    id: `ptx-${txCounter}`, syncRunId: IDS.run, provider: "copec", sourceAccount: "tct:diesel", identityKey: `idk-${txCounter}`,
    fingerprint: `fp-${txCounter}`, sourceRowKey: `row-${txCounter}`, worksiteId: IDS.wsA, occurredAt: "2026-03-10T12:00:00.000Z",
    quantity: 100, status: "accepted", granularity: "transaction", payloadHash: `ph-${txCounter}`, ...overrides,
  }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelProviderSyncRuns).values({ id: IDS.run, provider: "copec", requestedFrom: "2026-03-01", requestedTo: "2026-04-30", correlationId: "corr-ctl" })

  await testDb.insert(schema.fuelSupplyInputs).values([
    { id: "in-1", supplyMediumId: IDS.mediumCmpc, worksiteId: IDS.wsA, occurredAt: "2026-03-05T12:00:00.000Z", month: "2026-03", liters: 1000, reference: "G-1" },
    { id: "in-2", supplyMediumId: IDS.mediumCmpc, worksiteId: IDS.wsB, occurredAt: "2026-04-05T12:00:00.000Z", month: "2026-04", liters: 400, reference: "G-2" },
    // Otro mandante: no debe aparecer al filtrar por M1.
    { id: "in-c", supplyMediumId: IDS.mediumCmpc, worksiteId: IDS.wsC, occurredAt: "2026-03-05T12:00:00.000Z", month: "2026-03", liters: 5000, reference: "G-C" },
  ])
  await testDb.insert(schema.fuelProviderTransactions).values([
    providerTx({ quantity: 500 }),
    // Reemplazada por otra aceptada: no cuenta.
    providerTx({ id: "ptx-old", quantity: 77, identityKey: "old", sourceRowKey: "old" }),
    providerTx({ id: "ptx-new", quantity: 80, supersedesId: "ptx-old", identityKey: "new", sourceRowKey: "new" }),
    // Pendiente: no cuenta.
    providerTx({ quantity: 9999, status: "pending" }),
    // Agregado mensual TCT con detalle en el mismo mes y patente: se omite para no contar dos veces.
    providerTx({ id: "ptx-agg", quantity: 580, granularity: "period_aggregate", occurredAt: "2026-03-01", sourcePlate: "AA-0001", identityKey: "agg", sourceRowKey: "agg" }),
    providerTx({ id: "ptx-det", quantity: 10, sourcePlate: "AA-0001", identityKey: "det", sourceRowKey: "det" }),
    // Agregado de abril SIN detalle: sí cuenta.
    providerTx({ id: "ptx-agg-apr", quantity: 60, granularity: "period_aggregate", occurredAt: "2026-04-01", sourcePlate: "AA-0001", identityKey: "agg-apr", sourceRowKey: "agg-apr", worksiteId: IDS.wsB }),
    // La cuenta TAE se mapea al medio TAE.
    providerTx({ provider: "copec", sourceAccount: "tae:diesel", quantity: 40, identityKey: "ar", sourceRowKey: "ar" }),
  ])
  await testDb.insert(schema.fuelTaeSubmissions).values([
    submission({ id: "d-fixed", loadingPointId: IDS.lpFixed, supplyMediumId: IDS.mediumCmpc, liters: 600 }),
    submission({ id: "d-tank", loadingPointId: IDS.lpTank, supplyMediumId: IDS.mediumTct, liters: 450 }),
    submission({ id: "d-tae", loadingPointId: IDS.lpTae, supplyMediumId: IDS.mediumTct, liters: 100 }),
    submission({ id: "d-none", loadingPointId: null, liters: 20 }),
    submission({ id: "d-void", loadingPointId: IDS.lpFixed, liters: 7777, status: "voided" }),
    submission({ id: "d-april", worksiteId: IDS.wsB, vehicleId: IDS.vB, loadingPointId: null, supplyMediumId: IDS.mediumCmpc, liters: 300, loadedAt: "2026-04-12T15:00:00.000Z" }),
  ])
}, 60_000)

describe("getMandante", () => {
  it("devuelve tolerancia y faenas, y null si no existe o está inactivo", async () => {
    expect(await getMandante(IDS.m1)).toMatchObject({ name: "Mandante Uno", tolerancePct: 2, worksiteNames: ["Faena A", "Faena B"] })
    expect(await getMandante("no-existe")).toBeNull()
  })
})

describe("getReconciliationFlow", () => {
  it("suma entradas importadas y del proveedor, separa directo de vía estanque y calcula la diferencia", async () => {
    const flow = await getReconciliationFlow(globalSession(), filtersFor({ mandante: IDS.m1 }), 2)
    // Marzo: entradas 1000 + proveedor (500 + 80 + 10 + 40 TAE) = 1630. Abril: 400 + agregado 60 = 460.
    const march = flow.months.find((month) => month.month === "2026-03")!
    expect(march.inputLiters).toBe(1630)
    expect(march.directLiters).toBe(720) // 600 fijo + 100 punto TAE + 20 sin lugar
    expect(march.viaTankLiters).toBe(450)
    expect(march.differenceLiters).toBe(1630 - 1170)
    expect(march.overTolerance).toBe(true)
    const april = flow.months.find((month) => month.month === "2026-04")!
    expect(april).toMatchObject({ inputLiters: 460, directLiters: 300, viaTankLiters: 0 })
    expect(flow.totals).toMatchObject({ inputLiters: 2090, directLiters: 1020, viaTankLiters: 450 })
    expect(flow.totals.differencePct).toBeCloseTo(((2090 - 1470) / 2090) * 100, 6)
    expect(flow.assumedDirectLiters).toBe(120 + 300)
  })

  it("no cuenta anuladas, pendientes ni reemplazadas, y no mezcla otro mandante", async () => {
    const flow = await getReconciliationFlow(globalSession(), filtersFor({ mandante: IDS.m1, meses: "3" }), 2)
    expect(flow.totals.deliveredLiters).toBe(1170)
    expect(flow.totals.inputLiters).toBe(1630)
    const other = await getReconciliationFlow(globalSession(), filtersFor({ mandante: IDS.m2, meses: "3" }), 5)
    expect(other.totals).toMatchObject({ inputLiters: 5000, deliveredLiters: 0 })
  })

  it("sin tolerancia (sin mandante) no declara fuera de tolerancia; con diferencia nula se marca igual", async () => {
    const flow = await getReconciliationFlow(globalSession(), filtersFor({ meses: "3" }), null)
    expect(flow.totals.overTolerance).toBeNull()
    expect(flow.totals.inputLiters).toBe(6630)
  })

  it("respeta el alcance de faena", async () => {
    const flow = await getReconciliationFlow(scopedSession([IDS.wsB]), filtersFor({ mandante: IDS.m1 }), 2)
    expect(flow.totals).toMatchObject({ inputLiters: 460, deliveredLiters: 300 })
    const none = await getReconciliationFlow(scopedSession([]), filtersFor(), 2)
    expect(none.totals).toMatchObject({ inputLiters: 0, deliveredLiters: 0, overTolerance: null })
  })

  it("dentro de tolerancia cuando la diferencia es pequeña", async () => {
    const flow = await getReconciliationFlow(globalSession(), filtersFor({ mandante: IDS.m1, meses: "4" }), 50)
    expect(flow.totals.overTolerance).toBe(false)
  })
})

describe("getMediumCross", () => {
  it("cruza lo registrado en terreno con lo informado por medio y no inventa 0 % sin informe", async () => {
    const rows = await getMediumCross(globalSession(), filtersFor({ mandante: IDS.m1 }))
    const byName = new Map(rows.map((row) => [row.name, row]))
    const cmpc = byName.get("Surtidor CMPC")!
    expect(cmpc).toMatchObject({ fieldLiters: 900, fieldLoads: 2, reportedLiters: 1400 })
    expect(cmpc.differenceLiters).toBe(500)
    expect(cmpc.differencePct).toBeCloseTo((500 / 1400) * 100, 6)
    // TCT: terreno 550; informado = 500 + 80 + 10 (marzo) + 60 (agregado de abril sin detalle).
    const tct = byName.get("TCT")!
    expect(tct).toMatchObject({ fieldLiters: 550, reportedLiters: 650 })
    // TAE sin cargas en terreno: aparece con lo informado.
    expect(byName.get("TAE")).toMatchObject({ fieldLiters: 0, reportedLiters: 40 })
    // Sin medio asignado: hay 20 L en terreno y no existe informe.
    expect(byName.get("Sin medio asignado")).toMatchObject({ fieldLiters: 20, reportedLiters: null, differenceLiters: null, differencePct: null })
  })

  it("un medio con cargas pero sin informe del proveedor queda con reportedLiters nulo", async () => {
    const rows = await getMediumCross(globalSession(), filtersFor({ mandante: IDS.m1, meses: "3" }))
    expect(rows.find((row) => row.name === "TCT")?.reportedLiters).toBe(590)
    const none = await getMediumCross(globalSession(), filtersFor({ mandante: IDS.m1, faena: IDS.wsB, meses: "3" }))
    expect(none).toEqual([])
  })
})

/**
 * Cuadratura de todos los mandantes (Panel y Cuadratura › Por mandante). Se mide
 * por mes completo: con una semana o un rango se miden los meses completos que
 * toca, y el resumen lo dice (`wholeMonths: false`).
 */
describe("getMandantesReconciliationSummary", () => {
  const WS_D = "ws-ctl-d"
  const V_D = "veh-ctl-d"
  const M3 = "mand-ctl-3"
  const month = (token: string, today = "2026-06-30") => {
    const [year, mm] = token.split("-").map(Number)
    return describeFuelPeriod({ kind: "month", year: year!, month: mm! }, "url", today)
  }

  beforeAll(async () => {
    // Un tercer mandante, en mayo y junio (los meses que las demás pruebas de este archivo no tocan):
    // mayo cuadra (1 % de diferencia, tolera 3 %) y junio no (10 %).
    await testDb.insert(schema.worksites).values({ id: WS_D, name: "Faena D", code: "CTL-D" })
    await testDb.insert(schema.fuelMandantes).values({ id: M3, name: "Mandante Tres", tolerancePct: 3 })
    await testDb.insert(schema.fuelMandanteWorksites).values({ worksiteId: WS_D, mandanteId: M3 })
    await testDb.insert(schema.fuelVehicles).values({ id: V_D, plate: "DD-0004", code: "KD-4", type: "x", equipmentTypeId: IDS.eqType, meterType: "hour_meter", performanceUnit: "liters_per_hour", worksiteId: WS_D })
    await testDb.insert(schema.fuelSupplyInputs).values([
      { id: "in-d-may", supplyMediumId: IDS.mediumCmpc, worksiteId: WS_D, occurredAt: "2026-05-10T12:00:00.000Z", month: "2026-05", liters: 1000, reference: "G-D1" },
      { id: "in-d-jun", supplyMediumId: IDS.mediumCmpc, worksiteId: WS_D, occurredAt: "2026-06-10T12:00:00.000Z", month: "2026-06", liters: 1000, reference: "G-D2" },
    ])
    await testDb.insert(schema.fuelTaeSubmissions).values([
      submission({ id: "d-may", worksiteId: WS_D, vehicleId: V_D, equipmentCodeSnapshot: "KD-4", loadingPointId: null, liters: 990, loadedAt: "2026-05-12T15:00:00.000Z" }),
      submission({ id: "d-jun", worksiteId: WS_D, vehicleId: V_D, equipmentCodeSnapshot: "KD-4", loadingPointId: null, liters: 900, loadedAt: "2026-06-12T15:00:00.000Z" }),
    ])
  }, 60_000)

  it("las tres consultas agrupadas por mandante dan lo mismo que medir un mandante a la vez", async () => {
    const tolerances = new Map([[IDS.m1, 2], [IDS.m2, 5], [M3, 3]])
    const grouped = await getReconciliationFlowsByMandante(globalSession(), filtersFor(), tolerances)
    for (const [id, tolerance] of tolerances) {
      expect(grouped.get(id)).toEqual(await getReconciliationFlow(globalSession(), filtersFor({ mandante: id }), tolerance))
    }
    // El mandante cuyo alcance no se ve no aparece.
    const scoped = await getReconciliationFlowsByMandante(scopedSession([IDS.wsC]), filtersFor(), tolerances)
    expect([...scoped.keys()]).toEqual([IDS.m2])
  })

  it("un mes: cada mandante con su tolerancia, lo que no cuadra primero y el mes en blanco hasta hoy", async () => {
    const result = await getMandantesReconciliation(globalSession(), month("2026-03"), { today: "2026-06-30" })
    expect(result.wholeMonths).toBe(true)
    expect(result.rows.map((row) => row.mandanteId)).toEqual([IDS.m2, IDS.m1, M3])
    const [m2, m1, m3] = result.rows
    expect(m1).toMatchObject({ name: "Mandante Uno", tolerancePct: 2, inLiters: 1630, directLiters: 720, viaTankLiters: 450, deliveredLiters: 1170, differenceLiters: 460, overTolerance: true, hasMovement: true, wholeMonths: true, monthKeys: ["2026-03"], worksiteNames: ["Faena A", "Faena B"], monthsOverTolerance: ["2026-03"] })
    expect(m1?.differencePct).toBeCloseTo((460 / 1630) * 100, 6)
    expect(m2).toMatchObject({ tolerancePct: 5, inLiters: 5000, deliveredLiters: 0, differenceLiters: 5000, overTolerance: true })
    // Sin entradas ni entregas en marzo: no hay nada que medir (no es un «cuadra»).
    expect(m3).toMatchObject({ overTolerance: null, hasMovement: false, inLiters: 0, differencePct: null })
    expect(m3?.months).toEqual([expect.objectContaining({ month: "2026-03", overTolerance: null })])
  })

  it("dentro y fuera de tolerancia: el mes cuadra o no contra la tolerancia de su mandante", async () => {
    const may = (await getMandantesReconciliationSummary(globalSession(), month("2026-05"), { mandanteId: M3 }))[0]!
    expect(may).toMatchObject({ mandanteId: M3, tolerancePct: 3, inLiters: 1000, differenceLiters: 10, overTolerance: false })
    expect(may.differencePct).toBeCloseTo(1, 6)
    expect(reconciliationVerdict(may)).toMatchObject({ tone: "ok", label: "Cuadra" })
    const june = (await getMandantesReconciliationSummary(globalSession(), month("2026-06"), { mandanteId: M3 }))[0]!
    expect(june).toMatchObject({ differenceLiters: 100, overTolerance: true })
    expect(reconciliationVerdict(june)).toMatchObject({ tone: "over", label: "Fuera de tolerancia", sentence: "Faltan 100 L (10 %), sobre su tolerancia de 3 %." })
  })

  it("un trimestre se mide como meses completos, con cada mes contra la tolerancia y los meses en blanco", async () => {
    const quarter = describeFuelPeriod({ kind: "quarter", year: 2026, quarter: 2 }, "url", "2026-06-15")
    const result = await getMandantesReconciliation(globalSession(), quarter, { mandanteId: M3, today: "2026-06-15" })
    const row = result.rows[0]!
    expect(result.wholeMonths).toBe(true)
    expect(row.monthKeys).toEqual(["2026-04", "2026-05", "2026-06"])
    expect(row.months.map((m) => [m.month, m.overTolerance])).toEqual([["2026-04", null], ["2026-05", false], ["2026-06", true]])
    // El total del trimestre no cuadra (5,5 % sobre 3 %) y el mes de junio es el que lo explica.
    expect(row).toMatchObject({ inLiters: 2000, deliveredLiters: 1890, differenceLiters: 110, overTolerance: true, monthsOverTolerance: ["2026-06"] })
  })

  it("un mes futuro sin datos no se rellena", async () => {
    const quarter = describeFuelPeriod({ kind: "quarter", year: 2026, quarter: 2 }, "url", "2026-04-20")
    const row = (await getMandantesReconciliation(globalSession(), quarter, { mandanteId: IDS.m1, today: "2026-04-20" })).rows[0]!
    // M1 sólo tiene datos en abril entre abril y junio; mayo y junio no existen todavía.
    expect(row.months.map((m) => m.month)).toEqual(["2026-04"])
  })

  it("una semana o un rango no son meses completos: se miden los meses que tocan y se dice", async () => {
    const range = describeFuelPeriod({ kind: "range", from: "2026-05-15", to: "2026-06-10" }, "url", "2026-06-30")
    expect(range.isWholeMonths).toBe(false)
    expect(wholeMonthRange(range)).toEqual({ from: "2026-05-01", to: "2026-06-30" })
    const result = await getMandantesReconciliation(globalSession(), range, { mandanteId: M3, today: "2026-06-30" })
    expect(result.wholeMonths).toBe(false)
    expect(result.monthKeys).toEqual(["2026-05", "2026-06"])
    expect(result.range).toEqual({ from: "2026-05-01", to: "2026-06-30" })
    // El mayo completo entra aunque el rango empiece el 15: 1000 L de entrada, no sólo lo posterior al 15.
    expect(result.rows[0]).toMatchObject({ wholeMonths: false, inLiters: 2000, deliveredLiters: 1890, monthKeys: ["2026-05", "2026-06"] })
    const week = describeFuelPeriod({ kind: "week", year: 2026, week: 23 }, "url", "2026-06-30")
    const viaSummary = await getMandantesReconciliationSummary(globalSession(), week, { mandanteId: M3 })
    expect(viaSummary[0]).toMatchObject({ wholeMonths: false, monthKeys: ["2026-06"], inLiters: 1000, differenceLiters: 100 })
  })

  it("respeta el alcance de faena y la faena elegida", async () => {
    const scoped = await getMandantesReconciliationSummary(scopedSession([IDS.wsA]), month("2026-03"))
    // Un solo mandante, con sólo la faena del alcance, y cifras sólo de esa faena.
    expect(scoped.map((row) => row.mandanteId)).toEqual([IDS.m1])
    expect(scoped[0]).toMatchObject({ worksiteNames: ["Faena A"], inLiters: 1630, deliveredLiters: 1170 })
    expect(await getMandantesReconciliationSummary(scopedSession([]), month("2026-03"))).toEqual([])
    const byWorksite = await getMandantesReconciliationSummary(globalSession(), month("2026-04"), { worksiteId: IDS.wsB })
    expect(byWorksite.map((row) => row.mandanteId)).toEqual([IDS.m1])
    expect(byWorksite[0]).toMatchObject({ inLiters: 460, deliveredLiters: 300 })
  })

  it("el estado en palabras distingue lo que falta, lo que sobra y lo que no se puede medir", () => {
    const base = { tolerancePct: 2 }
    expect(reconciliationVerdict({ ...base, inLiters: 42_100, directLiters: 29_300, viaTankLiters: 11_480, differenceLiters: 1320, differencePct: 3.1356, overTolerance: true }).sentence)
      .toBe("Faltan 1.320 L (3,1 %), sobre su tolerancia de 2 %.")
    expect(reconciliationVerdict({ ...base, inLiters: 1000, directLiters: 1050, viaTankLiters: 0, differenceLiters: -50, differencePct: -5, overTolerance: true }).sentence)
      .toBe("Se entregaron 50 L (5 %) más de lo que entró, sobre su tolerancia de 2 %.")
    expect(reconciliationVerdict({ ...base, inLiters: 0, directLiters: 300, viaTankLiters: 0, differenceLiters: -300, differencePct: null, overTolerance: true }).sentence)
      .toBe("Se entregaron 300 L y no hay ninguna entrada registrada en el período.")
    expect(reconciliationVerdict({ ...base, inLiters: 1000, directLiters: 1000, viaTankLiters: 0, differenceLiters: 0, differencePct: 0, overTolerance: false })).toMatchObject({ tone: "ok", sentence: "Cuadra: lo que entró coincide con lo entregado." })
    expect(reconciliationVerdict({ ...base, inLiters: 0, directLiters: 0, viaTankLiters: 0, differenceLiters: 0, differencePct: null, overTolerance: null })).toMatchObject({ tone: "idle", label: "Sin movimiento" })
  })
})
