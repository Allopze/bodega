/**
 * lib/__tests__/pdtp-revision-windows.test.ts
 *
 * T6 (plan de pendientes, PREV-C05): una revisión v+1 activada a mitad de año
 * no parte el año. Cada versión es dueña de su ventana —desde su semana de
 * activación hasta la de su sucesora— y la v1 cerrada por reemplazo sigue
 * admitiendo, dentro de ella, registros tardíos, aprobaciones, desvíos y
 * cierres (D24). El indicador anual se consolida entre versiones por
 * actividad de catálogo.
 *
 * Reloj fijo a mediados de octubre del año en curso: v1 activa desde enero,
 * v2 desde el 6 de julio (semana 1 de julio). Ventana de v1 = enero..junio.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { seedPdtpEvidenceUpload } from "@/lib/testing/pdtp-evidence-upload-fixture"
import * as schema from "@/db/schema"

process.env.STORAGE_PATH = path.join(tmpdir(), `pdtp-revision-windows-${Date.now()}`)
mkdirSync(path.join(process.env.STORAGE_PATH, "pdtp-evidence"), { recursive: true })
writeFileSync(path.join(process.env.STORAGE_PATH, "pdtp-evidence", "acta.pdf"), "%PDF-1.4")
const EVIDENCE_URL = "storage/pdtp-evidence/acta.pdf"

vi.mock("@/lib/services/cloudreve/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/cloudreve/client")>()),
  ensureCloudreveCollections: async () => undefined,
  putCloudreveKey: async () => undefined,
  statCloudreveKey: async () => null,
}))

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const YEAR = new Date().getFullYear()
vi.setSystemTime(new Date(`${YEAR}-10-15T15:00:00.000Z`))
const V1_ACTIVATED = `${YEAR}-01-01T12:00:00.000Z`
const V2_ACTIVATED = `${YEAR}-07-06T15:00:00.000Z`
const REASON = "Motivo suficientemente largo para la prueba"
let ACTIVITY_N = 0
let SHEET_CODE = "pdtp_general"

afterAll(async () => {
  vi.useRealTimers()
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpFulfillmentEventTargets)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpPeriodClosures)
  await inMemoryDb.delete(schema.pdtpExecutionDeviations)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteAssignees)
  await inMemoryDb.delete(schema.pdtpScheduledInstances)
  await inMemoryDb.delete(schema.pdtpActivityReminderRules)
  await inMemoryDb.delete(schema.pdtpActivityExecutionConfigs)
  await inMemoryDb.delete(schema.pdtpActivityScheduleOverrides)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpSheetActivities)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpSheets)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.insert(schema.users).values([
    { id: "user-1", name: "Registra", email: "u1@test", hashedPassword: "x", isActive: true },
    { id: "user-2", name: "Aprueba", email: "u2@test", hashedPassword: "x", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values({ slug: "prevencionista", displayName: "Prevencionista", kind: "role" })
  await inMemoryDb.insert(schema.worksites).values({ id: "ws-1", name: "Faena 1", code: "F1", isActive: true })
})

/**
 * v1 con una actividad planificada en marzo (semana 2) y en agosto (semana 2);
 * v2 es su revisión copiada. Queda v1 `closed` y v2 `active` desde julio.
 */
