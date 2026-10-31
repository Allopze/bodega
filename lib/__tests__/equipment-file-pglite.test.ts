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

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

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

describe("ficha de equipo: motor en vacío", () => {
  it("suma las horas del equipo en el período y calcula el % desde las horas", async () => {
    const { idle } = (await getEquipmentFile(session(), IDS.vA, MARCH))!
    expect(idle).toMatchObject({ operatingHours: 18, idleHours: 6, activeDays: 2, litersIdle: 32 })
    expect(idle!.idlePct).toBeCloseTo(100 / 3, 6)
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
