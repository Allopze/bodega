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
// El conector PDTP escribe con su propia conexión: acá sólo interesa que se llame.
const accredit = vi.fn()
vi.mock("@/lib/services/pdtp-adapters/pdtp-accreditation-connectors", () => ({ onRiskMatrixPublished: (...args: unknown[]) => accredit(...args) }))

const { createMiper, updateMiperHeader } = await import("@/lib/services/miper/matrices")
const entries = await import("@/lib/services/miper/entries")
const obs = await import("@/lib/services/miper/observations")
const wf = await import("@/lib/services/miper/workflow")
const program = await import("@/lib/services/miper/program")

const WS = "ws-w"
const scope = { mode: "some" as const, ids: [WS] }
const all = { mode: "all" as const, ids: [] as [] }
const author = { userId: "u-prev", scope, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const jefa = { userId: "u-jefa", scope: all, permissions: ["prevention:risk:view", "prevention:risk:review", "prevention:risk:edit"] }
const legal = { userId: "u-legal", scope: all, permissions: ["prevention:risk:view", "prevention:risk:approve_legal"] }
const matrixRow = async (id: string) => (await testDb.select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, id)))[0]!

async function completeMatrix(period: number) {
  const { id } = await createMiper({ worksiteId: WS, period, revisionReason: "Elaboración para probar el flujo." }, author)
  const m = await matrixRow(id)
  await updateMiperHeader({
    matrixId: id, expectedVersion: m.version, iperCode: "RE-04", elaboratedOn: `${period}-01-10`, updatedOn: null,
    companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero", economicActivity: "Transporte",
    adherentNumber: null, worksiteName: "Faena W", siteRepresentativeUserId: null, siteRepresentativeName: "Juan Pérez",
    headcountTotal: 5, headcountMale: 4, headcountFemale: 1, headcountOther: 0, participationSummary: "", consultationEvidenceReference: "",
  }, author)
  const e = await entries.saveMiperEntry({ matrixId: id, values: { activity: "Transporte", task: "Descarga", position: "Conductor", riskFactorId: "riskfactor-mecanico", hazard: "Camión en pendiente", risk: "Volcamiento", probableDamage: "Politraumatismo", probability: 2, consequence: 4, controlledStatus: "partial", isRoutine: true } }, author)
  const control = await entries.saveMiperControl({ matrixId: id, entryId: e.id, values: { hierarchy: "administrative", description: "Procedimiento de descarga en pendiente", responsibleName: "Supervisor", dueDate: `${period}-06-30` } }, author)
  return { id, entryId: e.id, controlId: control.id }
}

/**
 * Vincula una medida del MIPER a una actividad del Programa de Trabajo. Es la
 * precondición que la regla del Intolerable exige al enviar (§6.2 / §7.3).
 */
async function linkMeasureToProgram(matrixId: string, controlId: string, startsOn: string) {
  const action = await program.saveProgramAction({ matrixId, description: "Procedimiento de descarga en pendiente", scheduleKind: "monthly", startsOn }, author)
  const [row] = await testDb.select().from(schema.preventionRiskPrograms).where(eq(schema.preventionRiskPrograms.matrixId, matrixId))
  await program.linkActionControls({ programId: row!.id, actionId: action.id, controlIds: [controlId], link: true }, author)
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena W", code: "W" })
  await testDb.insert(schema.users).values([
    { id: "u-prev", name: "Prevencionista", email: "p@w.cl", hashedPassword: "x", isActive: true },
    { id: "u-jefa", name: "Jefa Prevención", email: "j@w.cl", hashedPassword: "x", isActive: true },
    { id: "u-legal", name: "Gerencia Legal y RRHH", email: "l@w.cl", hashedPassword: "x", isActive: true },
  ])
}, 60_000)