async function seedRevisedYear(options: { v2ActivatedAt?: string; cells?: Array<[number, number]>; revise?: boolean } = {}) {
  const { createLegacyPdtpProgramForTests, addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
  const { createPdtpRevision } = await import("@/lib/services/pdtp/programs")
  const v1 = await createLegacyPdtpProgramForTests({ year: YEAR, title: `Programa ${YEAR}`, userId: "user-1" })
  const activity = await addPdtpActivity({
    programId: v1.id,
    activity: "Charla de seguridad",
    program: "Guía de ejecución",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    sheetCodes: [],
    scheduleMode: "on_demand",
  }, "user-1")
  for (const [month, week] of options.cells ?? [[3, 2], [8, 2]]) {
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: `${activity.id}-s-${month}-${week}`, activityId: activity.id, year: YEAR, month, week, plannedQuantity: 1, sourceColumn: "test",
    })
  }
  const [sheet] = await inMemoryDb.select().from(schema.pdtpSheets).where(eq(schema.pdtpSheets.programId, v1.id))
  await inMemoryDb.insert(schema.pdtpSheetActivities).values({
    id: `membership-${activity.id}`, sheetId: sheet!.id, sheetCode: sheet!.code,
    activityId: activity.id, sheetRow: 1, displayOrder: 1,
  })
  SHEET_CODE = sheet!.code
  await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active", activatedAt: V1_ACTIVATED })
    .where(eq(schema.pdtpPrograms.id, v1.id))
  ACTIVITY_N = activity.n
  if (options.revise === false) return { v1Id: v1.id, v2Id: "", v1ActivityId: activity.id, v2ActivityId: "" }
  const revision = await createPdtpRevision({ sourceProgramId: v1.id, userId: "user-1" })
  await inMemoryDb.update(schema.pdtpPrograms).set({ status: "closed" }).where(eq(schema.pdtpPrograms.id, v1.id))
  await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active", activatedAt: options.v2ActivatedAt ?? V2_ACTIVATED })
    .where(eq(schema.pdtpPrograms.id, revision.programId))
  const [v2Activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, revision.programId))
  ACTIVITY_N = activity.n
  return { v1Id: v1.id, v2Id: revision.programId, v1ActivityId: activity.id, v2ActivityId: v2Activity!.id }
}

// PREV-M02-B (0334): el archivo de prueba compartido figura como subido por
// user-1 para ws-1, que es quien lo vincula primero en estas pruebas.
beforeEach(async () => {
  await seedPdtpEvidenceUpload(inMemoryDb, { path: EVIDENCE_URL, worksiteId: "ws-1", userId: "user-1" })
})

