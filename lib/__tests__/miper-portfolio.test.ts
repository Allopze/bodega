/**
 * Fase B: la portada por faena (`listMiperPortfolio`) y la lista del selector
 * de faena (`listMiperWorksiteTargets`).
 *
 * Faenas sembradas:
 * - A (activa):
 *   - vigente 2026 con observaciones y un programa (1 de 2 ocurrencias hechas).
 *     Cuatro Intolerables: tres «sin control» (sin medida; implementada sin
 *     vínculo PDTP; implementada con su único vínculo `risk_control` inactivo) y
 *     uno cubierto (verificada y con vínculo PDTP activo), que NO cuenta;
 *   - borrador 2027: un Importante incompleto y dos Intolerables completos, uno
 *     con su medida en una actividad viva del programa y otro sólo en una
 *     retirada. Completos: 1 de 3.
 * - B (activa): borrador en revisión, enviado por quien también puede revisar,
 *   con un Intolerable sin medida que no cuenta (no es vigente).
 * - C (activa): sin MIPER, con 3 trabajadores activos y 1 inactivo.
 * - D (cerrada): MIPER vigente de la metodología anterior con un riesgo crítico legacy.
 * - E (cerrada): sin MIPER. No aparece.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { checkMiperCompleteness } from "@/lib/prevention/miper/completeness"
import { RE04_METHODOLOGY } from "@/lib/prevention/miper/methodology"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const { saveMiperEntry, saveMiperControl } = await import("@/lib/services/miper/entries")
const { getMiperWorkspace } = await import("@/lib/services/miper/queries")
const { listMiperPortfolio, listMiperWorksiteTargets } = await import("@/lib/services/miper/portfolio")
const { getRiskDashboard } = await import("@/lib/services/prevention-risk-legal")

const all = { mode: "all" as const, ids: [] as [] }
const prevencion = { userId: "u-prev", scope: all, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const jefa = { userId: "u-jefa", scope: all, permissions: ["prevention:risk:view", "prevention:risk:review"] }
/** Edita y revisa. Envió la ronda de la Faena B, así que no puede revisarla. */
const doble = { userId: "u-doble", scope: all, permissions: ["prevention:risk:view", "prevention:risk:edit", "prevention:risk:review"] }
const acotada = { userId: "u-prev", scope: { mode: "some" as const, ids: ["ws-a"] }, permissions: ["prevention:risk:view"] }

