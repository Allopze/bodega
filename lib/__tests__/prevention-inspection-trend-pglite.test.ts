/**
 * La serie mensual de cumplimiento de inspecciones (CHART-010).
 *
 * Lo que este archivo protege, en orden de gravedad:
 *
 * 1. **El alcance de faenas.** Un usuario de la faena A no ve ni cuenta las
 *    inspecciones de la faena B, ni siquiera pidiéndolas con `?faena=`.
 * 2. **La ponderación por ítems.** El mes suma `porcentaje × ítems evaluados`;
 *    promediar porcentajes hundiría el mes por una pauta corta mal respondida.
 * 3. **Qué entra.** Sólo ejecuciones cerradas con fecha: una planificada, en
 *    curso o cancelada no tiene cumplimiento.
 * 4. **El mes civil chileno.** Una inspección del 31 de agosto a las 22:00 de
 *    Santiago es de agosto aunque en UTC ya sea septiembre.
 * 5. **El universo de los KPI.** El estado y la vista rápida no acotan la serie.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const service = await import("@/lib/services/prevention-inspections")

const USER = "user-trend-1"
const WS_A = "ws-trend-a"
const WS_B = "ws-trend-b"
const TEMPLATE = "tpl-trend-1"
const VIEW = "prevention:inspections:view"

const ALL: WorksiteScope = { mode: "all", ids: [] }
const ONLY_A: WorksiteScope = { mode: "some", ids: [WS_A] }
const NONE: WorksiteScope = { mode: "none", ids: [] }
const accessOf = (scope: WorksiteScope, permissions: string[] = [VIEW]) => ({ userId: USER, scope, permissions })
const SINCE = "2026-01-01"

type RunOverrides = Partial<typeof schema.preventionInspectionRuns.$inferInsert>

async function seedRun(id: string, over: RunOverrides) {
  await testDb.insert(schema.preventionInspectionRuns).values({
    id,
    code: id.toUpperCase(),
    templateId: TEMPLATE,
    worksiteId: WS_A,
    status: "completed",
    executedByUserId: USER,
    executedAt: "2026-09-15T15:00:00.000Z",
    createdByUserId: USER,
    ...over,
  })
}

async function seedFinding(id: string, runId: string, criticality: "low" | "medium" | "high" | "critical", closed = false) {
  await testDb.insert(schema.preventionInspectionFindings).values({
    id,
    runId,
    description: "Extintor sin sello de seguridad",
    criticality,
    status: closed ? "closed" : "open",
    ...(closed ? { closedByUserId: USER, closedAt: "2026-10-01T12:00:00.000Z" } : {}),
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({ id: USER, name: "Revisor", email: "revisor@trend.cl", hashedPassword: "x", isActive: true })
  await testDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "TRD-A", isActive: true },
    { id: WS_B, name: "Faena B", code: "TRD-B", isActive: true },
  ])
  await testDb.insert(schema.preventionInspectionTemplates).values({
    id: TEMPLATE, code: TEMPLATE, versionLabel: "01", name: "Plantilla de tendencia", kind: "inspection",
    definitionSnapshot: {}, contentHash: TEMPLATE.padEnd(64, "0").slice(0, 64), status: "approved",
    authorUserId: USER, approvedByUserId: USER, approvedAt: "2026-08-01T12:00:00.000Z",
  })

  // Septiembre, faena A: 10 ítems al 100 % y 90 ítems al 50 % → ponderado 55 %, no 75 %.
  await seedRun("run-trend-sep-corta", { conformingCount: 10, compliancePercent: 100 })
  await seedRun("run-trend-sep-larga", { conformingCount: 45, nonConformingCount: 45, compliancePercent: 50 })
  // Con «Regular»: los parciales entran como ítems evaluados.
  await seedRun("run-trend-sep-parcial", { conformingCount: 4, partialCount: 4, nonConformingCount: 2, compliancePercent: 60 })
  // Todo «no aplica»: cuenta como ejecución, no como cumplimiento calculable.
  await seedRun("run-trend-sep-sin-items", { notApplicableCount: 12, compliancePercent: null })
  // Octubre, faena A, revisada.
  await seedRun("run-trend-oct", {
    status: "reviewed", conformingCount: 20, compliancePercent: 100,
    executedAt: "2026-10-10T15:00:00.000Z", reviewedByUserId: USER, reviewedAt: "2026-10-11T15:00:00.000Z",
  })
  // Faena B: no debe aparecer para quien sólo ve A.
  await seedRun("run-trend-b", { worksiteId: WS_B, conformingCount: 30, compliancePercent: 100, executedAt: "2026-10-12T15:00:00.000Z" })
  // No cuentan: planificada, en curso y cancelada no tienen cumplimiento.
  await seedRun("run-trend-planned", { status: "planned", executedByUserId: null, executedAt: null, scheduledFor: "2026-11-20" })
  await seedRun("run-trend-in-progress", { status: "in_progress", executedByUserId: null, executedAt: null })
  await seedRun("run-trend-cancelled", {
    status: "cancelled", executedByUserId: null, executedAt: null,
    cancelledByUserId: USER, cancelledAt: "2026-10-02T12:00:00.000Z", cancellationReason: "Faena equivocada",
  })
  // Fuera de la ventana pedida.
  await seedRun("run-trend-vieja", { conformingCount: 10, compliancePercent: 100, executedAt: "2025-03-10T15:00:00.000Z" })
  // 31 de agosto, 22:00 en Santiago (UTC-4 en agosto) = 1 de septiembre 02:00 UTC.
  await seedRun("run-trend-borde", { conformingCount: 8, compliancePercent: 100, executedAt: "2026-09-01T02:00:00.000Z" })

  await seedFinding("find-trend-1", "run-trend-sep-larga", "high")
  await seedFinding("find-trend-2", "run-trend-sep-larga", "medium")
  await seedFinding("find-trend-3", "run-trend-sep-larga", "critical", true)
  await seedFinding("find-trend-4", "run-trend-b", "critical")
})

const byMonth = (rows: Awaited<ReturnType<typeof service.summarizeInspectionComplianceTrend>>) =>
  Object.fromEntries(rows.map((row) => [row.month, row]))

describe("alcance de faenas", () => {
  it("quien ve sólo la faena A no cuenta la B", async () => {
    const rows = await service.summarizeInspectionComplianceTrend(accessOf(ONLY_A), {}, { since: SINCE })
    // La B aportaba 1 ejecución a octubre y 30 ítems: sin ella, octubre es sólo la de A.
    expect(byMonth(rows)["2026-10"]).toMatchObject({ runs: 1, scoredItems: 20, weightedPoints: 2000 })
  })

  it("pedir la faena B con alcance A no devuelve nada, ni siquiera ceros", async () => {
    const rows = await service.summarizeInspectionComplianceTrend(accessOf(ONLY_A), { worksiteId: WS_B }, { since: SINCE })
    expect(rows).toEqual([])
  })

  it("sin faenas en el alcance no hay serie", async () => {
    expect(await service.summarizeInspectionComplianceTrend(accessOf(NONE), {}, { since: SINCE })).toEqual([])
  })

  it("con alcance total, el filtro de faena elige una sola", async () => {
    const onlyB = await service.summarizeInspectionComplianceTrend(accessOf(ALL), { worksiteId: WS_B }, { since: SINCE })
    expect(onlyB.map((row) => [row.month, row.runs])).toEqual([["2026-10", 1]])
    const everything = await service.summarizeInspectionComplianceTrend(accessOf(ALL), {}, { since: SINCE })
    expect(byMonth(everything)["2026-10"]?.runs).toBe(2)
  })

  it("sin el permiso de ver, falla como cualquier otra consulta del módulo", async () => {
    await expect(service.summarizeInspectionComplianceTrend(accessOf(ALL, []), {}, { since: SINCE })).rejects.toThrow()
  })
})

describe("ponderación y qué entra", () => {
  it("septiembre suma porcentaje × ítems y no promedia porcentajes", async () => {
    const rows = await service.summarizeInspectionComplianceTrend(accessOf(ONLY_A), {}, { since: SINCE })
    const september = byMonth(rows)["2026-09"]
    // corta 10×100 + larga 90×50 + parcial 10×60 + borde (31-ago, ver abajo) no entra acá.
    expect(september).toMatchObject({
      runs: 4,
      scoredRuns: 3,
      scoredItems: 110,
      weightedPoints: 10 * 100 + 90 * 50 + 10 * 60,
    })
    // 6100 / 110 = 55,45: muy lejos del promedio simple (70).
    expect(september!.weightedPoints / september!.scoredItems).toBeCloseTo(55.45, 1)
  })

  it("una ejecución sin ítems evaluados cuenta como ejecución pero no como cumplimiento", async () => {
    const rows = await service.summarizeInspectionComplianceTrend(accessOf(ONLY_A), {}, { since: SINCE })
    const september = byMonth(rows)["2026-09"]!
    expect(september.runs - september.scoredRuns).toBe(1)
  })

  it("planificadas, en curso y canceladas no aparecen", async () => {
    const rows = await service.summarizeInspectionComplianceTrend(accessOf(ALL), {}, { since: SINCE })
    // 4 de septiembre + octubre de A + octubre de B + la del borde de agosto: las otras
    // cuatro (planificada, en curso, cancelada y la de 2025) quedan fuera.
    expect(rows.reduce((sum, row) => sum + row.runs, 0)).toBe(7)
    expect(rows.map((row) => row.month)).not.toContain("2026-11")
  })

  it("la ventana se aplica en SQL: lo anterior a `since` no llega", async () => {
    const wide = await service.summarizeInspectionComplianceTrend(accessOf(ALL), {}, { since: "2025-01-01" })
    expect(wide.map((row) => row.month)).toContain("2025-03")
    const narrow = await service.summarizeInspectionComplianceTrend(accessOf(ALL), {}, { since: "2026-09-01" })
    expect(narrow.map((row) => row.month)).not.toContain("2025-03")
  })

  it("el mes es el civil chileno: el 31 de agosto a las 22:00 es de agosto", async () => {
    const rows = await service.summarizeInspectionComplianceTrend(accessOf(ONLY_A), {}, { since: SINCE })
    expect(byMonth(rows)["2026-08"]).toMatchObject({ runs: 1, scoredItems: 8 })
  })

  it("cuenta los hallazgos abiertos y, aparte, los altos o críticos; los cerrados no cuentan", async () => {
    const rows = await service.summarizeInspectionComplianceTrend(accessOf(ONLY_A), {}, { since: SINCE })
    // alto + medio abiertos; el crítico está cerrado. El crítico de la faena B no es de este alcance.
    expect(byMonth(rows)["2026-09"]).toMatchObject({ openFindings: 2, criticalOpenFindings: 1 })
    expect(byMonth(rows)["2026-10"]).toMatchObject({ openFindings: 0, criticalOpenFindings: 0 })
  })
})

describe("universo de los KPI", () => {
  it("el estado y la vista rápida no acotan la serie", async () => {
    const all = await service.summarizeInspectionComplianceTrend(accessOf(ONLY_A), {}, { since: SINCE })
    const reviewedOnly = await service.summarizeInspectionComplianceTrend(accessOf(ONLY_A), { status: "reviewed" }, { since: SINCE })
    const critical = await service.summarizeInspectionComplianceTrend(accessOf(ONLY_A), { view: "critical" }, { since: SINCE })
    expect(reviewedOnly).toEqual(all)
    expect(critical).toEqual(all)
  })

  it("el rango de ejecución del usuario sí acota la serie", async () => {
    const rows = await service.summarizeInspectionComplianceTrend(accessOf(ONLY_A), { executedFrom: "2026-10-01" }, { since: SINCE })
    expect(rows.map((row) => row.month)).toEqual(["2026-10"])
  })
})
