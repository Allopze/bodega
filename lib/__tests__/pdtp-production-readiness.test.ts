/**
 * Prueba de realidad de la auditoría de production readiness (2026-09-28),
 * versionada: diez actividades recorren el ciclo Programa → Ejecución →
 * Evidencia → Cumplimiento por la capa de servicios real, más las tres vías por
 * las que la auditoría demostró cumplimiento sin evidencia ni segunda persona.
 *
 * Fija el comportamiento corregido de:
 * - PRV-01: la evidencia de integración se verifica (archivo + dueño + faena).
 * - PRV-02: quien originó un hecho de integración no aprueba su cumplimiento,
 *   y aprobar una integración sin evidencia verificada exige motivo.
 * - PRV-03: no se registra ni se aprueba una semana que todavía no ocurre.
 *
 * El reloj se fija el 28-09-2026 (el día de la auditoría) para que "futuro" y
 * "atrasado" signifiquen lo mismo en cada corrida.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { seedPdtpEvidenceUpload } from "@/lib/testing/pdtp-evidence-upload-fixture"
import { seedPreventionEvidenceUpload } from "@/lib/testing/prevention-evidence-upload-fixture"
import * as schema from "@/db/schema"

process.env.STORAGE_PATH = path.join(tmpdir(), `pdtp-readiness-${Date.now()}-${Math.random().toString(36).slice(2)}`)
mkdirSync(path.join(process.env.STORAGE_PATH, "pdtp-evidence"), { recursive: true })
for (const file of ["acta.pdf", "acta2.pdf", "acta3.pdf"]) {
  writeFileSync(path.join(process.env.STORAGE_PATH, "pdtp-evidence", file), `%PDF-1.4 ${file}`)
}
const EV = (file: string) => `storage/pdtp-evidence/${file}`

const pg = new PGlite()
const tdb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof tdb }
// @ts-expect-error PGlite es compatible en tiempo de ejecución
testGlobal.__db = tdb
await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const Y = 2026
const WS = "ws-qa"
const REG = "u-registra"
const APR = "u-aprueba"
const ids: Record<string, string> = {}
let programId = ""

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-28T15:00:00.000Z") })
  await tdb.insert(schema.users).values([
    { id: REG, name: "Registra", email: "reg@qa.test", hashedPassword: "x", isActive: true },
    { id: APR, name: "Aprueba", email: "apr@qa.test", hashedPassword: "x", isActive: true },
  ])
  await tdb.insert(schema.pdtpResponsibleCatalog).values([{ slug: "prevencionista", displayName: "Prevencionista", kind: "role" }])
  await tdb.insert(schema.worksites).values([{ id: WS, name: "Faena QA", code: "QA1", isActive: true }])
  for (const file of ["acta.pdf", "acta2.pdf", "acta3.pdf"]) await seedPdtpEvidenceUpload(tdb, { path: EV(file), worksiteId: WS, userId: REG })

  const { createLegacyPdtpProgramForTests, addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
  const program = await createLegacyPdtpProgramForTests({ year: Y, title: "QA_ Programa realidad", userId: REG })
  programId = program.id
  const [sheet] = await tdb.select().from(schema.pdtpSheets).where(eq(schema.pdtpSheets.programId, program.id))
  type Cell = [month: number, week: number, quantity: number]
  const specs: Array<{ key: string; cells: Cell[]; evidenceRequirement?: string }> = [
    { key: "unica", cells: [[3, 1, 1]] },
    { key: "mensual", cells: Array.from({ length: 12 }, (_, i) => [i + 1, 1, 1] as Cell) },
    { key: "cuando_corresponda", cells: [] },
    { key: "evidencia_documental", cells: [[4, 1, 1]], evidenceRequirement: "Acta firmada en PDF" },
    { key: "otro_modulo", cells: [[5, 1, 1]] },
    { key: "no_realizada", cells: [[6, 1, 1]] },
    { key: "no_aplica", cells: [[7, 1, 1]] },
    { key: "atrasada", cells: [[8, 1, 1]] },
    { key: "futura", cells: [[11, 1, 1]] },
    { key: "multiple", cells: [[2, 1, 4]] },
  ]
  let row = 1
  for (const spec of specs) {
    const activity = await addPdtpActivity({
      programId: program.id, activity: `QA_ ${spec.key}`, program: "Guía", responsibleSlugs: ["prevencionista"],
      responsibleDisplay: "Prevencionista", sheetCodes: [], scheduleMode: "on_demand",
    }, REG)
    ids[spec.key] = activity.id
    if (spec.evidenceRequirement) {
      await tdb.update(schema.pdtpActivities).set({ evidenceRequirement: spec.evidenceRequirement }).where(eq(schema.pdtpActivities.id, activity.id))
    }
    for (const [month, week, quantity] of spec.cells) {
      await tdb.insert(schema.pdtpActivitySchedule).values({ id: `${activity.id}-s-${month}-${week}`, activityId: activity.id, year: Y, month, week, plannedQuantity: quantity, sourceColumn: "qa" })
    }
    await tdb.insert(schema.pdtpSheetActivities).values({ id: `qa-m-${row}`, sheetId: sheet!.id, sheetCode: sheet!.code, activityId: activity.id, sheetRow: row, displayOrder: row })
    row++
  }
  await tdb.update(schema.pdtpPrograms).set({ status: "active", activatedAt: `${Y}-01-05T12:00:00.000Z` }).where(eq(schema.pdtpPrograms.id, program.id))
})

afterAll(async () => {
  vi.useRealTimers()
  delete testGlobal.__db
  await pg.close()
})

async function services() {
  const executions = await import("@/lib/services/pdtp/executions")
  const deviations = await import("@/lib/services/pdtp/deviations")
  const accreditation = await import("@/lib/services/pdtp/accreditation")
  const compliance = await import("@/lib/services/pdtp/compliance")
  return { ...executions, ...deviations, ...accreditation, ...compliance }
}

const mark = async (key: string, month: number, quantity: number, extra: Record<string, unknown> = {}, week = 1) => {
  const { markPdtpExecution } = await services()
  return markPdtpExecution(
    { activityId: ids[key], worksiteId: WS, year: Y, month, week, executedQuantity: quantity, evidenceText: "QA_ registro", ...extra },
    REG, "all", { canActForOthers: true },
  )
}

const nOf = async (key: string) => (await tdb.select({ n: schema.pdtpActivities.n }).from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, ids[key]!)))[0]!.n
const executionsOf = (key: string) => tdb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, ids[key]!))

describe("prueba de realidad PDTP: ciclo manual", () => {
  it("fecha única: se registra con evidencia, no se autoaprueba y otra persona la aprueba una vez", async () => {
    const { approvePdtpExecution } = await services()
    const execution = await mark("unica", 3, 1, { evidenceUrl: EV("acta.pdf") })
    await expect(approvePdtpExecution(execution.id, REG, "all")).rejects.toThrow(/no puede aprobarlo/)
    await expect(approvePdtpExecution(execution.id, APR, "all")).resolves.toMatchObject({ status: "approved" })
    await expect(approvePdtpExecution(execution.id, APR, "all")).rejects.toThrow(/ya fue aprobada/)
  })

  it("mensual: enero a agosto registrados y aprobados", async () => {
    const { approvePdtpExecution } = await services()
    for (let month = 1; month <= 8; month++) {
      const execution = await mark("mensual", month, 1, { evidenceUrl: EV("acta2.pdf") })
      await approvePdtpExecution(execution.id, APR, "all")
    }
  })

  it("evidencia documental: sin archivo no se registra", async () => {
    const { approvePdtpExecution } = await services()
    await expect(mark("evidencia_documental", 4, 1, { evidenceText: "" })).rejects.toThrow(/exige evidencia/)
    await expect(mark("evidencia_documental", 4, 1, { evidenceText: "Se hizo la reunión" })).rejects.toThrow(/adjunta un archivo/)
    const execution = await mark("evidencia_documental", 4, 1, { evidenceUrl: EV("acta3.pdf") })
    await approvePdtpExecution(execution.id, APR, "all")
  })

  it("no realizada exige motivo y no aplica pasa por revisión de otra persona", async () => {
    const { recordPdtpDeviation, reviewPdtpNotApplicable } = await services()
    await expect(recordPdtpDeviation({ activityId: ids.no_realizada, worksiteId: WS, year: Y, month: 6, week: 1, kind: "not_performed", reason: "no" }, REG, "all")).rejects.toThrow()
    await expect(recordPdtpDeviation({ activityId: ids.no_realizada, worksiteId: WS, year: Y, month: 6, week: 1, kind: "not_performed", reason: "Faena detenida por lluvia, no se pudo ejecutar." }, REG, "all"))
      .resolves.toMatchObject({ status: "active" })
    const na = await recordPdtpDeviation({ activityId: ids.no_aplica, worksiteId: WS, year: Y, month: 7, week: 1, kind: "not_applicable", reason: "La faena no tiene fuentes de ruido en julio." }, REG, "all")
    expect(na.status).toBe("pending_review")
    await expect(reviewPdtpNotApplicable({ deviationId: na.id, decision: "approve" }, REG, "all")).rejects.toThrow(/propia/)
    await expect(reviewPdtpNotApplicable({ deviationId: na.id, decision: "approve" }, APR, "all")).resolves.toMatchObject({ status: "active" })
  })

  it("PRV-03: no se registra ni se declara no aplica una semana futura", async () => {
    const { recordPdtpDeviation } = await services()
    await expect(mark("futura", 11, 1, { evidenceUrl: EV("acta.pdf") })).rejects.toThrow(/aún no ocurre/)
    await expect(recordPdtpDeviation({ activityId: ids.futura, worksiteId: WS, year: Y, month: 11, week: 1, kind: "not_applicable", reason: "No aplica porque se adelantó a octubre." }, REG, "all"))
      .rejects.toThrow(/aún no ocurre/)
    // La semana en curso (septiembre, semana 4) sí se puede registrar.
    await expect(mark("mensual", 9, 1, { evidenceUrl: EV("acta2.pdf") }, 4)).resolves.toMatchObject({ status: "submitted" })
  })

  it("PRV-03: una ejecución futura que ya existía no se puede aprobar", async () => {
    const { approvePdtpExecution } = await services()
    const id = `qa-futura-legada`
    await tdb.insert(schema.pdtpExecutions).values({
      id, activityId: ids.futura!, worksiteId: WS, year: Y, month: 11, week: 1, executedQuantity: 1,
      status: "submitted", origin: "manual", evidenceUrl: EV("acta.pdf"), evidencePhotos: [],
      executedByUserId: REG, executedAt: new Date().toISOString(), evidenceStatus: "provided",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    await expect(approvePdtpExecution(id, APR, "all")).rejects.toThrow(/aún no ocurre/)
  })

  it("múltiples ejecuciones: el doble envío concurrente no duplica la celda", async () => {
    const { approvePdtpExecution } = await services()
    const first = await mark("multiple", 2, 2, { evidenceUrl: EV("acta.pdf") })
    await approvePdtpExecution(first.id, APR, "all")
    await Promise.allSettled([
      mark("multiple", 2, 2, { evidenceUrl: EV("acta3.pdf") }, 2),
      mark("multiple", 2, 2, { evidenceUrl: EV("acta3.pdf") }, 2),
    ])
    const rows = (await executionsOf("multiple")).filter((row) => row.week === 2)
    expect(rows).toHaveLength(1)
    await approvePdtpExecution(rows[0]!.id, APR, "all")
  })
})

describe("prueba de realidad PDTP: integración con submódulos", () => {
  it("PRV-01: un acta CGRD con una ruta inventada no se auto-aprueba", async () => {
    const { accreditPdtpFromEvent } = await services()
    await accreditPdtpFromEvent({
      sourceType: "cgrd", sourceId: "qa-acta-inventada", worksiteId: WS, activityNumbers: [await nOf("atrasada")],
      occurredAt: `${Y}-08-10T15:00:00.000Z`, evidenceRef: "storage/cgrd-evidence/no-existe.pdf", autoApproveByUserId: REG, actorUserId: REG,
    })
    const [execution] = await executionsOf("atrasada")
    expect(execution).toMatchObject({ status: "submitted", approvedByUserId: null })
    expect(execution!.evidenceStatus).not.toBe("provided")
  })

  it("PRV-01: un simulacro con https://x no se auto-aprueba", async () => {
    const { accreditPdtpFromEvent } = await services()
    await accreditPdtpFromEvent({
      sourceType: "emergencia", sourceId: "qa-simulacro-url", worksiteId: WS, activityNumbers: [await nOf("otro_modulo")],
      occurredAt: `${Y}-05-10T15:00:00.000Z`, evidenceRef: "https://x", autoApproveByUserId: REG, actorUserId: REG,
    })
    const [execution] = await executionsOf("otro_modulo")
    expect(execution?.status).toBe("submitted")
  })

  it("PRV-01: un acta CGRD subida y de la faena sí se auto-aprueba", async () => {
    const { accreditPdtpFromEvent } = await services()
    const ref = await seedPreventionEvidenceUpload(tdb, { domain: "cgrd", uploadedByUserId: REG })
    await tdb.update(schema.preventionEvidenceUploads).set({ worksiteId: WS, claimedAt: new Date().toISOString() }).where(eq(schema.preventionEvidenceUploads.path, ref))
    await accreditPdtpFromEvent({
      sourceType: "cgrd", sourceId: "qa-acta-real", worksiteId: WS, activityNumbers: [await nOf("atrasada")],
      occurredAt: `${Y}-08-12T15:00:00.000Z`, evidenceRef: ref, autoApproveByUserId: REG, actorUserId: REG,
    })
    const approved = (await executionsOf("atrasada")).find((row) => row.sourceId === "qa-acta-real")
    expect(approved).toMatchObject({ status: "approved", evidenceStatus: "provided", executedByUserId: REG })
  })

  it("PRV-02: quien originó una integración no la aprueba, y otra persona necesita motivo si no hay evidencia", async () => {
    const { accreditPdtpFromEvent, approvePdtpExecution } = await services()
    await accreditPdtpFromEvent({
      sourceType: "cphs", sourceId: "qa-cphs", worksiteId: WS, activityNumbers: [await nOf("mensual")],
      occurredAt: `${Y}-09-10T15:00:00.000Z`, evidenceRef: "Constitución CPHS registrada", actorUserId: REG,
    })
    const execution = (await executionsOf("mensual")).find((row) => row.sourceId === "qa-cphs")!
    expect(execution).toMatchObject({ status: "submitted", executedByUserId: REG, origin: "integration" })
    await expect(approvePdtpExecution(execution.id, REG, "all", { reason: "Revisé el acta de constitución." })).rejects.toThrow(/no puede aprobarlo/)
    await expect(approvePdtpExecution(execution.id, APR, "all")).rejects.toThrow(/indica qué revisaste/)
    await expect(approvePdtpExecution(execution.id, APR, "all", { reason: "Revisé el acta de constitución en CPHS." }))
      .resolves.toMatchObject({ status: "approved" })
  })
})

describe("prueba de realidad PDTP: el indicador refleja cada situación", () => {
  it("anual y a la fecha cuadran con el cálculo manual celda por celda", async () => {
    const { getPdtpComplianceIndicators } = await services()
    const indicators = await getPdtpComplianceIndicators(programId, WS)
    // Plan: única 1 + mensual 12 + documental 1 + otro módulo 1 + no realizada 1
    // + no aplica 0 (aprobado) + atrasada 1 + futura 1 + múltiple 4 = 22.
    expect(indicators!.annual.planned).toBe(22)
    // Aprobado: única 1 + mensual ene–ago 8 + CPHS sep 1 + documental 1 + CGRD real 1 + múltiple 4 = 16.
    // La ruta inventada, el simulacro con URL, la semana 4 de septiembre enviada
    // sin aprobar y la futura no suman.
    expect(indicators!.annual.executed).toBe(16)
    // A la fecha (hasta septiembre): el plan de octubre a diciembre no pesa todavía.
    expect(indicators!.toDate.planned).toBe(18)
    expect(indicators!.toDate.executed).toBe(16)
    // Julio: sólo la mensual; el "no aplica" aprobado salió del plan.
    expect(indicators!.monthly[6]).toMatchObject({ planned: 1, executed: 1 })
    // Junio: la mensual cumplida más la no realizada, que sigue pesando.
    expect(indicators!.monthly[5]).toMatchObject({ planned: 2, executed: 1 })
  })
})
