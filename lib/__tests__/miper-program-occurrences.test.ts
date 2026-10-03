/**
 * Ciclo de vida de las ocurrencias (F2, Task 5): nada se ejecuta en borrador,
 * la primera versión sellada las genera, mover la fecha programada agrega las
 * nuevas sin borrar las anteriores y el período siguiente supersede las
 * pendientes dejando intacto lo ya registrado (§7.4).
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
const accredit = vi.fn()
vi.mock("@/lib/services/pdtp-adapters/pdtp-accreditation-connectors", () => ({ onRiskMatrixPublished: (...args: unknown[]) => accredit(...args) }))

const { createMiper, updateMiperHeader } = await import("@/lib/services/miper/matrices")
const entries = await import("@/lib/services/miper/entries")
const wf = await import("@/lib/services/miper/workflow")
const program = await import("@/lib/services/miper/program")
const execution = await import("@/lib/services/miper/program-execution")
const { getProgramWorkspace } = await import("@/lib/services/miper/program-queries")

const WS = "ws-occ"
const scope = { mode: "some" as const, ids: [WS] }
const all = { mode: "all" as const, ids: [] as [] }
const author = { userId: "u-occ", scope, permissions: ["prevention:risk:view", "prevention:risk:edit", "prevention:risk:program:execute"] }
const jefa = { userId: "u-jefa-occ", scope: all, permissions: ["prevention:risk:view", "prevention:risk:review", "prevention:risk:edit"] }
const legal = { userId: "u-legal-occ", scope: all, permissions: ["prevention:risk:view", "prevention:risk:approve_legal"] }

const matrixRow = async (id: string) => (await testDb.select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, id)))[0]!

/** MIPER completo y enviable: encabezado RE-04, una fila Importante y su medida. */
async function completeMatrix(period: number) {
  const { id } = await createMiper({ worksiteId: WS, period, revisionReason: "Elaboración para probar las ocurrencias." }, author)
  const m = await matrixRow(id)
  await updateMiperHeader({
    matrixId: id, expectedVersion: m.version, iperCode: "RE-04", elaboratedOn: `${period}-01-10`, updatedOn: null,
    companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero", economicActivity: "Transporte",
    adherentNumber: null, worksiteName: "Faena Ocurrencias", siteRepresentativeUserId: null, siteRepresentativeName: "Juan Pérez",
    headcountTotal: 3, headcountMale: 2, headcountFemale: 1, headcountOther: 0, participationSummary: "", consultationEvidenceReference: "",
  }, author)
  const entry = await entries.saveMiperEntry({
    matrixId: id,
    values: { activity: "Transporte", task: "Descarga", position: "Conductor", riskFactorId: "riskfactor-mecanico", hazard: "Camión en pendiente", risk: "Volcamiento", probableDamage: "Politraumatismo", probability: 2, consequence: 4, controlledStatus: "partial", isRoutine: true },
  }, author)
  const control = await entries.saveMiperControl({
    matrixId: id, entryId: entry.id, values: { hierarchy: "administrative", description: "Procedimiento de descarga en pendiente", responsibleName: "Supervisor", dueDate: `${period}-06-30` },
  }, author)
  return { id, entryId: entry.id, entryVersion: entry.version, controlId: control.id }
}

async function seal(matrixId: string, changeSummary: string) {
  let m = await matrixRow(matrixId)
  await wf.submitMiperForReview({ matrixId, expectedVersion: m.version }, author)
  m = await matrixRow(matrixId)
  await wf.approveMiperTechnicalReview({ matrixId, expectedVersion: m.version }, jefa)
  m = await matrixRow(matrixId)
  await wf.approveMiperFinal({ matrixId, expectedVersion: m.version, changeSummary }, legal)
}

const occurrenceRows = (actionId: string) => testDb.select().from(schema.preventionRiskProgramOccurrences)
  .where(eq(schema.preventionRiskProgramOccurrences.actionId, actionId))
const actionRow = async (matrixId: string) => {
  const [programRow] = await testDb.select().from(schema.preventionRiskPrograms).where(eq(schema.preventionRiskPrograms.matrixId, matrixId))
  const [action] = await testDb.select().from(schema.preventionRiskProgramActions).where(eq(schema.preventionRiskProgramActions.programId, programRow!.id))
  return action!
}

let matrix2026 = ""
let matrix2027 = ""
let entryId2026 = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Ocurrencias", code: "OCC" })
  await testDb.insert(schema.users).values([
    { id: "u-occ", name: "Prevencionista", email: "occ@occ.cl", hashedPassword: "x", isActive: true },
    { id: "u-jefa-occ", name: "Jefa Prevención", email: "jefa@occ.cl", hashedPassword: "x", isActive: true },
    { id: "u-legal-occ", name: "Legal y RRHH", email: "legal@occ.cl", hashedPassword: "x", isActive: true },
  ])
}, 60_000)