describe("C05-B — la v1 cerrada por reemplazo admite los meses de su ventana (D24)", () => {
  it("registra una ejecución tardía de marzo en la v1 cerrada", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { v1ActivityId } = await seedRevisedYear()
    const execution = await markPdtpExecution({
      activityId: v1ActivityId, worksiteId: "ws-1", year: YEAR, month: 3, week: 2, executedQuantity: 1, evidenceUrl: EVIDENCE_URL,
    }, "user-1", "all")
    expect(execution.status).toBe("submitted")
  })

  it("rechaza en la v1 cerrada una celda que ya es de la v2, y lo dice", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { v1ActivityId } = await seedRevisedYear()
    await expect(markPdtpExecution({
      activityId: v1ActivityId, worksiteId: "ws-1", year: YEAR, month: 8, week: 2, executedQuantity: 1, evidenceUrl: EVIDENCE_URL,
    }, "user-1", "all")).rejects.toThrow(/versión v2/)
  })

  it("la semana de activación de la v2 es de la v2, no de la v1", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { v1ActivityId, v2ActivityId } = await seedRevisedYear()
    await expect(markPdtpExecution({
      activityId: v1ActivityId, worksiteId: "ws-1", year: YEAR, month: 7, week: 1, executedQuantity: 1, evidenceUrl: EVIDENCE_URL,
    }, "user-1", "all")).rejects.toThrow(/versión v2/)
    const own = await markPdtpExecution({
      activityId: v2ActivityId, worksiteId: "ws-1", year: YEAR, month: 7, week: 1, executedQuantity: 1, evidenceUrl: EVIDENCE_URL,
    }, "user-1", "all")
    expect(own.status).toBe("submitted")
  })

  it("declara un desvío 'no realizado' de marzo en la v1 cerrada", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { v1ActivityId } = await seedRevisedYear()
    const deviation = await recordPdtpDeviation({
      activityId: v1ActivityId, worksiteId: "ws-1", year: YEAR, month: 3, week: 2, kind: "not_performed", reason: REASON,
    }, "user-1", "all")
    expect(deviation.status).toBe("active")
  })

  it("cierra marzo en la v1 cerrada, y no agosto", async () => {
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { v1Id } = await seedRevisedYear()
    const closure = await closePdtpPeriod({ programId: v1Id, worksiteId: "ws-1", year: YEAR, month: 3, reason: REASON }, "user-1", "all")
    expect(closure.status).toBe("closed")
    await expect(closePdtpPeriod({ programId: v1Id, worksiteId: "ws-1", year: YEAR, month: 8, reason: REASON }, "user-1", "all"))
      .rejects.toThrow(/versión v2/)
  })

  it("aprueba en la v1 cerrada un envío de su ventana; un año cerrado ya no admite aprobaciones", async () => {
    const { markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { v1Id, v2Id, v1ActivityId } = await seedRevisedYear()
    const first = await markPdtpExecution({
      activityId: v1ActivityId, worksiteId: "ws-1", year: YEAR, month: 3, week: 2, executedQuantity: 1, evidenceUrl: EVIDENCE_URL,
    }, "user-1", "all")
    const approved = await approvePdtpExecution(first.id, "user-2", "all")
    expect(approved.status).toBe("approved")

    const pending = await markPdtpExecution({
      activityId: v1ActivityId, worksiteId: "ws-1", year: YEAR, month: 4, week: 1, executedQuantity: 1, evidenceUrl: EVIDENCE_URL,
    }, "user-1", "all")
    const closedAt = new Date().toISOString()
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "closed", yearClosedAt: closedAt, yearCloseReason: REASON, yearClosedByUserId: "user-2" })
      .where(eq(schema.pdtpPrograms.id, v2Id))
    await inMemoryDb.update(schema.pdtpPrograms).set({ yearClosedAt: closedAt, yearCloseReason: REASON, yearClosedByUserId: "user-2" })
      .where(eq(schema.pdtpPrograms.id, v1Id))
    await expect(approvePdtpExecution(pending.id, "user-2", "all")).rejects.toThrow(/cerrado formalmente/)
  })

  it("un programa archivado no admite registros aunque el período sea suyo", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { v1Id, v1ActivityId } = await seedRevisedYear()
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "archived" }).where(eq(schema.pdtpPrograms.id, v1Id))
    await expect(markPdtpExecution({
      activityId: v1ActivityId, worksiteId: "ws-1", year: YEAR, month: 3, week: 2, executedQuantity: 1, evidenceUrl: EVIDENCE_URL,
    }, "user-1", "all")).rejects.toThrow(/estado activo/)
  })
})

describe("C05-B — una versión reemplazada se lee sólo dentro de su ventana", () => {
  it("la planilla de la v1 no cuenta como atraso lo planificado en semanas de la v2", async () => {
    const { getPdtpSheetViewByProgram } = await import("@/lib/services/pdtp/sheets")
    const { pdtpSheetActivityStatus, currentPdtpPeriod } = await import("@/lib/services/pdtp/period")
    const { v1Id } = await seedRevisedYear()
    const view = await getPdtpSheetViewByProgram(v1Id, SHEET_CODE, "ws-1")
    const [row] = view!.activities
    const today = currentPdtpPeriod()
    const status = pdtpSheetActivityStatus(row!, today, { programYear: YEAR, today })
    expect(status.status).toBe("overdue")
    // Sólo marzo: agosto ya es de la v2.
    expect(status.overdueMonths).toBe(1)
    expect(row!.effectiveMonthlyPlanned[7]).toBe(0)
  })

  it("el indicador de la v1 cerrada no exige las semanas de la v2", async () => {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const { v1Id, v2Id } = await seedRevisedYear()
    const v1 = await getPdtpComplianceIndicators(v1Id, "ws-1")
    expect(v1!.annual.planned).toBe(1)
    expect(v1!.monthly[7]!.planned).toBe(0)
    const v2 = await getPdtpComplianceIndicators(v2Id, "ws-1")
    expect(v2!.annual.planned).toBe(1)
    expect(v2!.monthly[2]!.planned).toBe(0)
  })
})

