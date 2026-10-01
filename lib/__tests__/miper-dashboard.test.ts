/**
 * Task 1 de la F3: la consulta del Resumen del MIPER (§8.6).
 *
 * Base sembrada con dos faenas: una con matriz `published` (las cuatro bandas,
 * una fila sin controlar) con programa y ocurrencias —una realizada, una
 * pendiente y vencida—, y otra en revisión sin programa.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const { saveMiperEntry, saveMiperControl } = await import("@/lib/services/miper/entries")
const { listMiperInbox } = await import("@/lib/services/miper/queries")
const { getMiperDashboard } = await import("@/lib/services/miper/dashboard")

const prevencion = { userId: "u-prev", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const jefa = { userId: "u-jefa", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:view", "prevention:risk:review"] }

let matrixA = ""
let matrixB = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([
    { id: "ws-a", name: "Faena A", code: "A" },
    { id: "ws-b", name: "Faena B", code: "B" },
  ])
  await testDb.insert(schema.users).values([
    { id: "u-prev", name: "Prevencionista A", email: "prev@a.cl", hashedPassword: "x", isActive: true },
    { id: "u-jefa", name: "Jefa Prevención", email: "jefa@a.cl", hashedPassword: "x", isActive: true },
    { id: "u-ejec", name: "Ejecutor Programa", email: "ejec@a.cl", hashedPassword: "x", isActive: true },
  ])

  // ── Faena A: matriz vigente, las cuatro bandas y una fila sin controlar ──
  matrixA = (await createMiper({ worksiteId: "ws-a", period: 2026, revisionReason: "Período para probar el tablero." }, prevencion)).id
  await saveMiperEntry({ matrixId: matrixA, values: { hazard: "Ruido bajo", probability: 1, consequence: 2 } }, prevencion)
  await saveMiperEntry({ matrixId: matrixA, values: { hazard: "Ruido", probability: 2, consequence: 2 } }, prevencion)
  const important = await saveMiperEntry({ matrixId: matrixA, values: { hazard: "Volcamiento de camión", probability: 2, consequence: 4, controlledStatus: "no" } }, prevencion)
  await saveMiperEntry({ matrixId: matrixA, values: { hazard: "Caída de altura", probability: 4, consequence: 4 } }, prevencion)
  await saveMiperControl({ matrixId: matrixA, entryId: important.id, values: { hierarchy: "engineering", description: "Topes de descarga", responsibleUserId: "u-prev", dueDate: "2026-11-30" } }, prevencion)
  // Sellado directo: el CHECK exige revisor y aprobador para una matriz vigente.
  await testDb.update(schema.preventionRiskMatrices)
    .set({ status: "published", publishedAt: new Date().toISOString(), reviewedByUserId: "u-jefa", approvedByUserId: "u-jefa" })
    .where(eq(schema.preventionRiskMatrices.id, matrixA))

  // Programa RE-04.1: una actividad con una ocurrencia realizada y una vencida.
  await testDb.insert(schema.preventionRiskPrograms).values({ id: "prog-a", matrixId: matrixA, worksiteId: "ws-a", period: 2026, createdByUserId: "u-prev" })
  await testDb.insert(schema.preventionRiskProgramActions).values({ id: "act-a1", programId: "prog-a", actionNumber: 1, description: "Inspección mensual de topes", scheduleKind: "monthly", startsOn: "2024-01-01", responsibleUserId: "u-ejec", createdByUserId: "u-prev" })
  await testDb.insert(schema.preventionRiskProgramOccurrences).values([
    { id: "occ-hecha", actionId: "act-a1", dueOn: "2024-01-31", outcome: "done" },
    { id: "occ-vencida", actionId: "act-a1", dueOn: "2024-02-29", outcome: "pending" },
  ])

  // ── Faena B: matriz en revisión, sin programa ──
  matrixB = (await createMiper({ worksiteId: "ws-b", period: 2026, revisionReason: "Período para probar el tablero." }, prevencion)).id
  const moderateB = await saveMiperEntry({ matrixId: matrixB, values: { hazard: "Caída de objetos", probability: 2, consequence: 2 } }, prevencion)
  await saveMiperControl({ matrixId: matrixB, entryId: moderateB.id, values: { hierarchy: "administrative", description: "Delimitar la zona de izaje", responsibleUserId: "u-jefa", dueDate: "2026-12-31" } }, prevencion)
  await testDb.update(schema.preventionRiskMatrices).set({ reviewState: "in_review" }).where(eq(schema.preventionRiskMatrices.id, matrixB))
}, 60_000)

const tile = (dashboard: Awaited<ReturnType<typeof getMiperDashboard>>, key: string) => dashboard.tiles.find((candidate) => candidate.key === key)!

describe("tablero del MIPER", () => {
  it("los cuatro tiles cuentan lo que dice la §8.6 y llevan a su lista filtrada", async () => {
    const dash = await getMiperDashboard(prevencion)
    expect(dash.tiles).toHaveLength(4)
    expect(dash.tiles.map((candidate) => candidate.key)).toEqual(["todo", "critical", "uncontrolled", "progress"])
    // Regla A1: accionables, no cajas de número suelto.
    expect(dash.tiles.every((candidate) => candidate.href.startsWith("?tab="))).toBe(true)
    expect(tile(dash, "critical").count).toBe(2)
    expect(tile(dash, "critical").href).toContain("clasificacion=")
    expect(tile(dash, "uncontrolled").count).toBe(1)
    expect(tile(dash, "uncontrolled").href).toContain("control=no")
    expect(tile(dash, "todo").href).toContain("tab=porhacer")
    expect(tile(dash, "progress").count).toBe(1)
    expect(tile(dash, "progress").hint).toContain("1 de 2")
  })

  it("la franja secundaria sale de los mismos datos", async () => {
    const dash = await getMiperDashboard(prevencion)
    expect(dash.strip).toEqual({ vigentes: 1, conObservaciones: 0, tolerables: 1, moderados: 2, medidasPendientes: 2, actividadesVencidas: 1 })
  })

  it("la tabla por faena deriva el avance con programProgress", async () => {
    const dash = await getMiperDashboard(prevencion)
    expect(dash.rows.map((row) => row.worksiteName)).toEqual(["Faena A", "Faena B"])
    expect(dash.rows[0]!.stateLabel).toContain("Vigente")
    expect(dash.rows[0]!.progress).toMatchObject({ done: 1, pending: 1, overdue: 1, planned: 2, ratio: 0.5 })
    expect(dash.rows[0]!.uncontrolledCount).toBe(1)
    expect(dash.rows[0]!.classificationCounts).toMatchObject({ tolerable: 1, moderate: 1, important: 1, intolerable: 1 })
    // Sin programa no se inventa avance: no hay columna que leer.
    expect(dash.rows[1]!.progress).toMatchObject({ planned: 0, done: 0, ratio: null })
    expect(dash.rows[1]!.uncontrolledCount).toBe(0)
    expect(dash.rows[0]!.alertCount).toBe(3)
    expect(dash.rows[1]!.alertCount).toBe(0)
  })

  it("el filtro por responsable es la unión de actividades y medidas", async () => {
    const soloEjecutor = await getMiperDashboard(prevencion, { responsibleUserId: "u-ejec" })
    expect(soloEjecutor.rows.map((row) => row.matrixId)).toEqual([matrixA])
    const soloJefa = await getMiperDashboard(prevencion, { responsibleUserId: "u-jefa" })
    expect(soloJefa.rows.map((row) => row.matrixId)).toEqual([matrixB])
    // La misma persona puede ser responsable por una medida, no por una actividad.
    expect((await getMiperDashboard(prevencion, { responsibleUserId: "u-prev" })).rows.map((row) => row.matrixId)).toEqual([matrixA])
    // Los conteos siguen al filtro: la faena B no tiene Intolerables/Importantes.
    expect(tile(soloJefa, "critical").count).toBe(0)
    expect(soloJefa.strip.vigentes).toBe(0)
    // Las opciones del filtro no se vacían al elegir una: salen de lo listado.
    expect(soloJefa.responsibleOptions.map((option) => option.id)).toEqual(["u-ejec", "u-jefa", "u-prev"])
  })

  it("los filtros de la lista (faena, período, estado) acotan el tablero", async () => {
    const faenaB = await getMiperDashboard(prevencion, { worksiteId: "ws-b" })
    expect(faenaB.rows.map((row) => row.matrixId)).toEqual([matrixB])
    expect(tile(faenaB, "uncontrolled").count).toBe(0)
    expect(await getMiperDashboard(prevencion, { period: 2025 })).toMatchObject({ rows: [] })
    const vigentes = await getMiperDashboard(prevencion, { state: "published" })
    expect(vigentes.rows.map((row) => row.matrixId)).toEqual([matrixA])
  })

  it("el tile «Por hacer» dice lo mismo que la bandeja", async () => {
    const dash = await getMiperDashboard(jefa)
    expect(tile(dash, "todo").count).toBe((await listMiperInbox(jefa)).length)
    expect(tile(dash, "todo").count).toBe(1)
  })

  it("fuera de alcance no se ve nada y sin permiso de vista se rechaza", async () => {
    const ajena = { userId: "u-otra", scope: { mode: "some" as const, ids: ["ws-z"] }, permissions: ["prevention:risk:view"] }
    const dash = await getMiperDashboard(ajena)
    expect(dash.rows).toEqual([])
    expect(dash.tiles.map((candidate) => candidate.count)).toEqual([0, 0, 0, 0])
    expect(dash.strip).toEqual({ vigentes: 0, conObservaciones: 0, tolerables: 0, moderados: 0, medidasPendientes: 0, actividadesVencidas: 0 })
    await expect(getMiperDashboard({ ...ajena, permissions: [] })).rejects.toThrow(/fuera de alcance/)
  })
})