let vigenteA = ""
let borradorA = ""
let revisionB = ""
const legacyD = "riskmatrix-legacy-d"
const rowOf = async (access: typeof prevencion, worksiteId: string) => (await listMiperPortfolio(access)).rows.find((row) => row.worksiteId === worksiteId)!

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([
    { id: "ws-a", name: "Faena A", code: "A" },
    { id: "ws-b", name: "Faena B", code: "B" },
    { id: "ws-c", name: "Faena C", code: "C" },
    { id: "ws-d", name: "Faena D", code: "D", isActive: false },
    { id: "ws-e", name: "Faena E", code: "E", isActive: false },
  ])
  await testDb.insert(schema.users).values([
    { id: "u-prev", name: "Prevencionista A", email: "prev@p.cl", hashedPassword: "x", isActive: true },
    { id: "u-jefa", name: "Jefa Prevención", email: "jefa@p.cl", hashedPassword: "x", isActive: true },
    { id: "u-doble", name: "Doble Rol", email: "doble@p.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.workers).values([
    { id: "w-c1", firstName: "Uno", lastName: "C", worksiteId: "ws-c" },
    { id: "w-c2", firstName: "Dos", lastName: "C", worksiteId: "ws-c" },
    { id: "w-c3", firstName: "Tres", lastName: "C", worksiteId: "ws-c" },
    { id: "w-c4", firstName: "Cuatro", lastName: "C", worksiteId: "ws-c", isActive: false },
  ])
  const now = new Date().toISOString()
  // Una actividad del PDTP a la que se vinculan (o no) las medidas de los riesgos críticos.
  await testDb.insert(schema.pdtpPrograms).values({
    id: "pdtp-2026", year: 2026, version: 1, title: "PDTP 2026 portada", status: "active", appliesToAllWorksites: true,
    periodStart: "2026-01-01", periodEnd: "2026-12-31", elaboratedByName: "Prevencionista A", elaboratedByTitle: "Prevención",
    createdAt: now, updatedAt: now,
  })
  await testDb.insert(schema.pdtpActivities).values({
    id: "pdtp-act-1", programId: "pdtp-2026", n: 1, displayOrder: 1, status: "active",
    activity: "Control de riesgos críticos", program: "Riesgos críticos", responsibleSlugs: ["prf"], responsibleDisplay: "Prevencionista",
    scheduleMode: "scheduled", mechanism: "constancia", sourceSheetRow: 1, createdAt: now, updatedAt: now,
  })

  // ── Faena A: vigente 2026 con observaciones y su programa, y el borrador 2027 ──
  vigenteA = (await createMiper({ worksiteId: "ws-a", period: 2026, revisionReason: "Período vigente de la portada." }, prevencion)).id
  await saveMiperEntry({ matrixId: vigenteA, values: { hazard: "Caída de altura", probability: 4, consequence: 4 } }, prevencion)
  const conMedida = await saveMiperEntry({ matrixId: vigenteA, values: { hazard: "Atrapamiento", probability: 4, consequence: 4 } }, prevencion)
  const medida = await saveMiperControl({ matrixId: vigenteA, entryId: conMedida.id, values: { hierarchy: "engineering", description: "Guarda fija", responsibleUserId: "u-prev", dueDate: "2026-12-31" } }, prevencion)
  // Implementada pero sin vínculo PDTP: sigue «sin control» (le falta una de las dos cosas).
  await testDb.update(schema.preventionRiskControls).set({ status: "implemented" }).where(eq(schema.preventionRiskControls.id, medida.id))
  await saveMiperEntry({ matrixId: vigenteA, values: { hazard: "Ruido", probability: 1, consequence: 2 } }, prevencion)
  // Cubierto: medida verificada Y con vínculo PDTP `risk_control` activo. Es el único que NO cuenta «sin control».
  const cubierto = await saveMiperEntry({ matrixId: vigenteA, values: { hazard: "Contacto eléctrico", probability: 4, consequence: 4 } }, prevencion)
  const medidaCubierta = await saveMiperControl({ matrixId: vigenteA, entryId: cubierto.id, values: { hierarchy: "engineering", description: "Bloqueo y etiquetado", responsibleUserId: "u-prev", dueDate: "2026-12-31" } }, prevencion)
  // Implementada, pero su único vínculo `risk_control` está inactivo: SÍ cuenta «sin control».
  const vinculoInactivo = await saveMiperEntry({ matrixId: vigenteA, values: { hazard: "Proyección de partículas", probability: 4, consequence: 4 } }, prevencion)
  const medidaVinculoInactivo = await saveMiperControl({ matrixId: vigenteA, entryId: vinculoInactivo.id, values: { hierarchy: "engineering", description: "Pantalla protectora", responsibleUserId: "u-prev", dueDate: "2026-12-31" } }, prevencion)
  await testDb.update(schema.preventionRiskControls).set({ status: "verified" }).where(eq(schema.preventionRiskControls.id, medidaCubierta.id))
  await testDb.update(schema.preventionRiskControls).set({ status: "implemented" }).where(eq(schema.preventionRiskControls.id, medidaVinculoInactivo.id))
  const pdtpLink = { activityId: "pdtp-act-1", worksiteId: "ws-a", sourceVersionSnapshot: "1", justification: "Medida de un riesgo crítico en el PDTP.", createdByUserId: "u-prev" }
  await testDb.insert(schema.preventionPdtpSourceLinks).values([
    { ...pdtpLink, id: "pdtp-link-activo", sourceType: "risk_control", sourceId: medidaCubierta.id },
    { ...pdtpLink, id: "pdtp-link-inactivo", sourceType: "risk_control", sourceId: medidaVinculoInactivo.id, isActive: false, retiredByUserId: "u-prev", retiredAt: now, retirementReason: "Actividad reemplazada en el PDTP." },
    // Activos, pero de otro tipo: que el id coincida con el de una medida implementada no la cubre. Son
    // dos (y el cubierto, uno) para que filtrar por el tipo equivocado no dé la misma cifra por compensación.
    { ...pdtpLink, id: "pdtp-link-otro-tipo-1", sourceType: "legal_requirement", sourceId: medidaVinculoInactivo.id },
    { ...pdtpLink, id: "pdtp-link-otro-tipo-2", sourceType: "legal_requirement", sourceId: medida.id },
  ])
  await testDb.update(schema.preventionRiskMatrices)
    .set({ status: "published", reviewState: "observed", publishedAt: new Date().toISOString(), reviewedByUserId: "u-jefa", approvedByUserId: "u-jefa" })
    .where(eq(schema.preventionRiskMatrices.id, vigenteA))
  await testDb.insert(schema.preventionRiskPrograms).values({ id: "prog-a", matrixId: vigenteA, worksiteId: "ws-a", period: 2026, createdByUserId: "u-prev" })
  await testDb.insert(schema.preventionRiskProgramActions).values({ id: "act-a1", programId: "prog-a", actionNumber: 1, description: "Inspección de guardas", scheduleKind: "monthly", startsOn: "2024-01-01", createdByUserId: "u-prev" })
  await testDb.insert(schema.preventionRiskProgramOccurrences).values([
    { id: "occ-hecha", actionId: "act-a1", dueOn: "2024-01-31", outcome: "done" },
    { id: "occ-pendiente", actionId: "act-a1", dueOn: "2024-02-29", outcome: "pending" },
  ])
  borradorA = (await createMiper({ worksiteId: "ws-a", period: 2027, revisionReason: "Período siguiente de la portada." }, prevencion)).id
  await saveMiperEntry({ matrixId: borradorA, values: { hazard: "Volcamiento", probability: 2, consequence: 4 } }, prevencion)
  // Dos Intolerables completos en todo menos, quizá, el vínculo al programa: cuenta como completo sólo
  // el que tiene su medida en una actividad VIVA (`status = 'active'`), no el que la tiene en una retirada.
  const completo = {
    activity: "Mantención", task: "Cambio de neumático", position: "Mecánico", riskFactorId: "riskfactor-mecanico",
    risk: "Aplastamiento", probableDamage: "Amputación", controlledStatus: "partial", isRoutine: true, probability: 4, consequence: 4,
  } as const
  const enActividadViva = await saveMiperEntry({ matrixId: borradorA, values: { ...completo, hazard: "Neumático presurizado" } }, prevencion)
  const medidaViva = await saveMiperControl({ matrixId: borradorA, entryId: enActividadViva.id, values: { hierarchy: "engineering", description: "Jaula de inflado", responsibleUserId: "u-prev", dueDate: "2027-06-30" } }, prevencion)
  const enActividadRetirada = await saveMiperEntry({ matrixId: borradorA, values: { ...completo, hazard: "Gata hidráulica" } }, prevencion)
  const medidaRetirada = await saveMiperControl({ matrixId: borradorA, entryId: enActividadRetirada.id, values: { hierarchy: "engineering", description: "Soportes fijos", responsibleUserId: "u-prev", dueDate: "2027-06-30" } }, prevencion)
  await testDb.insert(schema.preventionRiskPrograms).values({ id: "prog-a27", matrixId: borradorA, worksiteId: "ws-a", period: 2027, createdByUserId: "u-prev" })
  await testDb.insert(schema.preventionRiskProgramActions).values([
    { id: "act-a27-viva", programId: "prog-a27", actionNumber: 1, description: "Inflado en jaula", scheduleKind: "monthly", startsOn: "2027-01-01", createdByUserId: "u-prev" },
    { id: "act-a27-retirada", programId: "prog-a27", actionNumber: 2, description: "Revisión de soportes", scheduleKind: "monthly", startsOn: "2027-01-01", status: "retired", retiredAt: now, retiredReason: "Actividad fusionada con otra del programa.", createdByUserId: "u-prev" },
  ])
  await testDb.insert(schema.preventionRiskProgramActionControls).values([
    { id: "pac-a27-viva", actionId: "act-a27-viva", controlId: medidaViva.id, linkedByUserId: "u-prev" },
    { id: "pac-a27-retirada", actionId: "act-a27-retirada", controlId: medidaRetirada.id, linkedByUserId: "u-prev" },
  ])

  // ── Faena B: borrador en revisión, enviado por quien también revisa ──
  revisionB = (await createMiper({ worksiteId: "ws-b", period: 2026, revisionReason: "Período en revisión de la portada." }, prevencion)).id
  await saveMiperEntry({ matrixId: revisionB, values: { hazard: "Polvo", probability: 2, consequence: 2 } }, prevencion)
  // Intolerable sin medida en una MIPER que no es vigente: no cuenta «sin control» (ni acá ni en el tablero).
  await saveMiperEntry({ matrixId: revisionB, values: { hazard: "Atropello", probability: 4, consequence: 4 } }, prevencion)
  await testDb.update(schema.preventionRiskMatrices).set({ reviewState: "in_review" }).where(eq(schema.preventionRiskMatrices.id, revisionB))
  await testDb.insert(schema.preventionRiskReviewRounds).values({ id: "round-b", matrixId: revisionB, roundNumber: 1, stage: "technical", snapshot: { header: {}, entries: [] }, snapshotSha256: "b".repeat(64), submittedByUserId: "u-doble" })

  // ── Faena D: cerrada, con su MIPER vigente de la metodología anterior ──
  await testDb.insert(schema.preventionRiskMatrices).values({
    id: legacyD, worksiteId: "ws-d", matrixVersion: 1, title: "MIPER legacy D", status: "published", isLegacy: true,
    methodologyId: RE04_METHODOLOGY.id, methodologySnapshot: {}, revisionReason: "MIPER de la metodología anterior.",
    participationSummary: "Participación de la metodología anterior.", consultationEvidenceReference: "Acta anterior",
    createdByUserId: "u-prev", reviewedByUserId: "u-jefa", approvedByUserId: "u-jefa", publishedAt: new Date().toISOString(),
  })
  await testDb.insert(schema.preventionRiskEntries).values({ id: "entry-legacy-d", matrixId: legacyD, hazardCode: "HAZ-D", hazard: "Explosión", isCritical: true })
}, 60_000)