describe("flujo MIPER de extremo a extremo (servicio)", () => {
  it("envío → observación por fila → corrección → reenvío → aprobación técnica → Legal y RRHH → v1 vigente", async () => {
    const { id, entryId, controlId } = await completeMatrix(2026)
    let m = await matrixRow(id)
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    m = await matrixRow(id)
    expect(m.reviewState).toBe("in_review")

    // La autora no puede revisar su propio envío aunque tenga el permiso.
    await expect(wf.approveMiperTechnicalReview({ matrixId: id, expectedVersion: m.version }, { ...author, permissions: [...author.permissions, "prevention:risk:review"] })).rejects.toThrow(/Quien envió la MIPER no puede revisarla/)
    // Devolver sin observaciones no se puede.
    await expect(wf.returnMiperWithObservations({ matrixId: id, expectedVersion: m.version, comment: "Faltan ajustes en la evaluación." }, jefa)).rejects.toThrow(/al menos una observación/)

    const { id: obsId } = await obs.addMiperObservation({ matrixId: id, entryId, body: "Revisar consecuencia: el daño probable indica severidad alta." }, jefa)
    await wf.returnMiperWithObservations({ matrixId: id, expectedVersion: m.version, comment: "Revisar la consecuencia del riesgo #1." }, jefa)
    m = await matrixRow(id)
    expect(m.reviewState).toBe("observed")

    // Reenviar sin responder no se puede.
    await expect(wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)).rejects.toThrow(/Responde todas las observaciones/)
    const [row] = await testDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, entryId))
    await entries.saveMiperEntry({ matrixId: id, entryId, expectedVersion: row!.version, values: { consequence: 4, probability: 4 } }, author) // → Intolerable
    // La fila quedó Intolerable: el reenvío exige su medida dentro del programa.
    await linkMeasureToProgram(id, controlId, "2026-03-01")
    await obs.respondMiperObservation({ observationId: obsId, response: "Se reevaluó: probabilidad alta, queda Intolerable." }, author)
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    m = await matrixRow(id)

    // La foto de la ronda es la que revisa la Jefa; editar después no la altera.
    const [editedAfter] = await testDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, entryId))
    await entries.saveMiperEntry({ matrixId: id, entryId, expectedVersion: editedAfter!.version, values: { risk: "Volcamiento editado durante la revisión" } }, author)

    await wf.approveMiperTechnicalReview({ matrixId: id, expectedVersion: m.version }, jefa)
    m = await matrixRow(id)
    expect(m.reviewState).toBe("pending_approval")
    const [resolved] = await testDb.select().from(schema.preventionRiskObservations).where(eq(schema.preventionRiskObservations.id, obsId))
    expect(resolved!.status).toBe("resolved")

    // La revisora técnica no firma también como Legal y RRHH.
    await expect(wf.approveMiperFinal({ matrixId: id, expectedVersion: m.version, changeSummary: "Emisión inicial del documento." }, { ...jefa, permissions: [...jefa.permissions, "prevention:risk:approve_legal"] })).rejects.toThrow(/revisión técnica no puede firmar/)
    const { versionNumber } = await wf.approveMiperFinal({ matrixId: id, expectedVersion: m.version, changeSummary: "Emisión inicial del documento." }, legal)
    expect(versionNumber).toBe(1)
    m = await matrixRow(id)
    expect(m).toMatchObject({ status: "published", reviewState: "none", reviewedByUserId: "u-jefa", approvedByUserId: "u-legal" })
    const [version] = await testDb.select().from(schema.preventionRiskMatrixVersions).where(eq(schema.preventionRiskMatrixVersions.matrixId, id))
    const sealed = version!.snapshot as { entries: Array<{ risk: string; classification: string }> }
    expect(sealed.entries[0]).toMatchObject({ risk: "Volcamiento", classification: "intolerable" })
    expect(accredit).toHaveBeenCalledWith(expect.objectContaining({ matrixId: id, matrixVersion: 1 }))
    const clocks = await testDb.select().from(schema.preventionPdtpUpdateObligations).where(eq(schema.preventionPdtpUpdateObligations.sourceId, id))
    expect(clocks).toHaveLength(1)
  })

  it("un MIPER vigente se modifica al instante y el cambio sella la v2; sin cambios no se envía", async () => {
    const [vigente] = await testDb.select().from(schema.preventionRiskMatrices).where(and(eq(schema.preventionRiskMatrices.worksiteId, WS), eq(schema.preventionRiskMatrices.status, "published")))
    const id = vigente!.id
    let m = await matrixRow(id)
    // La edición hecha durante la revisión anterior quedó pendiente: ese cambio SÍ permite enviar.
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    m = await matrixRow(id)
    await wf.approveMiperTechnicalReview({ matrixId: id, expectedVersion: m.version }, jefa)
    m = await matrixRow(id)
    const { versionNumber } = await wf.approveMiperFinal({ matrixId: id, expectedVersion: m.version, changeSummary: "Actualización del riesgo #1." }, legal)
    expect(versionNumber).toBe(2)
    m = await matrixRow(id)
    await expect(wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)).rejects.toThrow(/No hay cambios respecto de la versión vigente v2/)
    const versions = await testDb.select().from(schema.preventionRiskMatrixVersions).where(eq(schema.preventionRiskMatrixVersions.matrixId, id))
    expect(versions.map((v) => v.versionNumber).sort()).toEqual([1, 2])
  })

  it("aprobar el MIPER del período siguiente reemplaza al vigente", async () => {
    const { id } = await completeMatrix(2027)
    let m = await matrixRow(id)
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    m = await matrixRow(id)
    await wf.approveMiperTechnicalReview({ matrixId: id, expectedVersion: m.version }, jefa)
    m = await matrixRow(id)
    await wf.approveMiperFinal({ matrixId: id, expectedVersion: m.version, changeSummary: "Emisión del período 2027." }, legal)
    const published = await testDb.select().from(schema.preventionRiskMatrices).where(and(eq(schema.preventionRiskMatrices.worksiteId, WS), eq(schema.preventionRiskMatrices.status, "published")))
    expect(published.map((row) => row.id)).toEqual([id])
  })

  it("Legal y RRHH puede devolver: vuelve a observada y el reenvío pasa otra vez por la Jefa", async () => {
    const { id, entryId } = await completeMatrix(2029)
    let m = await matrixRow(id)
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    m = await matrixRow(id)
    await wf.approveMiperTechnicalReview({ matrixId: id, expectedVersion: m.version }, jefa)
    m = await matrixRow(id)
    await obs.addMiperObservation({ matrixId: id, entryId, body: "Falta identificar al responsable del procedimiento." }, legal)
    await wf.requestMiperCorrections({ matrixId: id, expectedVersion: m.version, comment: "Completar responsables antes de aprobar." }, legal)
    m = await matrixRow(id)
    expect(m.reviewState).toBe("observed")
    const [o] = await testDb.select().from(schema.preventionRiskObservations).where(and(eq(schema.preventionRiskObservations.matrixId, id), eq(schema.preventionRiskObservations.stage, "legal_rrhh")))
    await obs.respondMiperObservation({ observationId: o!.id, response: "Responsable asignado: supervisor de turno." }, author)
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    expect((await matrixRow(id)).reviewState).toBe("in_review")
  })

  it("el Intolerable no se envía sin una medida vinculada al Programa de Trabajo", async () => {
    const { id, entryId, controlId } = await completeMatrix(2028)
    const [row] = await testDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, entryId))
    await entries.saveMiperEntry({ matrixId: id, entryId, expectedVersion: row!.version, values: { probability: 4, consequence: 4 } }, author) // → Intolerable
    let m = await matrixRow(id)
    await expect(wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author))
      .rejects.toThrow(/Intolerable exige una medida vinculada a una actividad del Programa de Trabajo/)

    // Con la medida del riesgo dentro del programa, el envío pasa.
    await linkMeasureToProgram(id, controlId, "2028-03-01")
    m = await matrixRow(id)
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    expect((await matrixRow(id)).reviewState).toBe("in_review")
  })

  it("el envío exige completitud RE-04", async () => {
    const { id } = await createMiper({ worksiteId: WS, period: 2032, revisionReason: "Borrador incompleto para probar el envío." }, author)
    await entries.saveMiperEntry({ matrixId: id, values: { hazard: "Incompleto" } }, author)
    const m = await matrixRow(id)
    await expect(wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)).rejects.toThrow(/No se puede enviar a revisión/)
  })
})