describe("ocurrencias del programa ligadas al ciclo de vida del MIPER", () => {
  it("el borrador tiene la actividad pero cero ocurrencias; la primera versión sellada las genera", async () => {
    const matrix = await completeMatrix(2026)
    matrix2026 = matrix.id
    entryId2026 = matrix.entryId

    const action = await program.saveProgramAction({ matrixId: matrix2026, description: "Inspección trimestral de extintores", scheduleKind: "quarterly", startsOn: "2026-03-01" }, author)
    expect(await occurrenceRows(action.id)).toHaveLength(0)

    await seal(matrix2026, "Emisión inicial del período 2026.")
    const occurrences = await occurrenceRows(action.id)
    expect(occurrences.map((row) => row.dueOn)).toEqual(["2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"])
    expect(occurrences.every((row) => row.outcome === "pending")).toBe(true)
  })

  it("mover la fecha programada hacia adelante crea las nuevas y conserva las ya generadas", async () => {
    const action = await actionRow(matrix2026)
    expect(action.actionNumber).toBe(1)

    // En un MIPER vigente la edición re-sincroniza las ocurrencias al instante.
    await program.saveProgramAction({
      matrixId: matrix2026, actionId: action.id, expectedVersion: action.version,
      description: "Inspección mensual de extintores", scheduleKind: "monthly", startsOn: "2026-05-01",
    }, author)

    const dueOn = (await occurrenceRows(action.id)).map((row) => row.dueOn)
    expect(dueOn).toContain("2026-03-31") // las ya generadas no se borran
    expect(dueOn).toContain("2026-05-31") // las nuevas se crean
    expect(dueOn).toContain("2026-11-30")
    expect(new Set(dueOn).size).toBe(dueOn.length)
    expect(dueOn).toHaveLength(9)
  })

  it("un segundo sellado no duplica las ocurrencias existentes", async () => {
    const [entry] = await testDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, entryId2026))
    await entries.saveMiperEntry({ matrixId: matrix2026, entryId: entryId2026, expectedVersion: entry!.version, values: { risk: "Volcamiento del camión en la pendiente" } }, author)
    await seal(matrix2026, "Actualización del riesgo de la fila 1.")
    const action = await actionRow(matrix2026)
    expect(await occurrenceRows(action.id)).toHaveLength(9)
  })

  it("el período siguiente supersede las pendientes y lo ya registrado sigue contando", async () => {
    const action = await actionRow(matrix2026)
    const [overdue] = await testDb.select().from(schema.preventionRiskProgramOccurrences)
      .where(and(eq(schema.preventionRiskProgramOccurrences.actionId, action.id), eq(schema.preventionRiskProgramOccurrences.dueOn, "2026-03-31")))
    const registered = await execution.recordOccurrence({
      occurrenceId: overdue!.id, outcome: "not_done", reason: "No se pudo ingresar a la zona por el temporal.",
    }, author)
    expect(registered.outcome).toBe("not_done")

    const next = await completeMatrix(2027)
    matrix2027 = next.id
    await seal(matrix2027, "Emisión del período 2027.")

    const occurrences = await occurrenceRows(action.id)
    expect(occurrences.filter((row) => row.outcome === "superseded")).toHaveLength(8)
    expect(occurrences.find((row) => row.id === overdue!.id)?.outcome).toBe("not_done")

    // El avance del programa reemplazado sólo cuenta lo registrado.
    const workspace = await getProgramWorkspace(matrix2026, author)
    expect(workspace.progress).toMatchObject({ done: 0, failed: 1, pending: 0, planned: 1 })
    expect(workspace.progress.ratio).toBe(0)
    expect(workspace.actions).toHaveLength(1)
    // El período nuevo no hereda nada.
    expect((await getProgramWorkspace(matrix2027, author)).progress.planned).toBe(0)
  })

  it("una ocurrencia reemplazada ya no se registra", async () => {
    const action = await actionRow(matrix2026)
    const superseded = (await occurrenceRows(action.id)).find((row) => row.outcome === "superseded")
    expect(superseded).toBeDefined()
    await expect(execution.recordOccurrence({ occurrenceId: superseded!.id, outcome: "not_done", reason: "Intento tardío sobre lo reemplazado." }, author))
      .rejects.toThrow(/reemplazada por el período siguiente/)
  })
})