describe("C05-B — la acreditación resuelve la versión por el período del hecho", () => {
  it("un hecho planificado en marzo que llega después de activar la v2 va a la v1", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const { v1ActivityId } = await seedRevisedYear()
    await inMemoryDb.update(schema.pdtpPrograms).set({ appliesToAllWorksites: true })
    const result = await accreditPdtpFromEvent({
      worksiteId: "ws-1",
      occurredAt: `${YEAR}-09-10T15:00:00.000Z`,
      plannedPeriod: { year: YEAR, month: 3, week: 2 },
      activityNumbers: [ACTIVITY_N],
      sourceType: "capacitacion_ocurrencia",
      sourceId: "occ-marzo",
    } as never)
    expect(result.accredited.map((item: { activityId: string }) => item.activityId)).toEqual([v1ActivityId])
  })

  it("un hecho de la semana de activación de la v2, anterior a la hora de activación, va a la v2", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const { v2ActivityId } = await seedRevisedYear()
    await inMemoryDb.update(schema.pdtpPrograms).set({ appliesToAllWorksites: true })
    const result = await accreditPdtpFromEvent({
      worksiteId: "ws-1",
      occurredAt: `${YEAR}-07-02T15:00:00.000Z`,
      activityNumbers: [ACTIVITY_N],
      sourceType: "capacitacion_ocurrencia",
      sourceId: "occ-semana-activacion",
    } as never)
    expect(result.accredited.map((item: { activityId: string }) => item.activityId)).toEqual([v2ActivityId])
  })
})

describe("C05-B — las lecturas de ventana", () => {
  it("resuelve la ventana de cada versión del año", async () => {
    const { loadPdtpYearVersionWindows } = await import("@/lib/services/pdtp/version-window")
    const { v1Id, v2Id } = await seedRevisedYear()
    const windows = await loadPdtpYearVersionWindows(YEAR)
    expect(windows.map((window) => window.programId)).toEqual([v1Id, v2Id])
    expect(windows[0]).toMatchObject({ from: { month: 1, week: 1 }, until: { month: 7, week: 1 } })
    expect(windows[1]).toMatchObject({ from: { month: 7, week: 1 }, until: null })
  })

  it("una actividad existente en la v1 sigue siendo la misma en la v2 (clave de consolidación)", async () => {
    const { v1ActivityId, v2ActivityId } = await seedRevisedYear()
    const rows = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(and(eq(schema.pdtpActivities.n, ACTIVITY_N)))
    expect(rows.map((row) => row.id).sort()).toEqual([v1ActivityId, v2ActivityId].sort())
  })
})