describe("portada de la MIPER por faena (listMiperPortfolio)", () => {
  it("una fila por faena en alcance: las activas y las cerradas con MIPER; las cerradas sin MIPER no", async () => {
    const { rows } = await listMiperPortfolio(prevencion)
    expect(rows.map((row) => row.worksiteName)).toEqual(["Faena A", "Faena B", "Faena C", "Faena D"])
    expect(rows.map((row) => row.id)).toEqual(rows.map((row) => row.worksiteId))
  })

  it("la faena sin MIPER viene con matrix nulo, «Sin MIPER» y la dotación de sus trabajadores activos", async () => {
    expect(await rowOf(prevencion, "ws-c")).toMatchObject({
      matrix: null, vigente: null, status: "sin_miper", stateLabel: "Sin MIPER", headcount: 3, headcountSource: "trabajadores",
      updatedAt: null, completeness: null, programProgress: null, requiresMyAction: false, myActions: [], criticalWithoutControl: 0,
    })
  })

  it("con dos MIPER no reemplazadas, la fila es la de mayor período y la vigente va aparte", async () => {
    const a = await rowOf(prevencion, "ws-a")
    expect(a.matrix).toMatchObject({ id: borradorA, period: 2027, isLegacy: false })
    expect(a.vigente).toMatchObject({ id: vigenteA, period: 2026, isLegacy: false })
    expect(a).toMatchObject({ status: "borrador", stateLabel: "Borrador", importantCount: 1, intolerableCount: 2, headcountSource: "ficha" })
  })

  it("«sin control» y el avance del programa son de la vigente", async () => {
    const a = await rowOf(prevencion, "ws-a")
    expect(a.criticalWithoutControl).toBe(3)
    expect(a.programProgress).toMatchObject({ done: 1, planned: 2, ratio: 0.5 })
  })

  it("la completitud es la misma que cuenta el espacio de trabajo («Completos x de y»)", async () => {
    const a = await rowOf(prevencion, "ws-a")
    const ws = await getMiperWorkspace(borradorA, prevencion)
    const linked = new Set(ws.controlActionLinks.map((link) => link.controlId))
    const incomplete = new Set(checkMiperCompleteness(ws.snapshot, { linkedControlIds: linked, requireProgramLink: true })
      .flatMap((issue) => (issue.severity === "error" && issue.entryId ? [issue.entryId] : [])))
    // El espacio de trabajo sólo trae los vínculos a actividades vivas: la del programa retirada no está.
    expect(linked.size).toBe(1)
    expect(a.completeness).toEqual({ complete: ws.snapshot.entries.length - incomplete.size, total: ws.snapshot.entries.length })
    // Completo sólo el Intolerable con su medida en la actividad viva; el de la retirada y el Importante, no.
    expect(a.completeness).toEqual({ complete: 1, total: 3 })
  })

  it("la MIPER de la metodología anterior no tiene cifra de completitud y su crítico legacy cuenta «sin control»", async () => {
    const d = await rowOf(prevencion, "ws-d")
    expect(d).toMatchObject({ worksiteActive: false, status: "vigente", stateLabel: "Vigente · metodología anterior", completeness: null, criticalWithoutControl: 1 })
    expect(d.matrix).toMatchObject({ id: legacyD, isLegacy: true })
  })

  it("«Riesgos críticos sin control» suma lo mismo que el KPI del tablero (una sola definición)", async () => {
    const { rows } = await listMiperPortfolio(prevencion)
    const dashboard = await getRiskDashboard(prevencion)
    expect(rows.reduce((total, row) => total + row.criticalWithoutControl, 0)).toBe(dashboard.criticalBlockers.length)
    expect(dashboard.criticalBlockers.length).toBe(4)
    // Y faena por faena, no sólo en el total: B (Intolerable sin medida, pero en revisión) es 0 en las dos.
    const worksiteOf = new Map(dashboard.matrices.map((matrix) => [matrix.id, matrix.worksiteId]))
    const dashboardByWorksite = Object.fromEntries(rows.map((row) => [row.worksiteId,
      dashboard.criticalBlockers.filter(({ entry }) => worksiteOf.get(entry.matrixId) === row.worksiteId).length]))
    expect(Object.fromEntries(rows.map((row) => [row.worksiteId, row.criticalWithoutControl]))).toEqual(dashboardByWorksite)
    expect(dashboardByWorksite).toEqual({ "ws-a": 3, "ws-b": 0, "ws-c": 0, "ws-d": 1 })
  })

  it("«requiere mi acción» mira todas las MIPER no reemplazadas de la faena, no sólo la de la fila", async () => {
    const a = await rowOf(prevencion, "ws-a")
    expect(a.requiresMyAction).toBe(true)
    expect(a.myActions).toEqual([
      { matrixId: borradorA, period: 2027, reason: "Borrador" },
      { matrixId: vigenteA, period: 2026, reason: "Con observaciones" },
    ])
  })

  it("quien envió la ronda no tiene «Pendiente de tu revisión» aunque pueda revisar; la Jefa sí", async () => {
    const deLaJefa = await rowOf(jefa, "ws-b")
    expect(deLaJefa).toMatchObject({ status: "en_revision", requiresMyAction: true, submittedByName: "Doble Rol" })
    expect(deLaJefa.myActions).toEqual([{ matrixId: revisionB, period: 2026, reason: "Pendiente de tu revisión" }])
    const deQuienEnvio = await rowOf(doble, "ws-b")
    expect(deQuienEnvio.myActions).toEqual([])
    expect(deQuienEnvio.requiresMyAction).toBe(false)
  })

  it("respeta el alcance y exige el permiso de vista", async () => {
    expect((await listMiperPortfolio(acotada)).rows.map((row) => row.worksiteId)).toEqual(["ws-a"])
    await expect(listMiperPortfolio({ ...acotada, permissions: [] })).rejects.toThrow(/fuera de alcance/)
  })

  it("el selector de faena trae la misma MIPER principal por faena", async () => {
    expect(await listMiperWorksiteTargets(prevencion)).toEqual([
      { worksiteId: "ws-a", worksiteName: "Faena A", matrixId: borradorA, period: 2027 },
      { worksiteId: "ws-b", worksiteName: "Faena B", matrixId: revisionB, period: 2026 },
      { worksiteId: "ws-c", worksiteName: "Faena C", matrixId: null, period: null },
      { worksiteId: "ws-d", worksiteName: "Faena D", matrixId: legacyD, period: null },
    ])
    expect((await listMiperWorksiteTargets(acotada)).map((target) => target.worksiteId)).toEqual(["ws-a"])
    await expect(listMiperWorksiteTargets({ ...acotada, permissions: [] })).rejects.toThrow(/fuera de alcance/)
  })
})