async function approvedExecution(activityId: string, month: number, week: number, quantity = 1) {
  const { markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
  const execution = await markPdtpExecution({
    activityId, worksiteId: "ws-1", year: YEAR, month, week, executedQuantity: quantity, evidenceUrl: EVIDENCE_URL,
  }, "user-1", "all")
  return approvePdtpExecution(execution.id, "user-2", "all")
}

describe("C05-C — el indicador anual se consolida entre versiones", () => {
  it("con una sola versión el consolidado es idéntico al indicador del programa", async () => {
    const { getPdtpComplianceIndicators, getPdtpYearComplianceIndicators, getPdtpComplianceIndicatorsForScope } = await import("@/lib/services/pdtp/compliance")
    const { v1Id, v1ActivityId } = await seedRevisedYear({ revise: false, cells: [[2, 1], [3, 2], [5, 3], [8, 2], [11, 4]] })
    await approvedExecution(v1ActivityId, 3, 2, 3)
    await approvedExecution(v1ActivityId, 5, 3)
    for (const [yearOrProgram, worksite] of [[v1Id, "ws-1"], [YEAR, "ws-1"], [v1Id, undefined]] as const) {
      const own = await getPdtpComplianceIndicators(yearOrProgram, worksite)
      const { versions, ...consolidated } = (await getPdtpYearComplianceIndicators(yearOrProgram, worksite))!
      expect(consolidated).toEqual(own)
      expect(versions.map((version) => version.programId)).toEqual([v1Id])
    }
    const scoped = await getPdtpComplianceIndicatorsForScope(v1Id, ["ws-1"])
    const { versions: _versions, ...scopedYear } = (await getPdtpComplianceIndicatorsForScope(v1Id, ["ws-1"], { consolidateYear: true }))!
    expect(scopedYear).toEqual(scoped)
  })

  it("suma lo de cada versión en su ventana: el anual ya no parte en la activación de la v2", async () => {
    const { getPdtpYearComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const { v1Id, v2Id, v1ActivityId, v2ActivityId } = await seedRevisedYear()
    await approvedExecution(v1ActivityId, 3, 2)
    await approvedExecution(v2ActivityId, 8, 2)
    const year = await getPdtpYearComplianceIndicators(v2Id, "ws-1")
    expect(year!.annual).toMatchObject({ planned: 2, executed: 2, percent: 1 })
    expect(year!.programId).toBe(v2Id)
    expect(year!.versions.map((version) => [version.programId, version.version])).toEqual([[v1Id, 1], [v2Id, 2]])
    expect(year!.versions[0]!.label).toMatch(/^v1 .*hasta la activación de v2/)
  })

  it("una misma actividad en cero en las dos versiones cuenta una vez", async () => {
    const { getPdtpYearComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const { v2Id, v2ActivityId } = await seedRevisedYear()
    const year = await getPdtpYearComplianceIndicators(v2Id, "ws-1")
    expect(year!.annual).toMatchObject({ planned: 2, executed: 0, zeroActivityMonths: 2 })
    expect(year!.annual.zeroActivityIds).toEqual([v2ActivityId])
  })

  it("en el mes partido por la activación, el tope por actividad y mes se aplica sobre la unión", async () => {
    const { getPdtpYearComplianceIndicators, getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    // v2 entra en la semana 3 de julio: julio semana 1 es de v1, semana 3 de v2.
    const { v1Id, v2Id, v1ActivityId } = await seedRevisedYear({ v2ActivatedAt: `${YEAR}-07-16T15:00:00.000Z`, cells: [[7, 1], [7, 3]] })
    await approvedExecution(v1ActivityId, 7, 1, 2)
    const v1 = await getPdtpComplianceIndicators(v1Id, "ws-1")
    const v2 = await getPdtpComplianceIndicators(v2Id, "ws-1")
    expect(v1!.monthly[6]).toMatchObject({ planned: 1, executed: 1 })
    expect(v2!.monthly[6]).toMatchObject({ planned: 1, executed: 0 })
    const year = await getPdtpYearComplianceIndicators(v2Id, "ws-1")
    expect(year!.monthly[6]).toMatchObject({ planned: 2, executed: 2 })
  })

  it("el agregado por faenas del tablero también consolida", async () => {
    const { getPdtpComplianceIndicatorsForScope } = await import("@/lib/services/pdtp/compliance")
    const { v2Id, v1ActivityId } = await seedRevisedYear()
    await approvedExecution(v1ActivityId, 3, 2)
    const scoped = await getPdtpComplianceIndicatorsForScope(v2Id, ["ws-1"], { consolidateYear: true })
    expect(scoped!.annual).toMatchObject({ planned: 2, executed: 1 })
    expect(scoped!.versions?.length).toBe(2)
    const own = await getPdtpComplianceIndicatorsForScope(v2Id, ["ws-1"])
    expect(own!.annual).toMatchObject({ planned: 1, executed: 0 })
  })
})

describe("C05-C — el reporte de gestión es de una versión y lo dice", () => {
  it("el reporte de la v1 cubre sólo su ventana y trae su rótulo", async () => {
    const { getPdtpManagementReport } = await import("@/lib/services/pdtp/management-report")
    const { v1Id, v2Id } = await seedRevisedYear()
    // El reporte mide lo calendarizado.
    await inMemoryDb.update(schema.pdtpActivities).set({ scheduleMode: "scheduled" })
    const v1 = await getPdtpManagementReport({ programId: v1Id, worksiteId: "ws-1", scope: "all" })
    expect(v1!.activities[0]).toMatchObject({ planned: 1 })
    expect(v1!.programVersion).toBe(1)
    expect(v1!.versionLabel).toMatch(/^v1 .*hasta la activación de v2/)
    const v2 = await getPdtpManagementReport({ programId: v2Id, worksiteId: "ws-1", scope: "all" })
    expect(v2!.activities[0]).toMatchObject({ planned: 1 })
    expect(v2!.versionLabel).toMatch(/^v2 \(desde el/)
  })
})

describe("C05-D — la activación traspasa desvíos y asignaciones a la versión nueva", () => {
  // Activación "hoy" (15-oct, semana 3): la ventana de v2 empieza ahí.
  const ACTIVATED_NOW = `${YEAR}-10-15T15:00:00.000Z`

  async function seedHandover() {
    const seeded = await seedRevisedYear({ v2ActivatedAt: ACTIVATED_NOW, cells: [[10, 2], [10, 3], [11, 2]] })
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-2", name: "Faena 2", code: "F2", isActive: true },
      { id: "ws-3", name: "Faena 3", code: "F3", isActive: true },
    ])
    const createdAt = new Date().toISOString()
    const base = { activityId: seeded.v1ActivityId, year: YEAR, reason: REASON, createdByUserId: "user-1", createdAt }
    await inMemoryDb.insert(schema.pdtpExecutionDeviations).values([
      // En la semana de activación: ya es de v2.
      { ...base, id: "dev-na-pending", worksiteId: "ws-1", month: 10, week: 3, kind: "not_applicable", status: "pending_review" },
      { ...base, id: "dev-np-active", worksiteId: "ws-2", month: 10, week: 3, kind: "not_performed", status: "active" },
      // Origen en la ventana de v1, destino en la de v2.
      { ...base, id: "dev-reprog", worksiteId: "ws-1", month: 10, week: 2, kind: "reprogrammed", targetMonth: 11, targetWeek: 2, status: "active" },
      // Enteramente de v1: no se toca.
      { ...base, id: "dev-own-v1", worksiteId: "ws-2", month: 10, week: 2, kind: "not_performed", status: "active" },
      // v2 excluye la actividad en esta faena: no hay dónde traspasarlo.
      { ...base, id: "dev-excluded", worksiteId: "ws-3", month: 10, week: 3, kind: "not_performed", status: "active" },
    ])
    await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
      id: "excl-v2-ws3", activityId: seeded.v2ActivityId, worksiteId: "ws-3", reason: "La faena no aplica en la versión nueva", createdAt,
    })
    return seeded
  }

  it("traspasa cada desvío abierto de la ventana de v2 con su estado, y retira el original", async () => {
    const { handoverPdtpOperationalLayer } = await import("@/lib/services/pdtp/operational-handover")
    const { v1Id, v2Id, v2ActivityId } = await seedHandover()
    const result = await inMemoryDb.transaction((tx) => handoverPdtpOperationalLayer([v1Id], v2Id, {
      today: `${YEAR}-10-15`, userId: "user-2", activatedAt: ACTIVATED_NOW,
    }, tx as never))

    const moved = await inMemoryDb.select().from(schema.pdtpExecutionDeviations)
      .where(eq(schema.pdtpExecutionDeviations.activityId, v2ActivityId))
    const byCell = new Map(moved.map((row) => [`${row.worksiteId}:${row.month}:${row.week}:${row.kind}`, row]))
    // D24/C07: el "no aplica" en revisión sigue en revisión, ahora en v2, con quien lo declaró.
    expect(byCell.get("ws-1:10:3:not_applicable")).toMatchObject({ status: "pending_review", createdByUserId: "user-1", reason: REASON })
    expect(byCell.get("ws-2:10:3:not_performed")).toMatchObject({ status: "active" })
    expect(byCell.get("ws-1:10:2:reprogrammed")).toMatchObject({ status: "active", targetMonth: 11, targetWeek: 2 })
    expect(moved).toHaveLength(3)

    const originals = new Map((await inMemoryDb.select().from(schema.pdtpExecutionDeviations)
      .where(eq(schema.pdtpExecutionDeviations.activityId, (await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, v1Id)))[0]!.id)))
      .map((row) => [row.id, row]))
    expect(originals.get("dev-na-pending")).toMatchObject({ status: "withdrawn", withdrawnByUserId: "user-2" })
    expect(originals.get("dev-na-pending")!.withdrawReason).toMatch(/v2/)
    expect(originals.get("dev-np-active")!.status).toBe("withdrawn")
    // La reprogramación sigue sacando el planificado del origen, que es de v1.
    expect(originals.get("dev-reprog")!.status).toBe("active")
    expect(originals.get("dev-own-v1")!.status).toBe("active")
    // Sin destino válido en v2: se retira igual (ya no es de v1) y queda explicado.
    expect(originals.get("dev-excluded")!.status).toBe("withdrawn")
    expect(result.deviations.handed).toBe(3)
    expect(result.deviations.skipped).toEqual([expect.objectContaining({ deviationId: "dev-excluded", reason: expect.stringMatching(/excluida/) })])

    const [log] = await inMemoryDb.select().from(schema.pdtpChangeLog)
      .where(and(eq(schema.pdtpChangeLog.programId, v2Id), eq(schema.pdtpChangeLog.section, "handover")))
    expect(log!.note).toMatch(/3 desvíos/)
    expect(log!.note).toMatch(/excluida/)
  })

  it("es idempotente: repetir el traspaso no duplica", async () => {
    const { handoverPdtpOperationalLayer } = await import("@/lib/services/pdtp/operational-handover")
    const { v1Id, v2Id, v2ActivityId } = await seedHandover()
    const run = () => inMemoryDb.transaction((tx) => handoverPdtpOperationalLayer([v1Id], v2Id, {
      today: `${YEAR}-10-15`, userId: "user-2", activatedAt: ACTIVATED_NOW,
    }, tx as never))
    await run()
    const again = await run()
    expect(again.deviations.handed).toBe(0)
    expect(await inMemoryDb.select().from(schema.pdtpExecutionDeviations).where(eq(schema.pdtpExecutionDeviations.activityId, v2ActivityId))).toHaveLength(3)
  })

  it("también traspasa las asignaciones nominales (reutiliza el traspaso de T0)", async () => {
    const { handoverPdtpOperationalLayer } = await import("@/lib/services/pdtp/operational-handover")
    const { v1Id, v2Id, v1ActivityId, v2ActivityId } = await seedHandover()
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpActivityWorksiteAssignees).values({
      id: "asg-v1", activityId: v1ActivityId, worksiteId: "ws-1", userId: "user-1", validFrom: `${YEAR}-01-01`, createdAt: now, updatedAt: now,
    })
    const result = await inMemoryDb.transaction((tx) => handoverPdtpOperationalLayer([v1Id], v2Id, {
      today: `${YEAR}-10-15`, userId: "user-2", activatedAt: ACTIVATED_NOW,
    }, tx as never))
    expect(result.assignees).toBe(1)
    const moved = await inMemoryDb.select().from(schema.pdtpActivityWorksiteAssignees).where(eq(schema.pdtpActivityWorksiteAssignees.activityId, v2ActivityId))
    expect(moved).toHaveLength(1)
  })
})
