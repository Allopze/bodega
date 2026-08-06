import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { extractPdtpCatalogFromWorkbook, readPdtpWorkbook } from "@/lib/services/prevention-pdtp-catalog"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

// H-B7: en tests, los archivos físicos no existen. Para los tests que
// usan evidenceUrl, pre-creamos los archivos en el FS real.
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const tmpEvidenceDir = join(tmpdir(), "pdtp-evidence-test")
mkdirSync(tmpEvidenceDir, { recursive: true })

vi.mock("@/lib/storage/config", () => ({
  resolvePdtpEvidenceFile: (filePath: string) => {
    if (typeof filePath === "string" && filePath.startsWith("storage/pdtp-evidence/")) {
      return join(tmpEvidenceDir, filePath.slice("storage/pdtp-evidence/".length))
    }
    return null
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.operationalActivityEvents)
  await inMemoryDb.delete(schema.preventionRiskLegalHistory)
  await inMemoryDb.delete(schema.pdtpObligationReminders)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpProgramTemplateVersions)
  await inMemoryDb.delete(schema.pdtpProgramTemplates)
  await inMemoryDb.delete(schema.pdtpSheetActivities)
  await inMemoryDb.delete(schema.pdtpSheets)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  // createActionPlanItem (usado por el test del expediente auditor) crea un
  // registro CAPA espejo por cada acción PDTP (pdtp_action_plan.capa_action_id
  // referencia prevention_capa_actions con onDelete: "restrict"). Hay que
  // borrar pdtpExecutions primero (cascada a pdtpActionPlan) y solo entonces
  // las tablas CAPA, o el DELETE de prevention_capa_actions queda bloqueado
  // por filas de pdtp_action_plan que todavía la referencian.
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.preventionCapaEvidence)
  await inMemoryDb.delete(schema.preventionCapaFollowups)
  await inMemoryDb.delete(schema.preventionCapaTransitions)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.pdtpImportRows)
  await inMemoryDb.delete(schema.pdtpImportBatches)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([
    { id: "user-1", name: "Elaboradora", email: "prev@example.test", hashedPassword: "x" },
    { id: "user-jdpr", name: "Jefatura DPR", email: "jdpr@example.test", hashedPassword: "x" },
    { id: "user-jdpr-2", name: "Jefatura DPR suplente", email: "jdpr2@example.test", hashedPassword: "x" },
    { id: "user-legal", name: "Legal", email: "legal@example.test", hashedPassword: "x" },
  ])
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-1",
    name: "Faena A",
    code: "FA",
    isActive: true,
  })
})

describe("prevention PDTP service", () => {
  const prepareProgramForReview = async (programId: string) => {
    await inMemoryDb.update(schema.pdtpActivities)
      .set({ scheduleClassificationStatus: "confirmed" })
      .where(eq(schema.pdtpActivities.programId, programId))
    await inMemoryDb.update(schema.pdtpActivities)
      .set({ dueDays: 5, evidenceRequirement: "Registro verificable del caso", indicatorMode: "closed_on_time" })
      .where(eq(schema.pdtpActivities.programId, programId))
  }

  const loadCatalog = async () => {
    const { loadPdtpCatalog } = await import("@/lib/services/prevention-pdtp")
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)
    return loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })
  }

  const loadActiveCatalog = async () => {
    const { submitPdtpProgramForReview, approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } =
      await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    await prepareProgramForReview(program.id)
    await submitPdtpProgramForReview(program.id, "user-1")
    await approvePdtpProgramJdpr(program.id, "user-jdpr")
    await signPdtpProgramLegal(program.id, "user-legal")
    await activatePdtpProgram(program.id, "user-jdpr")
    return program
  }

  const submitForReview = async (programId: string) => {
    const { submitPdtpProgramForReview } = await import("@/lib/services/prevention-pdtp")
    await prepareProgramForReview(programId)
    return submitPdtpProgramForReview(programId, "user-1")
  }

  it("loads the Excel catalog idempotently into the PDTP program tables", async () => {
    const { loadPdtpCatalog } = await import("@/lib/services/prevention-pdtp")
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    const first = await loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })
    const second = await loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })

    expect(second.program.id).toBe(first.program.id)

    const activities = await inMemoryDb.select().from(schema.pdtpActivities)
    const sheets = await inMemoryDb.select().from(schema.pdtpSheets)
    const memberships = await inMemoryDb.select().from(schema.pdtpSheetActivities)
    const schedule = await inMemoryDb.select().from(schema.pdtpActivitySchedule)

    expect(activities).toHaveLength(87)
    expect(sheets).toHaveLength(8)
    const expectedMemberships = Object.values(catalog.sheetActivities).reduce((sum, items) => sum + items.length, 0)
    expect(memberships).toHaveLength(expectedMemberships)
    expect(schedule.some((cell) => cell.plannedQuantity === 5)).toBe(true)
  })

  it("creates one annual program concurrently, pins its base revision and remaps the calendar", async () => {
    const {
      createAnnualPdtpProgram,
      createPdtpTemplateVersion,
      updatePdtpActivity,
    } = await import("@/lib/services/prevention-pdtp")
    const { program: baseProgram } = await loadCatalog()
    const baseV1 = await createPdtpTemplateVersion({
      sourceProgramId: baseProgram.id,
      name: "Base preventiva 2026",
      description: "Base anual oficial de prueba",
      userId: "user-1",
      allowUnclassifiedBaseActivities: true,
    })

    const createdTogether = await Promise.all([
      createAnnualPdtpProgram({ year: 2027, userId: "user-1" }),
      createAnnualPdtpProgram({ year: 2027, userId: "user-1" }),
    ])
    expect(new Set(createdTogether.map((result) => result.programId))).toEqual(new Set(["pdtp-2027-v1"]))
    expect(createdTogether.filter((result) => result.created)).toHaveLength(1)

    const [program2027] = await inMemoryDb.select().from(schema.pdtpPrograms)
      .where(eq(schema.pdtpPrograms.year, 2027))
    expect(program2027?.version).toBe(1)
    expect(program2027?.sourceTemplateVersionId).toBe(baseV1.version.id)
    const activities2027 = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, program2027!.id))
    const schedules2027 = await inMemoryDb.select().from(schema.pdtpActivitySchedule)
      .where(inArray(schema.pdtpActivitySchedule.activityId, activities2027.map((activity) => activity.id)))
    expect(activities2027).toHaveLength(87)
    expect(schedules2027).toHaveLength(821)
    expect(new Set(schedules2027.map((cell) => cell.year))).toEqual(new Set([2027]))
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)

    const [baseActivity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, baseProgram.id))
      .limit(1)
    await updatePdtpActivity({
      activityId: baseActivity!.id,
      notes: "Corrección publicada después de crear el programa 2027.",
    }, "user-1")
    const baseV2 = await createPdtpTemplateVersion({
      sourceProgramId: baseProgram.id,
      name: "Base preventiva 2026",
      description: "Segunda revisión oficial de prueba",
      userId: "user-1",
      allowUnclassifiedBaseActivities: true,
    })
    expect(baseV2.version.version).toBe(2)

    const created2028 = await createAnnualPdtpProgram({ year: 2028, userId: "user-1" })
    expect(created2028.baseVersionId).toBe(baseV2.version.id)
    const [program2027After] = await inMemoryDb.select().from(schema.pdtpPrograms)
      .where(eq(schema.pdtpPrograms.year, 2027))
    expect(program2027After?.sourceTemplateVersionId).toBe(baseV1.version.id)
  })

  it("inherits and overrides scope, planning, targets and responsible by worksite", async () => {
    const {
      computePdtpProgramContentDigest,
      resolvePdtpEffectiveActivitiesForWorksite,
      setPdtpActivityWorksiteAdjustment,
    } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, program.id))
      .limit(1)
    const globalResponsible = activity!.responsibleDisplay
    const beforeDigest = await computePdtpProgramContentDigest(program.id)

    await setPdtpActivityWorksiteAdjustment({
      activityId: activity!.id,
      worksiteId: "ws-1",
      excluded: false,
      reason: "Ajuste específico requerido por la faena A.",
      expectedSubjectCount: 25,
      targetCoveragePercent: 90,
      responsibleSlugs: ["jdpr"],
      responsibleDisplay: "Jefatura DPR de Faena A",
      schedule: [{ month: 1, week: 1, plannedQuantity: 3 }],
    }, "user-1", ["ws-1"])

    const [params] = await inMemoryDb.select().from(schema.pdtpActivityWorksiteParams)
      .where(and(
        eq(schema.pdtpActivityWorksiteParams.activityId, activity!.id),
        eq(schema.pdtpActivityWorksiteParams.worksiteId, "ws-1"),
      ))
    const overrides = await inMemoryDb.select().from(schema.pdtpActivityScheduleOverrides)
      .where(and(
        eq(schema.pdtpActivityScheduleOverrides.activityId, activity!.id),
        eq(schema.pdtpActivityScheduleOverrides.worksiteId, "ws-1"),
      ))
    expect(params).toEqual(expect.objectContaining({
      expectedSubjectCount: 25,
      targetCoveragePercent: 90,
      responsibleSlugs: ["jdpr"],
      responsibleDisplay: "Jefatura DPR de Faena A",
    }))
    expect(overrides).toEqual([expect.objectContaining({ month: 1, week: 1, plannedQuantity: 3 })])
    expect((await computePdtpProgramContentDigest(program.id)).digest).not.toBe(beforeDigest.digest)

    await setPdtpActivityWorksiteAdjustment({
      activityId: activity!.id,
      worksiteId: "ws-1",
      excluded: true,
      reason: "La actividad no resulta aplicable en esta faena.",
    }, "user-1", ["ws-1"])
    expect((await resolvePdtpEffectiveActivitiesForWorksite(program.id, "ws-1")).some((item) => item.id === activity!.id)).toBe(false)

    await setPdtpActivityWorksiteAdjustment({
      activityId: activity!.id,
      worksiteId: "ws-1",
      excluded: false,
      reason: "Se restablece la herencia desde la definición global.",
      expectedSubjectCount: null,
      targetCoveragePercent: null,
      responsibleSlugs: null,
      responsibleDisplay: null,
      schedule: null,
    }, "user-1", ["ws-1"])
    const [inheritedParams] = await inMemoryDb.select().from(schema.pdtpActivityWorksiteParams)
      .where(eq(schema.pdtpActivityWorksiteParams.id, params!.id))
    expect(inheritedParams).toEqual(expect.objectContaining({
      expectedSubjectCount: null,
      targetCoveragePercent: null,
      responsibleSlugs: null,
      responsibleDisplay: null,
    }))
    expect(await inMemoryDb.select().from(schema.pdtpActivityScheduleOverrides)
      .where(eq(schema.pdtpActivityScheduleOverrides.activityId, activity!.id))).toHaveLength(0)
    const [inheritedActivity] = (await resolvePdtpEffectiveActivitiesForWorksite(program.id, "ws-1"))
      .filter((item) => item.id === activity!.id)
    expect(inheritedActivity?.responsibleDisplay).toBe(globalResponsible)
  })

  it("retires without renumbering, preserves prior executions and starts new activities at 90", async () => {
    const {
      addPdtpActivity,
      computePdtpProgramContentDigest,
      retirePdtpActivity,
      resolvePdtpEffectiveActivitiesForWorksite,
    } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(and(eq(schema.pdtpActivities.programId, program.id), eq(schema.pdtpActivities.n, 1)))
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "execution-before-retirement",
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 4,
      executedQuantity: 1,
      status: "approved",
      createdAt: now,
      updatedAt: now,
    })

    await retirePdtpActivity({
      activityId: activity!.id,
      reason: "La actividad se reemplaza por un control corporativo equivalente.",
      effectiveFrom: "2026-08-01",
    }, "user-1")
    const [retired] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.id, activity!.id))
    expect(retired).toEqual(expect.objectContaining({ n: 1, status: "retired", retiredEffectiveFrom: "2026-08-01" }))
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, activity!.id))).toHaveLength(1)
    expect((await resolvePdtpEffectiveActivitiesForWorksite(program.id, "ws-1")).some((item) => item.id === activity!.id)).toBe(false)

    const added = await addPdtpActivity({
      programId: program.id,
      activity: "Nueva actividad posterior a la Base 2026",
      program: "Control preventivo complementario",
      responsibleSlugs: ["jdpr"],
      responsibleDisplay: "Jefatura DPR",
      scheduleMode: "scheduled",
      recurrenceRule: { frequency: "annual", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
      evidenceRequirement: "Registro verificable",
      sheetCodes: ["pdtp_general"],
    }, "user-1")
    expect(added.n).toBe(90)
    const digest = await computePdtpProgramContentDigest(program.id)
    expect(JSON.stringify(digest.snapshot)).toContain("\"status\":\"retired\"")
    expect(JSON.stringify(digest.snapshot)).toContain("\"retiredEffectiveFrom\":\"2026-08-01\"")
  })

  it("creates a general program without the eight Excel views and copies its reusable structure", async () => {
    const {
      addPdtpActivity,
      batchUpdatePdtpActivities,
      createLegacyPdtpProgramForTests,
      duplicatePdtpActivity,
      savePdtpActivityChecklist,
      updatePdtpActivity,
    } = await import("@/lib/services/prevention-pdtp")
    const source = await createLegacyPdtpProgramForTests({ year: 2027, title: "Programa preventivo de controles críticos", userId: "user-1" })
    const sourceSheets = await inMemoryDb.select().from(schema.pdtpSheets).where(eq(schema.pdtpSheets.programId, source.id))
    expect(source.creationMode).toBe("blank")
    expect(sourceSheets.map((sheet) => sheet.code)).toEqual(["pdtp_general"])

    const activity = await addPdtpActivity({
      programId: source.id,
      activity: "Verificar controles antes de iniciar cada mes",
      program: "Gestión de controles críticos",
      responsibleSlugs: ["prf"],
      responsibleDisplay: "Prevencionista",
      audienceRoles: ["supervision"],
      scheduleMode: "scheduled",
      recurrenceRule: { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
      evidenceRequirement: "Registro firmado de la verificación",
      indicatorMode: "planned_vs_completed",
      sheetCodes: ["pdtp_general"],
    }, "user-1")
    await savePdtpActivityChecklist({
      activityId: activity.id,
      label: "Control crítico",
      definition: {
        code: "control-critico",
        version: "01",
        revisionDate: "2027-01-01",
        title: "Control crítico",
        tipo: "nuevo",
        legalFramework: [],
        applicableTo: "prf",
        sections: [{ id: "control", title: "Control", items: [{ id: "item", label: "Verificar", kind: "cumple_nocumple_obs" }], }],
        closingAct: { title: "Cierre", resultOptions: [], signatureRoles: ["prf"] },
      },
    })

    const sourceSchedule = await inMemoryDb.select().from(schema.pdtpActivitySchedule).where(eq(schema.pdtpActivitySchedule.activityId, activity.id))
    expect(sourceSchedule).toHaveLength(12)

    const copy = await createLegacyPdtpProgramForTests({
      year: 2028,
      title: "Programa preventivo de controles críticos 2028",
      userId: "user-1",
      copySheetsFromProgramId: source.id,
    })
    const [copiedActivity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, copy.id))
    const copiedSchedule = await inMemoryDb.select().from(schema.pdtpActivitySchedule).where(eq(schema.pdtpActivitySchedule.activityId, copiedActivity!.id))
    const copiedChecklists = await inMemoryDb.select().from(schema.pdtpActivityChecklists).where(eq(schema.pdtpActivityChecklists.programId, copy.id))
    expect(copy).toMatchObject({ creationMode: "program_copy", sourceProgramId: source.id, sourceContentVersion: source.contentVersion })
    expect(copiedActivity).toMatchObject({ scheduleMode: "scheduled", audienceRoles: ["supervision"] })
    expect(copiedActivity!.recurrenceRule).toMatchObject({ frequency: "monthly" })
    expect(copiedSchedule).toHaveLength(12)
    expect(new Set(copiedSchedule.map((cell) => cell.year))).toEqual(new Set([2028]))
    expect(copiedChecklists).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.pdtpApprovalDecisions)).toHaveLength(0)

    const duplicated = await duplicatePdtpActivity(copiedActivity!.id, "user-1")
    const duplicatedSchedule = await inMemoryDb.select().from(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.activityId, duplicated.id))
    const duplicatedMemberships = await inMemoryDb.select().from(schema.pdtpSheetActivities)
      .where(eq(schema.pdtpSheetActivities.activityId, duplicated.id))
    const duplicatedChecklists = await inMemoryDb.select().from(schema.pdtpActivityChecklists)
      .where(eq(schema.pdtpActivityChecklists.activityId, duplicated.id))
    expect(duplicated.activity).toContain("(copia)")
    expect(duplicatedSchedule).toHaveLength(12)
    expect(duplicatedMemberships).toHaveLength(1)
    expect(duplicatedChecklists).toHaveLength(1)

    const moved = await updatePdtpActivity({
      activityId: duplicated.id,
      notes: "Extender controles a nuevas operaciones",
    }, "user-1")
    expect(moved).toMatchObject({ notes: "Extender controles a nuevas operaciones" })
    await batchUpdatePdtpActivities({
      programId: copy.id,
      activityIds: [copiedActivity!.id, duplicated.id],
      responsibleSlugs: ["jdpr"],
      responsibleDisplay: "Jefatura de Prevención",
      evidenceRequirement: "Informe consolidado del control",
    }, "user-1")
    const batchRows = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, copy.id))
    expect(batchRows.every((row) => row.responsibleDisplay === "Jefatura de Prevención")).toBe(true)
    expect(batchRows.every((row) => row.evidenceRequirement === "Informe consolidado del control")).toBe(true)
    expect(await inMemoryDb.select().from(schema.pdtpActivitySchedule).where(eq(schema.pdtpActivitySchedule.activityId, duplicated.id))).toHaveLength(12)
    expect(await inMemoryDb.select().from(schema.pdtpActivityChecklists).where(eq(schema.pdtpActivityChecklists.activityId, duplicated.id))).toHaveLength(1)

    await updatePdtpActivity({
      activityId: copiedActivity!.id,
      scheduleMode: "on_demand",
      recurrenceRule: null,
      dueDays: 5,
      indicatorMode: "closed_on_time",
    }, "user-1")
    expect(await inMemoryDb.select().from(schema.pdtpActivitySchedule).where(eq(schema.pdtpActivitySchedule.activityId, copiedActivity!.id))).toHaveLength(0)
  })

  it("publishes immutable template versions and creates programs from the selected snapshot", async () => {
    const {
      addPdtpActivity,
      createLegacyPdtpProgramForTests,
      createPdtpTemplateVersion,
      listActivePdtpTemplates,
      listPdtpTemplatesWithVersions,
      updatePdtpActivity,
    } = await import("@/lib/services/prevention-pdtp")
    const source = await createLegacyPdtpProgramForTests({ year: 2030, title: "Base corporativa de terreno", userId: "user-1" })
    const sourceActivity = await addPdtpActivity({
      programId: source.id,
      activity: "Inspección mensual de controles críticos",
      program: "Controles críticos",
      responsibleSlugs: ["prf"],
      responsibleDisplay: "Prevencionista",
      audienceRoles: ["supervision"],
      scheduleMode: "scheduled",
      recurrenceRule: { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 2 },
      evidenceRequirement: "Lista de verificación firmada",
      indicatorMode: "planned_vs_completed",
      sheetCodes: ["pdtp_general"],
    }, "user-1")

    const publishedV1 = await createPdtpTemplateVersion({
      sourceProgramId: source.id,
      name: "Controles críticos corporativos",
      description: "Base para operaciones con trabajos críticos",
      userId: "user-1",
    })
    expect(publishedV1.version.version).toBe(1)

    await updatePdtpActivity({
      activityId: sourceActivity.id,
      activity: "Actividad modificada después de publicar v1",
      recurrenceRule: { frequency: "quarterly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
    }, "user-1")

    const fromV1 = await createLegacyPdtpProgramForTests({
      year: 2031,
      title: "Programa contractual 2031",
      userId: "user-1",
      templateVersionId: publishedV1.version.id,
    })
    const [activityFromV1] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, fromV1.id))
    const scheduleFromV1 = await inMemoryDb.select().from(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.activityId, activityFromV1!.id))

    expect(fromV1).toMatchObject({
      creationMode: "template",
      sourceProgramId: source.id,
      sourceContentVersion: publishedV1.version.sourceContentVersion,
      sourceTemplateVersionId: publishedV1.version.id,
    })
    expect(activityFromV1!.activity).toBe("Inspección mensual de controles críticos")
    expect(activityFromV1!.recurrenceRule).toMatchObject({ frequency: "monthly" })
    expect(scheduleFromV1).toHaveLength(12)
    expect(new Set(scheduleFromV1.map((cell) => cell.year))).toEqual(new Set([2031]))

    const publishedV2 = await createPdtpTemplateVersion({
      sourceProgramId: source.id,
      name: "Controles críticos corporativos",
      description: "Segunda versión",
      userId: "user-1",
    })
    const templates = await listActivePdtpTemplates()
    expect(publishedV2.version.version).toBe(2)
    expect(templates).toHaveLength(1)
    expect(templates[0]!.currentVersion.id).toBe(publishedV2.version.id)
    const inventory = await listPdtpTemplatesWithVersions()
    expect(inventory[0]!.versions.map((version) => version.version)).toEqual([2, 1])
    expect(inventory[0]!.versions.find((version) => version.version === 1)?.programs.map((program) => program.id)).toEqual([fromV1.id])
    expect(inventory[0]!.versions.find((version) => version.version === 2)?.programs).toHaveLength(0)

    const [unchangedV1Activity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, fromV1.id))
    expect(unchangedV1Activity!.activity).toBe("Inspección mensual de controles críticos")
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.pdtpApprovalDecisions)).toHaveLength(0)
  })

  it("stages, applies only planning idempotently and rolls back the 2026 workbook", async () => {
    const { readFile } = await import("node:fs/promises")
    const { applyPdtpImportBatch, createLegacyPdtpProgramForTests, rollbackPdtpImportBatch, stagePdtpXlsxImport } = await import("@/lib/services/prevention-pdtp")
    const program = await createLegacyPdtpProgramForTests({ year: 2026, title: "Migración controlada 2026", userId: "user-1" })
    const bytes = await readFile(path.resolve(process.cwd(), "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx"))
    const staged = await stagePdtpXlsxImport({
      programId: program.id,
      bytes,
      fileName: "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      userId: "user-1",
    })
    expect(staged.preview.counts).toMatchObject({ activities: 87, views: 8, plannedCells: 821, plannedQuantity: 1013, executedCells: 0, executedQuantity: 0 })
    expect(await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, program.id))).toHaveLength(0)

    const applied = await applyPdtpImportBatch({
      batchId: staged.batch.id,
      userId: "user-1",
      scope: ["ws-1"],
    })
    expect(applied).toMatchObject({ activityCount: 87, importedExecutionCount: 0 })
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
    await applyPdtpImportBatch({ batchId: staged.batch.id, userId: "user-1", scope: ["ws-1"] })
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)

    await rollbackPdtpImportBatch({ batchId: staged.batch.id, userId: "user-1", reason: "Reversión controlada de prueba", scope: ["ws-1"] })
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, program.id))).toHaveLength(0)
    const [rolledBack] = await inMemoryDb.select().from(schema.pdtpImportBatches).where(eq(schema.pdtpImportBatches.id, staged.batch.id))
    expect(rolledBack!.status).toBe("rolled_back")
  })

  it("returns a read-only sheet view with monthly planned totals", async () => {
    const { loadPdtpCatalog, getPdtpSheetView } = await import("@/lib/services/prevention-pdtp")
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    await loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })

    const view = await getPdtpSheetView(2026, "sup_jt")

    expect(view?.sheet.label).toBe("Supervisión y jefatura de terreno")
    expect(view?.activities).toHaveLength(18)
    expect(view?.activities.map((activity) => activity.n)).toEqual([
      15, 24, 26, 29, 31, 34, 38, 39, 40, 52, 64, 66, 68, 69, 71, 73, 75, 76,
    ])
    expect(view?.monthlyTotals.some((month) => month.planned > 0)).toBe(true)
    expect(view?.activities.find((activity) => activity.n === 38)?.totalPlanned).toBeGreaterThan(12)
  })

  it("marks weekly execution quantities idempotently inside worksite scope", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 38))

    const first = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 3,
      evidenceText: "Charla ejecutada en turno A",
    }, "user-1", ["ws-1"])

    const second = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 5,
      evidenceText: "Charla completada",
    }, "user-1", ["ws-1"])

    expect(second.id).toBe(first.id)
    expect(second.executedQuantity).toBe(5)
    expect(second.evidenceText).toBe("Charla completada")

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(executions).toHaveLength(1)

    await expect(markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 2,
      executedQuantity: 1,
    }, "user-1", [])).rejects.toThrow(/sin acceso/i)
  })

  it("markPdtpExecution rejects execution against a draft program", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    // Program is created in `draft` by loadCatalog — no activation here.
    const { program } = await loadCatalog()
    const [activity] = await inMemoryDb.select()
      .from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, program.id))
      .limit(1)

    await expect(markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])).rejects.toThrow(/estado activo/i)

    // No execution row should be persisted.
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(executions).toHaveLength(0)
  })

  it("includes execution totals for the selected worksite in the sheet view", async () => {
    const { markPdtpExecution, getPdtpSheetView } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 38))
    await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 4,
    }, "user-1", ["ws-1"])

    const view = await getPdtpSheetView(2026, "sup_jt", "ws-1")
    const row = view?.activities.find((item) => item.n === 38)

    expect(row?.monthlyExecuted[0]).toBe(4)
    expect(row?.totalExecuted).toBe(4)
    expect(view?.monthlyTotals[0]?.executed).toBe(4)
  })

  it("builds an Excel report payload for the selected sheet and worksite", async () => {
    const { loadPdtpCatalog, buildPdtpExport } = await import("@/lib/services/prevention-pdtp")
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    await loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })

    const report = await buildPdtpExport({ year: 2026, sheetCode: "cphs", worksiteId: "ws-1", scope: ["ws-1"] })

    expect(report.filenameBase).toBe("pdtp-sg-sst-2026-cphs")
    expect(report.worksheetName).toBe("Comité Paritario Higiene SST")
    expect(report.headers).toContain("Ene P")
    expect(report.headers).toContain("Ene E")
    expect(report.rows).toHaveLength(4)
    expect(report.rows[0]?.[0]).toBe(11)
  })

  it("keeps action-plan export rows inside the selected worksite and caller scope", async () => {
    const { buildPdtpExport, markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-2", name: "Faena B", code: "FB", isActive: true })
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 38))
    const executionA = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 1, week: 1, executedQuantity: 1,
    }, "user-1", "all")
    const executionB = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-2", year: 2026, month: 1, week: 1, executedQuantity: 1,
    }, "user-1", "all")
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpActionPlan).values([
      {
        id: "action-ws-1", executionId: executionA.id, n: 1, origen: "manual", hallazgo: "Hallazgo Faena A",
        accion: "Acción A", responsableRole: "prf", responsable: "Persona A", plazo: "2026-02-01",
        prioridad: "media", estado: "pendiente", createdByUserId: "user-1", createdAt: now, updatedAt: now,
      },
      {
        id: "action-ws-2", executionId: executionB.id, n: 1, origen: "manual", hallazgo: "Hallazgo Faena B",
        accion: "Acción B", responsableRole: "prf", responsable: "Persona B", plazo: "2026-02-01",
        prioridad: "media", estado: "pendiente", createdByUserId: "user-1", createdAt: now, updatedAt: now,
      },
    ])

    const report = await buildPdtpExport({ year: 2026, sheetCode: "pdtp_general", worksiteId: "ws-1", scope: ["ws-1"] })
    const actionRows = report.sheets?.find((sheet) => sheet.worksheetName === "Plan de acción")?.rows ?? []
    expect(JSON.stringify(actionRows)).toContain("Hallazgo Faena A")
    expect(JSON.stringify(actionRows)).not.toContain("Hallazgo Faena B")

    await expect(buildPdtpExport({
      year: 2026, sheetCode: "pdtp_general", worksiteId: "ws-2", scope: ["ws-1"],
    })).rejects.toThrow(/sin acceso/i)
  })

  it("getPdtpComplianceIndicators returns 0 executions when none recorded", async () => {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/prevention-pdtp")
    await loadCatalog()

    const result = await getPdtpComplianceIndicators(2026, "ws-1")

    expect(result).not.toBeNull()
    expect(result!.target).toBe(0.9)
    expect(result!.monthly).toHaveLength(12)
    // All months have planned activities (global program)
    expect(result!.monthly.some((m) => m.planned > 0)).toBe(true)
    // No executions yet
    expect(result!.monthly.every((m) => m.executed === 0)).toBe(true)
    expect(result!.annual.executed).toBe(0)
    // Month 1 (January) has programmed activities in the Excel
    expect(result!.monthly[0]!.planned).toBe(76)
  })

  it("getPdtpComplianceIndicators suma solo cantidades aprobadas", async () => {
    const { getPdtpComplianceIndicators, markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const activities = await inMemoryDb.select().from(schema.pdtpActivities)
    const act1 = activities[0]!
    const act2 = activities[1]!

    // La misma actividad ejecutada tres veces aporta tres al cumplimiento.
    const exec1 = await markPdtpExecution({
      activityId: act1.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 3,
    }, "user-1", ["ws-1"])
    // Una segunda actividad aporta su propia cantidad al total mensual.
    const exec2 = await markPdtpExecution({
      activityId: act2.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 2,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(exec2.id, "user-1", ["ws-1"])

    // Force a draft execution (directly insert)
    const act3 = activities[2]!
    const draftId = `${act3.id}-e-ws-1-2026-01-1`
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: draftId,
      activityId: act3.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 1,
      status: "draft",
      evidencePhotos: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const result = await getPdtpComplianceIndicators(2026, "ws-1")
    // Solo act2 (approved) cuenta; submitted y draft se mantienen como avance
    // operativo, pero no forman parte del cumplimiento formal.
    expect(result!.monthly[0]!.executed).toBe(2)
    expect(exec1.status).toBe("submitted")
  })

  it("caps overcompliance at the planned quantity per cell in the indicator (regla R3, respuesta 2.4)", async () => {
    const {
      createLegacyPdtpProgramForTests, addPdtpActivity, submitPdtpProgramForReview, approvePdtpProgramJdpr,
      signPdtpProgramLegal, activatePdtpProgram, markPdtpExecution, approvePdtpExecution,
      getPdtpComplianceIndicators,
    } = await import("@/lib/services/prevention-pdtp")

    const program = await createLegacyPdtpProgramForTests({ year: 2029, title: "Programa con sobrecumplimiento", userId: "user-1" })
    const activity = await addPdtpActivity({
      programId: program.id,
      activity: "Actividad con meta baja y ejecución real mayor",
      program: "Guía de ejecución",
      responsibleSlugs: ["prf"],
      responsibleDisplay: "Prevencionista",
      scheduleMode: "scheduled",
      recurrenceRule: { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
      evidenceRequirement: "Registro verificable",
      indicatorMode: "planned_vs_completed",
      sheetCodes: [],
    }, "user-1")

    await prepareProgramForReview(program.id)
    await submitPdtpProgramForReview(program.id, "user-1")
    await approvePdtpProgramJdpr(program.id, "user-jdpr")
    await signPdtpProgramLegal(program.id, "user-legal")
    await activatePdtpProgram(program.id, "user-jdpr")

    // La meta de la celda (mes 1, sem 1) es 1, pero se ejecutan 3 unidades reales.
    const execution = await markPdtpExecution({
      activityId: activity.id, worksiteId: "ws-1", year: 2029, month: 1, week: 1, executedQuantity: 3,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(execution.id, "user-1", ["ws-1"])

    const result = await getPdtpComplianceIndicators(program.id, "ws-1")
    // Techo (R3): la celda aporta min(3,1)=1 al indicador, no 3; el mes no
    // supera el 100 %.
    expect(result!.monthly[0]).toMatchObject({ planned: 1, executed: 1, percent: 1 })
    // Anual: 12 celdas de 1; solo la primera tiene ejecución, capada a 1.
    expect(result!.annual).toMatchObject({ planned: 12, executed: 1, percent: 0.08 })
    // El dato crudo permanece intacto en pdtpExecutions (el techo es solo del indicador).
    const [raw] = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.id, execution.id))
    expect(raw!.executedQuantity).toBe(3)
  })

  it("coverage activities are all-or-nothing per month (R1/R2, respuesta 2.2)", async () => {
    const {
      createLegacyPdtpProgramForTests, addPdtpActivity, submitPdtpProgramForReview, approvePdtpProgramJdpr,
      signPdtpProgramLegal, activatePdtpProgram, markPdtpExecution, approvePdtpExecution,
      getPdtpComplianceIndicators,
    } = await import("@/lib/services/prevention-pdtp")

    // Padrón inferido: 4 trabajadores activos en ws-1 (+1 inactivo que no cuenta).
    const now0 = new Date().toISOString()
    await inMemoryDb.insert(schema.workers).values(
      [1, 2, 3, 4].map((i) => ({ id: `wk-cov-${i}`, rut: `9.000.00${i}-0`, firstName: `T${i}`, lastName: "Cobertura", position: "Operador", worksiteId: "ws-1", isActive: true, createdAt: now0 }))
        .concat([{ id: "wk-cov-inactivo", rut: "9.000.009-9", firstName: "Ex", lastName: "Trabajador", position: "Operador", worksiteId: "ws-1", isActive: false, createdAt: now0 }]),
    )

    const program = await createLegacyPdtpProgramForTests({ year: 2031, title: "Programa cobertura", userId: "user-1" })
    const mkCoverage = (order: number, name: string) => addPdtpActivity({
      programId: program.id, activity: name,
      program: "Guía", responsibleSlugs: ["prf"], responsibleDisplay: "Prevencionista",
      scheduleMode: "scheduled",
      recurrenceRule: { frequency: "monthly", interval: 1, plannedQuantity: 3, weekOfMonth: 1 },
      evidenceRequirement: "Registro", indicatorMode: "coverage", sheetCodes: [],
    }, "user-1")
    const actUnder = await mkCoverage(1, "Cobertura incompleta")
    const actFull = await mkCoverage(2, "Cobertura completa")

    await prepareProgramForReview(program.id)
    // prepareProgramForReview homogeniza indicatorMode a "closed_on_time"; estas
    // dos actividades son de cobertura, se restablece antes de firmar el programa.
    await inMemoryDb.update(schema.pdtpActivities).set({ indicatorMode: "coverage" })
      .where(inArray(schema.pdtpActivities.id, [actUnder.id, actFull.id]))
    await submitPdtpProgramForReview(program.id, "user-1")
    await approvePdtpProgramJdpr(program.id, "user-jdpr")
    await signPdtpProgramLegal(program.id, "user-legal")
    await activatePdtpProgram(program.id, "user-jdpr")

    // Padrón inferido de la dotación activa = 4 (no del plannedQuantity=3).
    // actUnder cubre 3 (<4) → no acredita nada (todo o nada).
    const e1 = await markPdtpExecution({ activityId: actUnder.id, worksiteId: "ws-1", year: 2031, month: 1, week: 1, executedQuantity: 3 }, "user-1", ["ws-1"])
    await approvePdtpExecution(e1.id, "user-1", ["ws-1"])
    // actFull cubre 4 (=4) → acredita completo.
    const e2 = await markPdtpExecution({ activityId: actFull.id, worksiteId: "ws-1", year: 2031, month: 1, week: 1, executedQuantity: 4 }, "user-1", ["ws-1"])
    await approvePdtpExecution(e2.id, "user-1", ["ws-1"])

    const result = await getPdtpComplianceIndicators(program.id, "ws-1")
    // Mes 1: meta inferida = 4 por actividad; denominador = 4 + 4 = 8;
    // ejecutado = 0 (incompleta) + 4 (completa) = 4.
    expect(result!.monthly[0]).toMatchObject({ planned: 8, executed: 4, percent: 0.5 })
  })

  it("getPdtpComplianceIndicatorsForScope aggregates approved executions across authorized worksites instead of returning 0 without a faena (UX-01)", async () => {
    const { getPdtpComplianceIndicators, getPdtpComplianceIndicatorsForScope, markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-2", name: "Faena B", code: "FB", isActive: true })

    const activities = await inMemoryDb.select().from(schema.pdtpActivities)
    const act1 = activities[0]!
    const act2 = activities[1]!

    const exec1 = await markPdtpExecution({
      activityId: act1.id, worksiteId: "ws-1", year: 2026, month: 1, week: 1, executedQuantity: 3,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(exec1.id, "user-1", ["ws-1"])
    const exec2 = await markPdtpExecution({
      activityId: act2.id, worksiteId: "ws-2", year: 2026, month: 1, week: 1, executedQuantity: 2,
    }, "user-1", ["ws-2"])
    await approvePdtpExecution(exec2.id, "user-1", ["ws-2"])

    // Sin faena, executed queda estructuralmente en 0 aunque haya avance real.
    const unscoped = await getPdtpComplianceIndicators(2026)
    expect(unscoped!.annual.executed).toBe(0)

    // El scope agrega entre faenas (enero, muy por debajo del techo del mes): 3 + 2 = 5.
    const scoped = await getPdtpComplianceIndicatorsForScope(2026, ["ws-1", "ws-2"])
    expect(scoped).not.toBeNull()
    expect(scoped!.worksiteCount).toBe(2)
    expect(scoped!.monthly[0]!.executed).toBe(5)
    expect(scoped!.annual.executed).toBe(5)
    // El planificado se cuenta una vez por faena agregada, no una vez global.
    const single = await getPdtpComplianceIndicators(2026, "ws-1")
    expect(scoped!.annual.planned).toBe(single!.annual.planned * 2)

    // Falla cerrado: sin faenas explícitas no hay agregado.
    expect(await getPdtpComplianceIndicatorsForScope(2026, [])).toBeNull()

    // El desglose por faena viaja junto al agregado: el tablero necesita las dos
    // cosas y antes recalculaba el indicador una vez por faena en un segundo
    // round-trip, además de mostrar 0 % al no elegir faena.
    expect(scoped!.perWorksite.map((entry) => entry.worksiteId)).toEqual(["ws-1", "ws-2"])
    expect(scoped!.perWorksite[0]!.indicators!.annual.executed).toBe(3)
    expect(scoped!.perWorksite[1]!.indicators!.annual.executed).toBe(2)
  })

  it("aplica la regla de dotación CPHS (<25 excluye 11-14) y el cumplimiento respeta la exclusión (R4)", async () => {
    const { syncPdtpCphsHeadcountExclusion, getPdtpComplianceIndicators } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-2", name: "Faena B", code: "FB", isActive: true })

    // 10 trabajadores activos en ws-1 (<25 → CPHS no aplica).
    for (let i = 0; i < 10; i++) {
      await inMemoryDb.insert(schema.workers).values({
        id: `w-${i}`, firstName: "Trab", lastName: `${i}`, worksiteId: "ws-1", isActive: true, createdAt: new Date().toISOString(),
      })
    }

    const result = await syncPdtpCphsHeadcountExclusion(program.id, "ws-1", "user-1")
    expect(result.headcount).toBe(10)
    expect(result.cphsApplies).toBe(false)
    expect(result.changed).toBe(4) // 11, 12, 13 y 14 excluidas
    const exclusions = await inMemoryDb.select().from(schema.pdtpActivityWorksiteExclusions)
      .where(eq(schema.pdtpActivityWorksiteExclusions.worksiteId, "ws-1"))
    expect(exclusions).toHaveLength(4)

    // La única actividad CPHS con plan numérico es la 13 (reunión mensual: 12 u/año).
    // ws-1 la deja fuera del denominador; ws-2 (sin sync) conserva el plan completo.
    const excluded = await getPdtpComplianceIndicators(program.id, "ws-1")
    const full = await getPdtpComplianceIndicators(program.id, "ws-2")
    expect(excluded!.annual.planned).toBe(full!.annual.planned - 12)
  })

  it("program lifecycle freezes a digest and segregates draft → review → active", async () => {
    const { approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram, getActivePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    const programId = program.id

    // Cannot activate without both approvals
    await expect(activatePdtpProgram(programId, "user-jdpr")).rejects.toThrow(/revisión/i)

    const submitted = await submitForReview(programId)
    expect(submitted.status).toBe("in_review")
    expect(submitted.approvedByJdprUserId).toBeNull()
    const reviewed = await approvePdtpProgramJdpr(programId, "user-jdpr")
    expect(reviewed.status).toBe("in_review")
    expect(reviewed.contentDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(reviewed.reviewSnapshotJson).toBeTruthy()
    // Cannot activate with only JDPR approval
    await expect(activatePdtpProgram(programId, "user-jdpr")).rejects.toThrow(/legal/i)

    await expect(signPdtpProgramLegal(programId, "user-jdpr")).rejects.toThrow(/distintas/i)
    await signPdtpProgramLegal(programId, "user-legal")
    await activatePdtpProgram(programId, "user-jdpr")

    const active = await getActivePdtpProgram(2026)
    expect(active?.id).toBe(programId)
    expect(active?.status).toBe("active")
    expect(active?.approvedByJdprUserId).toBe("user-jdpr")
    expect(active?.approvedByLegalUserId).toBe("user-legal")
    expect(active?.activatedByUserId).toBe("user-jdpr")
    expect(active?.activatedAt).toBeTruthy()
  })

  it("blocks review while an imported schedule classification remains unresolved", async () => {
    const { addPdtpActivity, createLegacyPdtpProgramForTests, submitPdtpProgramForReview, updatePdtpActivity } =
      await import("@/lib/services/prevention-pdtp")
    const program = await createLegacyPdtpProgramForTests({ year: 2032, title: "Programa con clasificación pendiente", userId: "user-1" })
    const activity = await addPdtpActivity({
      programId: program.id,
      activity: "Evaluar una condición preventiva heredada",
      program: "Guía por confirmar",
      responsibleSlugs: ["prf"],
      responsibleDisplay: "PRF",
      scheduleMode: "on_demand",
      scheduleClassificationStatus: "needs_review",
      sheetCodes: ["pdtp_general"],
    }, "user-1")

    await expect(submitPdtpProgramForReview(program.id, "user-1")).rejects.toThrow(/requieren confirmar cuándo/i)
    await updatePdtpActivity({
      activityId: activity.id,
      scheduleMode: "triggered",
      scheduleClassificationStatus: "confirmed",
      triggerType: "desviacion_critica",
      triggerDescription: "Cuando se detecta una desviación crítica",
      dueDays: 2,
      evidenceRequirement: "Registro de la desviación y cierre verificable",
      indicatorMode: "closed_on_time",
    }, "user-1")
    await expect(submitPdtpProgramForReview(program.id, "user-1")).resolves.toMatchObject({ status: "in_review" })
  })

  it("rejects self-approval by the elaborator", async () => {
    const { approvePdtpProgramJdpr } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    await submitForReview(program.id)
    await expect(approvePdtpProgramJdpr(program.id, "user-1")).rejects.toThrow(/elaboró/i)
  })

  it("treats an identical lifecycle retry as idempotent", async () => {
    const { approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    const firstSubmission = await submitForReview(program.id)
    const retriedSubmission = await submitForReview(program.id)
    expect(retriedSubmission.contentDigest).toBe(firstSubmission.contentDigest)
    const firstReview = await approvePdtpProgramJdpr(program.id, "user-jdpr")
    const retriedReview = await approvePdtpProgramJdpr(program.id, "user-jdpr")
    expect(retriedReview.contentDigest).toBe(firstReview.contentDigest)
    await expect(approvePdtpProgramJdpr(program.id, "user-jdpr-2")).rejects.toThrow(/ya fue resuelto/i)

    await signPdtpProgramLegal(program.id, "user-legal")
    await signPdtpProgramLegal(program.id, "user-legal")
    await activatePdtpProgram(program.id, "user-jdpr")
    await activatePdtpProgram(program.id, "user-jdpr")

    const lifecycleEntries = await inMemoryDb.select().from(schema.pdtpChangeLog)
      .where(eq(schema.pdtpChangeLog.programId, program.id))
    expect(lifecycleEntries.filter((entry) => entry.section === "lifecycle" || entry.section.startsWith("approval:"))).toHaveLength(4)
  })

  it("rejects stale signatures when signed content changes outside the service guards", async () => {
    const { approvePdtpProgramJdpr, signPdtpProgramLegal } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    await submitForReview(program.id)
    await approvePdtpProgramJdpr(program.id, "user-jdpr")
    await inMemoryDb.update(schema.pdtpPrograms).set({ title: "Contenido alterado" }).where(eq(schema.pdtpPrograms.id, program.id))
    await expect(signPdtpProgramLegal(program.id, "user-legal")).rejects.toThrow(/contenido cambió/i)
  })

  it("allows only one concurrent JDPR transition", async () => {
    const { approvePdtpProgramJdpr } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    await submitForReview(program.id)
    const results = await Promise.allSettled([
      approvePdtpProgramJdpr(program.id, "user-jdpr"),
      approvePdtpProgramJdpr(program.id, "user-jdpr-2"),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
  })

  it("runs an ordered configurable approval flow without hardcoded JDPR or Legal steps", async () => {
    const {
      activatePdtpProgram,
      decidePdtpApprovalStep,
      getPdtpApprovalProgress,
      listPdtpApprovalDecisions,
      replacePdtpApprovalSteps,
    } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    await replacePdtpApprovalSteps(program.id, [
      {
        code: "revision_tecnica",
        label: "Revisión técnica",
        requiredPermission: "prevention:pdtp:approve",
        segregationRules: ["not_elaborator"],
      },
      {
        code: "validacion_operacional",
        label: "Validación operacional",
        requiredPermission: "prevention:pdtp:program:manage",
        segregationRules: ["different_from_previous"],
      },
      {
        code: "aprobacion_final",
        label: "Aprobación final",
        requiredPermission: "prevention:pdtp:sign_legal",
        segregationRules: ["different_from_step:revision_tecnica"],
      },
    ], "user-1")

    const submitted = await submitForReview(program.id)
    expect(submitted.contentDigest).toMatch(/^[a-f0-9]{64}$/)
    const progress = await getPdtpApprovalProgress(program.id)
    expect(progress.map((step) => step.code)).toEqual(["revision_tecnica", "validacion_operacional", "aprobacion_final"])
    await expect(replacePdtpApprovalSteps(program.id, [{
      code: "otro",
      label: "Otro paso",
      requiredPermission: "prevention:pdtp:approve",
    }], "user-1")).rejects.toThrow(/bloqueado/i)
    await expect(decidePdtpApprovalStep({
      programId: program.id, stepCode: "validacion_operacional", userId: "user-jdpr-2", decision: "approved",
    })).rejects.toThrow(/Primero debe aprobarse/i)
    await expect(decidePdtpApprovalStep({
      programId: program.id, stepCode: "revision_tecnica", userId: "user-1", decision: "approved",
    })).rejects.toThrow(/elaboró/i)

    const technical = await decidePdtpApprovalStep({
      programId: program.id, stepCode: "revision_tecnica", userId: "user-jdpr", decision: "approved",
    })
    const technicalRetry = await decidePdtpApprovalStep({
      programId: program.id, stepCode: "revision_tecnica", userId: "user-jdpr", decision: "approved",
    })
    expect(technicalRetry.decision.id).toBe(technical.decision.id)
    await expect(decidePdtpApprovalStep({
      programId: program.id, stepCode: "validacion_operacional", userId: "user-jdpr", decision: "approved",
    })).rejects.toThrow(/personas distintas/i)
    await decidePdtpApprovalStep({
      programId: program.id, stepCode: "validacion_operacional", userId: "user-jdpr-2", decision: "approved",
    })
    await expect(activatePdtpProgram(program.id, "user-jdpr")).rejects.toThrow(/Aprobación final/i)
    await decidePdtpApprovalStep({
      programId: program.id, stepCode: "aprobacion_final", userId: "user-legal", decision: "approved",
    })
    const activated = await activatePdtpProgram(program.id, "user-jdpr")
    expect(activated.status).toBe("active")
    expect(activated.approvedByJdprUserId).toBeNull()
    expect(activated.approvedByLegalUserId).toBeNull()

    const decisions = await listPdtpApprovalDecisions(program.id, activated.contentVersion)
    expect(decisions).toHaveLength(3)
    expect(decisions.every((decision) => decision.contentDigest === activated.contentDigest)).toBe(true)
    expect(decisions.map((decision) => decision.stepLabel)).toEqual(["Revisión técnica", "Validación operacional", "Aprobación final"])
  })

  it("activates a template configured with a single approval step", async () => {
    const {
      activatePdtpProgram,
      decidePdtpApprovalStep,
      listPdtpApprovalDecisions,
      replacePdtpApprovalSteps,
    } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    await replacePdtpApprovalSteps(program.id, [{
      code: "aprobacion_unica",
      label: "Aprobación única",
      requiredPermission: "prevention:pdtp:approve",
      segregationRules: ["not_elaborator"],
    }], "user-1")

    await submitForReview(program.id)
    await decidePdtpApprovalStep({
      programId: program.id,
      stepCode: "aprobacion_unica",
      userId: "user-jdpr",
      decision: "approved",
    })
    const activated = await activatePdtpProgram(program.id, "user-jdpr")

    expect(activated.status).toBe("active")
    expect(await listPdtpApprovalDecisions(program.id, activated.contentVersion)).toHaveLength(1)
  })

  it("blocks every signed-content mutation surface once review starts", async () => {
    const {
      approvePdtpProgramJdpr,
      deletePdtpActivityChecklist,
      deletePdtpProgram,
      savePdtpActivityChecklist,
      updatePdtpActivity,
      updatePdtpProgram,
    } = await import("@/lib/services/prevention-pdtp")
    const { linkPdtpActivitySource } = await import("@/lib/services/prevention-risk-legal")
    const { program } = await loadCatalog()
    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, program.id))
      .limit(1)

    const definition = {
      code: "signed-content", version: "01", revisionDate: "2026-01-01", title: "Control firmado", tipo: "nuevo" as const,
      legalFramework: [], applicableTo: "prevencionista_faena",
      sections: [{ id: "control", title: "Control", items: [{ id: "item", label: "Verificar", kind: "cumple_nocumple_obs" as const }] }],
      closingAct: { title: "Cierre", resultOptions: [], signatureRoles: ["prevencionista_faena"] },
    }
    const checklist = await savePdtpActivityChecklist({ activityId: activity!.id, label: "Control firmado", definition })
    const access = {
      userId: "user-1",
      scope: { mode: "some" as const, ids: ["ws-1"] },
      permissions: ["prevention:pdtp:program:manage"],
    }
    await linkPdtpActivitySource({
      activityId: activity!.id,
      worksiteId: "ws-1",
      sourceType: "audit",
      sourceId: "auditoria-interna-1",
      justification: "Auditoría preventiva definida para la faena.",
    }, access)

    await submitForReview(program.id)
    await approvePdtpProgramJdpr(program.id, "user-jdpr")

    await expect(updatePdtpProgram(program.id, { title: "Cambio posterior" }, "user-1")).rejects.toThrow(/bloqueado/i)
    await expect(updatePdtpActivity({ activityId: activity!.id, activity: "Cambio posterior" }, "user-1")).rejects.toThrow(/bloqueado/i)
    await expect(savePdtpActivityChecklist({ activityId: activity!.id, label: "Cambio posterior", definition })).rejects.toThrow(/bloqueado/i)
    await expect(deletePdtpActivityChecklist(checklist.id)).rejects.toThrow(/bloqueado/i)
    await expect(linkPdtpActivitySource({
      activityId: activity!.id,
      worksiteId: "ws-1",
      sourceType: "audit",
      sourceId: "auditoria-interna-2",
      justification: "Cambio posterior al inicio de la revisión.",
    }, access)).rejects.toThrow(/bloqueado/i)
    await expect(deletePdtpProgram(program.id)).rejects.toThrow(/bloqueado/i)
  })

  it("rejects, reopens as a new content version and archives with an audited reason", async () => {
    const {
      approvePdtpProgramJdpr,
      archivePdtpProgram,
      deletePdtpProgram,
      rejectPdtpProgram,
      reopenRejectedPdtpProgram,
      updatePdtpProgram,
    } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    await submitForReview(program.id)
    await approvePdtpProgramJdpr(program.id, "user-jdpr")
    await expect(rejectPdtpProgram(program.id, "user-legal", "corto")).rejects.toThrow(/10 caracteres/i)
    const rejected = await rejectPdtpProgram(
      program.id,
      "user-legal",
      "Falta justificar la programación de actividades críticas.",
    )
    expect(rejected.status).toBe("rejected")
    expect(rejected.rejectionReason).toMatch(/programación/)
    const retriedRejection = await rejectPdtpProgram(
      program.id,
      "user-legal",
      "Falta justificar la programación de actividades críticas.",
    )
    expect(retriedRejection.rejectedAt).toBe(rejected.rejectedAt)

    const reopened = await reopenRejectedPdtpProgram(
      program.id,
      "user-1",
      "Se corregirá la programación observada por Legal.",
    )
    expect(reopened.status).toBe("draft")
    expect(reopened.contentVersion).toBe(2)
    expect(reopened.contentDigest).toBeNull()
    expect(reopened.reviewSnapshotJson).toBeNull()
    expect(reopened.approvedByJdprUserId).toBeNull()
    expect(reopened.approvedByLegalUserId).toBeNull()
    expect(reopened.lastReopenReason).toMatch(/programación/)
    const retriedReopen = await reopenRejectedPdtpProgram(
      program.id,
      "user-1",
      "Se corregirá la programación observada por Legal.",
    )
    expect(retriedReopen.contentVersion).toBe(2)

    await updatePdtpProgram(program.id, { title: "Programa corregido" }, "user-1")
    await submitForReview(program.id)
    const reviewedAgain = await approvePdtpProgramJdpr(program.id, "user-jdpr")
    expect(reviewedAgain.contentDigest).not.toBe(rejected.contentDigest)

    const archived = await archivePdtpProgram(
      program.id,
      "user-jdpr",
      "Se archiva esta revisión porque será reemplazada por otra versión.",
    )
    expect(archived.status).toBe("archived")
    expect(archived.archiveReason).toMatch(/reemplazada/)
    await expect(deletePdtpProgram(program.id)).rejects.toThrow(/bloqueado/i)

    const lifecycleEntries = await inMemoryDb.select().from(schema.pdtpChangeLog)
      .where(eq(schema.pdtpChangeLog.programId, program.id))
    expect(lifecycleEntries.filter((entry) => entry.section === "lifecycle" || entry.section.startsWith("approval:"))).toHaveLength(7)
    expect(lifecycleEntries.some((entry) => entry.note?.includes("rechazado"))).toBe(true)
    expect(lifecycleEntries.some((entry) => entry.note?.includes("reabierto"))).toBe(true)
    expect(lifecycleEntries.some((entry) => entry.note?.includes("archivado"))).toBe(true)
  })

  it("does not reactivate a closed program", async () => {
    const { approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    await submitForReview(program.id)
    await approvePdtpProgramJdpr(program.id, "user-jdpr")
    await signPdtpProgramLegal(program.id, "user-legal")
    await activatePdtpProgram(program.id, "user-jdpr")
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "closed" }).where(eq(schema.pdtpPrograms.id, program.id))

    await expect(activatePdtpProgram(program.id, "user-jdpr")).rejects.toThrow(/revisión/i)
  })

  it("lifecycle transitions write change log entries", async () => {
    const { approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    await submitForReview(program.id)
    await approvePdtpProgramJdpr(program.id, "user-jdpr")
    await signPdtpProgramLegal(program.id, "user-legal")
    await activatePdtpProgram(program.id, "user-jdpr")

    const log = await inMemoryDb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.programId, program.id))
    expect(log.length).toBeGreaterThanOrEqual(3)
    expect(log.some((entry) => entry.section === "approval:jdpr" && String(entry.note).includes("JDPR"))).toBe(true)
    expect(log.some((entry) => entry.section === "approval:legal" && String(entry.note).includes("Legal"))).toBe(true)
    expect(log.some((entry) => entry.section === "lifecycle" && String(entry.note).includes("activado"))).toBe(true)
  })

  it("approvePdtpExecution: submitted→approved, rejects wrong scope", async () => {
    const { markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))
    const exec = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 2,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])

    expect(exec.status).toBe("submitted")

    // Wrong scope → rejected
    await expect(approvePdtpExecution(exec.id, "user-1", ["ws-other"])).rejects.toThrow(/sin acceso/i)

    // Correct scope → approved
    const approved = await approvePdtpExecution(exec.id, "user-1", ["ws-1"])
    expect(approved.status).toBe("approved")
    expect(approved.approvedByUserId).toBe("user-1")

    const events = await inMemoryDb.select().from(schema.operationalActivityEvents)
      .where(eq(schema.operationalActivityEvents.entityId, exec.id))
    expect(events.map((event) => event.eventType)).toEqual([
      "pdtp.execution_submitted",
      "pdtp.execution_approved",
    ])
    expect(events.every((event) => event.worksiteId === "ws-1" && event.actorUserId === "user-1")).toBe(true)

    // Already approved → throws
    await expect(approvePdtpExecution(exec.id, "user-1", ["ws-1"])).rejects.toThrow(/ya fue aprobada/i)
  })

  it("solo permite una transición terminal cuando aprobar y rechazar compiten", async () => {
    const { markPdtpExecution, approvePdtpExecution, rejectPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))
    const execution = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 2,
      week: 2,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])

    const results = await Promise.allSettled([
      approvePdtpExecution(execution.id, "user-1", ["ws-1"]),
      rejectPdtpExecution(execution.id, "user-1", "Revisión concurrente", ["ws-1"]),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const [stored] = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.id, execution.id))
    expect(["approved", "rejected"]).toContain(stored!.status)
  })

  it("listPendingPdtpExecutions: only submitted rows, scope filtering, joined names", async () => {
    const { markPdtpExecution, approvePdtpExecution, listPendingPdtpExecutions } =
      await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-2", name: "Faena B", code: "FB", isActive: true })

    const [act1] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))
    const [act2] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 2))
    const [act3] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 3))

    // Pending, worksite A
    await markPdtpExecution({
      activityId: act1!.id, worksiteId: "ws-1", year: 2026, month: 1, week: 1, executedQuantity: 1,
    }, "user-1", ["ws-1"])
    // Pending, worksite B
    await markPdtpExecution({
      activityId: act2!.id, worksiteId: "ws-2", year: 2026, month: 1, week: 2, executedQuantity: 1,
    }, "user-1", ["ws-2"])
    // Approved (not pending) — must be excluded
    const exec3 = await markPdtpExecution({
      activityId: act3!.id, worksiteId: "ws-1", year: 2026, month: 1, week: 1, executedQuantity: 1,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(exec3.id, "user-1", ["ws-1"])

    const all = await listPendingPdtpExecutions("all", { year: 2026 })
    expect(all).toHaveLength(2)
    expect(all.map((e) => e.worksiteId).sort()).toEqual(["ws-1", "ws-2"])
    const row1 = all.find((e) => e.worksiteId === "ws-1")
    expect(row1?.worksiteName).toBe("Faena A")
    expect(row1?.activityId).toBe(act1!.id)
    expect(row1?.activityName).toBe(act1!.activity)
    expect(row1?.activityN).toBe(1)

    const scopedToA = await listPendingPdtpExecutions(["ws-1"], { year: 2026 })
    expect(scopedToA).toHaveLength(1)
    expect(scopedToA[0]?.worksiteId).toBe("ws-1")

    const scopedToNone = await listPendingPdtpExecutions([], { year: 2026 })
    expect(scopedToNone).toHaveLength(0)
  })

  it("updatePdtpActivity: edits fields and writes change log", async () => {
    const { updatePdtpActivity } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))

    const updated = await updatePdtpActivity({
      activityId: activity!.id,
      activity: "Actividad editada",
      notes: "Nota de prueba",
    }, "user-1")

    expect(updated.activity).toBe("Actividad editada")
    expect(updated.notes).toBe("Nota de prueba")

    const log = await inMemoryDb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.programId, program.id))
    expect(log.length).toBeGreaterThanOrEqual(1)
    expect(log.some((entry) => entry.section === `activity:1`)).toBe(true)
  })

  it("updatePdtpActivity: throws if program is not draft", async () => {
    const { updatePdtpActivity, approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    await submitForReview(program.id)
    await approvePdtpProgramJdpr(program.id, "user-jdpr")
    await signPdtpProgramLegal(program.id, "user-legal")
    await activatePdtpProgram(program.id, "user-jdpr")

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))
    await expect(updatePdtpActivity({ activityId: activity!.id, activity: "X" }, "user-1"))
      .rejects.toThrow(/bloqueado/i)
  })

  it("addPdtpActivity: creates activity with n = maxN + 1 and writes change log", async () => {
    const { addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    const created = await addPdtpActivity({
      programId: program.id,
      activity: "Nueva actividad de prueba",
      program: "Reunión online",
      responsibleSlugs: ["prf"],
      responsibleDisplay: "PRF",
      sheetCodes: ["pdtp_general"],
    }, "user-1")

    expect(created.n).toBe(90)  // 89 existing + 1
    expect(created.activity).toBe("Nueva actividad de prueba")

    const log = await inMemoryDb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.programId, program.id))
    expect(log.some((entry) => entry.section === "activity:90")).toBe(true)

    // Verify sheet membership was created
    const memberships = await inMemoryDb.select().from(schema.pdtpSheetActivities).where(eq(schema.pdtpSheetActivities.activityId, created.id))
    expect(memberships.length).toBeGreaterThanOrEqual(1)
  })

  it("addPdtpActivity: displayOrder es MAX+1 por hoja, no número de actividad", async () => {
    const { addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    // La hoja cphs tiene 4 actividades oficiales (11, 12, 13, 14). El
    // MAX(displayOrder) actual es 4. Una actividad manual agregada
    // debe quedar con displayOrder = 5, no con displayOrder = 90.
    const a1 = await addPdtpActivity({
      programId: program.id,
      activity: "A1",
      program: "X",
      responsibleSlugs: ["cphs"],
      responsibleDisplay: "CPHS",
      sheetCodes: ["cphs"],
    }, "user-1")
    const memberships1 = await inMemoryDb.select().from(schema.pdtpSheetActivities)
      .where(eq(schema.pdtpSheetActivities.activityId, a1.id))
    expect(memberships1[0]!.displayOrder).toBe(5)
    expect(memberships1[0]!.sheetRow).toBe(5)

    const a2 = await addPdtpActivity({
      programId: program.id,
      activity: "A2",
      program: "X",
      responsibleSlugs: ["cphs"],
      responsibleDisplay: "CPHS",
      sheetCodes: ["cphs"],
    }, "user-1")
    const memberships2 = await inMemoryDb.select().from(schema.pdtpSheetActivities)
      .where(eq(schema.pdtpSheetActivities.activityId, a2.id))
    expect(memberships2[0]!.displayOrder).toBe(6)
  })

  it("rejectPdtpExecution: submitted→rejected, motivo persistido, re-envío la vuelve a submitted", async () => {
    const { markPdtpExecution, rejectPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))
    const exec = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 3,
      week: 1,
      executedQuantity: 1,
      evidenceText: "Cantidad mal ingresada",
    }, "user-1", ["ws-1"])

    expect(exec.status).toBe("submitted")

    // No se puede rechazar fuera de scope (antes de rechazar)
    await expect(rejectPdtpExecution(exec.id, "user-1", "X", ["ws-other"])).rejects.toThrow(/sin acceso/i)

    // Rechazar con motivo
    const rejected = await rejectPdtpExecution(exec.id, "user-1", "Cantidad debe ser 3, no 1", ["ws-1"])
    expect(rejected.status).toBe("rejected")
    expect(rejected.rejectionReason).toBe("Cantidad debe ser 3, no 1")
    expect(rejected.rejectedByUserId).toBe("user-1")
    expect(rejected.rejectedAt).toBeTruthy()

    // No se puede rechazar dos veces
    await expect(rejectPdtpExecution(exec.id, "user-1", "Otro motivo", ["ws-1"])).rejects.toThrow(/ya fue rechazada/i)

    // Re-envío por el prevencionista con cantidad corregida → vuelve a submitted y limpia el rechazo
    const resubmitted = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 3,
      week: 1,
      executedQuantity: 3,
      evidenceText: "Corregido",
    }, "user-1", ["ws-1"])
    expect(resubmitted.status).toBe("submitted")
    expect(resubmitted.rejectionReason).toBeNull()
    expect(resubmitted.rejectedAt).toBeNull()
    expect(resubmitted.executedQuantity).toBe(3)

    // Ahora se puede aprobar normalmente
    const approved = await approvePdtpExecution(resubmitted.id, "user-1", ["ws-1"])
    expect(approved.status).toBe("approved")
    expect(approved.approvedByUserId).toBe("user-1")
  })

  it("markPdtpExecution: rechaza modificar una ejecución ya aprobada", async () => {
    const { markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 2))
    const exec = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 4,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(exec.id, "user-1", ["ws-1"])

    // Re-envío debe fallar
    await expect(markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 4,
      week: 1,
      executedQuantity: 5,
    }, "user-1", ["ws-1"])).rejects.toThrow(/ya fue aprobada/i)
  })

  it("rejectPdtpExecution: rechaza si el motivo está vacío", async () => {
    const { markPdtpExecution, rejectPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 3))
    const exec = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 5,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])

    await expect(rejectPdtpExecution(exec.id, "user-1", "", ["ws-1"])).rejects.toThrow(/motivo del rechazo/i)
    await expect(rejectPdtpExecution(exec.id, "user-1", "   ", ["ws-1"])).rejects.toThrow(/motivo del rechazo/i)
  })

  it("getPdtpSheetView prefiere el programa activo sobre el más reciente por versión", async () => {
    const { loadPdtpCatalog, getPdtpSheetView, approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    // v1 → activar
    const { program: v1 } = await loadPdtpCatalog({ year: 2026, version: 1, title: "v1", catalog, userId: "user-1" })
    await submitForReview(v1.id)
    await approvePdtpProgramJdpr(v1.id, "user-jdpr")
    await signPdtpProgramLegal(v1.id, "user-legal")
    await activatePdtpProgram(v1.id, "user-jdpr")

    // v2 creado como draft (sin activar)
    await loadPdtpCatalog({ year: 2026, version: 2, title: "v2", catalog, userId: "user-1" })

    const view = await getPdtpSheetView(2026, "pdtp_general")
    expect(view?.program.id).toBe(v1.id)
    expect(view?.program.status).toBe("active")
  })

  it("setPdtpActivityOverride: respeta el scope de faenas del usuario", async () => {
    const { setPdtpActivityOverride, deletePdtpActivityOverride } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    await inMemoryDb.insert(schema.worksites).values({ id: "ws-2", name: "Faena B", code: "FB", isActive: true })

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 5))

    // Scope ["ws-1"] no puede fijar override para ws-2
    await expect(setPdtpActivityOverride({
      activityId: activity!.id, worksiteId: "ws-2", year: 2026, month: 1, week: 1, plannedQuantity: 4,
      reason: "Ajuste por dotación efectiva de la faena",
    }, "user-1", ["ws-1"])).rejects.toThrow(/sin acceso/i)

    // Scope "all" sí puede
    const created = await setPdtpActivityOverride({
      activityId: activity!.id, worksiteId: "ws-2", year: 2026, month: 1, week: 1, plannedQuantity: 4,
      reason: "Ajuste por dotación efectiva de la faena",
    }, "user-1", "all")
    expect(created.plannedQuantity).toBe(4)

    // delete con scope [] no puede borrar
    await expect(deletePdtpActivityOverride({
      activityId: activity!.id, worksiteId: "ws-2", year: 2026, month: 1, week: 1,
      reason: "Retorno a la meta corporativa vigente",
    }, "user-1", [])).rejects.toThrow(/sin acceso/i)

    // delete con scope que contiene ws-2 sí
    await deletePdtpActivityOverride({
      activityId: activity!.id, worksiteId: "ws-2", year: 2026, month: 1, week: 1,
      reason: "Retorno a la meta corporativa vigente",
    }, "user-1", ["ws-2"])
    const remaining = await inMemoryDb.select().from(schema.pdtpActivityScheduleOverrides)
      .where(eq(schema.pdtpActivityScheduleOverrides.worksiteId, "ws-2"))
    expect(remaining).toHaveLength(0)
    const overrideAudit = await inMemoryDb.select().from(schema.pdtpChangeLog)
      .where(eq(schema.pdtpChangeLog.section, `override:${activity!.n}`))
    expect(overrideAudit).toHaveLength(2)
    expect(overrideAudit[0]?.after).toMatchObject({ plannedQuantity: 4, reason: "Ajuste por dotación efectiva de la faena" })
    expect(overrideAudit[1]?.before).toMatchObject({ plannedQuantity: 4 })
    expect(overrideAudit[1]?.after).toMatchObject({ reason: "Retorno a la meta corporativa vigente" })
  })

  it("addPdtpActivity: acepta múltiples responsibleSlugs y sheetCodes (H-M2)", async () => {
    const { addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    const created = await addPdtpActivity({
      programId: program.id,
      activity: "Actividad con múltiples responsables y hojas",
      program: "X",
      responsibleSlugs: ["prf", "jt", "jdpr"],
      responsibleDisplay: "PRF, JT, JDPR",
      sheetCodes: ["pdtp_general", "cphs", "capacitacion"],
    }, "user-1")

    expect(created.responsibleSlugs).toEqual(["prf", "jt", "jdpr"])

    const memberships = await inMemoryDb.select().from(schema.pdtpSheetActivities)
      .where(eq(schema.pdtpSheetActivities.activityId, created.id))
    expect(memberships).toHaveLength(3)
    const sheetCodes = memberships.map((m) => m.sheetCode).sort()
    expect(sheetCodes).toEqual(["capacitacion", "cphs", "pdtp_general"])
  })

  it("markPdtpExecution: preserva evidencePhotos históricas en re-envíos (H-M3 append-only)", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 38))

    // H-B7: pre-creamos archivos físicos para que la validación de
    // existencia (H-B7) los acepte
    for (const name of ["foto-001.pdf", "foto-002.pdf", "foto-003.pdf"]) {
      writeFileSync(join(tmpEvidenceDir, name), "%PDF-1.4 test")
    }

    // 1ra ejecución con foto 1
    const first = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 1,
      executedQuantity: 1, evidenceText: "Foto 1",
      evidenceUrl: "storage/pdtp-evidence/foto-001.pdf",
      evidencePhotos: ["storage/pdtp-evidence/foto-001.pdf"],
    }, "user-1", ["ws-1"])
    expect(first.evidencePhotos).toEqual(["storage/pdtp-evidence/foto-001.pdf"])

    // 2da ejecución (mismo período) con foto 2 → debe preservar foto 1
    const second = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 1,
      executedQuantity: 1, evidenceText: "Foto 2",
      evidenceUrl: "storage/pdtp-evidence/foto-002.pdf",
      evidencePhotos: ["storage/pdtp-evidence/foto-002.pdf"],
    }, "user-1", ["ws-1"])
    expect(second.evidencePhotos).toEqual([
      "storage/pdtp-evidence/foto-001.pdf",
      "storage/pdtp-evidence/foto-002.pdf",
    ])
    expect(second.evidenceUrl).toBe("storage/pdtp-evidence/foto-002.pdf")

    // 3ra ejecución con la misma foto 1 + foto 3 → no duplica foto 1
    const third = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 1,
      executedQuantity: 1, evidenceText: "Foto 3",
      evidenceUrl: "storage/pdtp-evidence/foto-003.pdf",
      evidencePhotos: [
        "storage/pdtp-evidence/foto-001.pdf",
        "storage/pdtp-evidence/foto-003.pdf",
      ],
    }, "user-1", ["ws-1"])
    expect(third.evidencePhotos).toEqual([
      "storage/pdtp-evidence/foto-001.pdf",
      "storage/pdtp-evidence/foto-002.pdf",
      "storage/pdtp-evidence/foto-003.pdf",
    ])
    // evidenceUrl: el último enviado (foto-003)
    expect(third.evidenceUrl).toBe("storage/pdtp-evidence/foto-003.pdf")
  })

  it("markPdtpExecution: si no se envía evidenceUrl, preserva el previo (H-M3)", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 39))

    // H-B7: pre-creamos el archivo físico
    writeFileSync(join(tmpEvidenceDir, "preservada.pdf"), "%PDF-1.4 test")

    // 1ra con evidencia
    await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 2,
      executedQuantity: 1,
      evidenceUrl: "storage/pdtp-evidence/preservada.pdf",
    }, "user-1", ["ws-1"])

    // 2da sin evidenciaUrl → debe preservar el previo
    const second = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 2,
      executedQuantity: 1,
      evidenceText: "Solo texto",
    }, "user-1", ["ws-1"])
    expect(second.evidenceUrl).toBe("storage/pdtp-evidence/preservada.pdf")
  })

  it("H-B7: descarta evidenceUrl cuyo archivo físico no existe", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 40))

    // No escribimos el archivo en disco → resolvePdtpEvidenceFile
    // retorna un path que existsSync rechaza.
    const row = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 3,
      executedQuantity: 1,
      evidenceUrl: "storage/pdtp-evidence/inexistente.pdf",
    }, "user-1", ["ws-1"])

    // Se guarda la ejecución pero sin evidenceUrl (se loggea warning)
    expect(row.evidenceUrl).toBeNull()
  })

  it("creates and copies a non-2026 program without inheriting the workbook as product structure", async () => {
    const {
      addPdtpActivity,
      createLegacyPdtpProgramForTests,
      ensureDefaultChecklist,
    } = await import("@/lib/services/prevention-pdtp")

    const source = await createLegacyPdtpProgramForTests({
      year: 2027,
      title: "Programa de controles críticos 2027",
      userId: "user-1",
    })
    const sourceSheets = await inMemoryDb.select().from(schema.pdtpSheets)
      .where(eq(schema.pdtpSheets.programId, source.id))
    expect(source.creationMode).toBe("blank")
    expect(sourceSheets.map((sheet) => sheet.code)).toEqual(["pdtp_general"])

    const longDescription = `Verificar controles críticos antes del inicio. ${"Detalle operacional verificable. ".repeat(12)}`
    const activity = await addPdtpActivity({
      programId: source.id,
      activity: longDescription,
      program: "Controles críticos",
      responsibleSlugs: ["prevencionista"],
      responsibleDisplay: "Equipo de Prevención",
      audienceRoles: ["jefe_terreno"],
      scheduleMode: "scheduled",
      recurrenceRule: { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 2 },
      evidenceRequirement: "Registro firmado con hallazgos y acciones",
      indicatorMode: "planned_vs_completed",
      targetValue: 100,
      targetUnit: "%",
      sheetCodes: ["pdtp_general"],
    }, "user-1")
    await ensureDefaultChecklist(activity.id, "Verificación de controles")

    const projected = await inMemoryDb.select().from(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.activityId, activity.id))
    expect(projected).toHaveLength(12)
    expect(activity.activity).toBe(longDescription)

    const copied = await createLegacyPdtpProgramForTests({
      year: 2028,
      title: "Programa de controles críticos 2028",
      userId: "user-1",
      copySheetsFromProgramId: source.id,
    })
    const [copiedActivity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, copied.id))
    const copiedSchedule = await inMemoryDb.select().from(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.activityId, copiedActivity!.id))
    const copiedChecklists = await inMemoryDb.select().from(schema.pdtpActivityChecklists)
      .where(eq(schema.pdtpActivityChecklists.programId, copied.id))
    const copiedExecutions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, copiedActivity!.id))

    expect(copied.creationMode).toBe("program_copy")
    expect(copied.sourceProgramId).toBe(source.id)
    expect(copied.sourceContentVersion).toBe(source.contentVersion)
    expect(copiedActivity).toMatchObject({
      scheduleMode: "scheduled",
      evidenceRequirement: "Registro firmado con hallazgos y acciones",
      audienceRoles: ["jefe_terreno"],
    })
    expect(copiedSchedule).toHaveLength(12)
    expect(new Set(copiedSchedule.map((cell) => cell.year))).toEqual(new Set([2028]))
    expect(copiedChecklists).toHaveLength(1)
    expect(copiedExecutions).toHaveLength(0)
  })

  it("publishes immutable template versions and materializes each program from the selected snapshot", async () => {
    const {
      addPdtpActivity,
      createLegacyPdtpProgramForTests,
      createPdtpTemplateVersion,
      ensureDefaultChecklist,
      listActivePdtpTemplates,
      updatePdtpActivity,
    } = await import("@/lib/services/prevention-pdtp")

    const source = await createLegacyPdtpProgramForTests({
      year: 2027,
      title: "Programa base de controles críticos",
      userId: "user-1",
    })
    const sourceActivity = await addPdtpActivity({
      programId: source.id,
      activity: "Verificar controles críticos antes de iniciar el turno",
      program: "Controles críticos",
      responsibleSlugs: ["prevencionista"],
      responsibleDisplay: "Equipo de Prevención",
      audienceRoles: ["jefe_terreno"],
      scheduleMode: "scheduled",
      recurrenceRule: { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
      evidenceRequirement: "Lista de verificación firmada",
      indicatorMode: "planned_vs_completed",
      sheetCodes: ["pdtp_general"],
    }, "user-1")
    await ensureDefaultChecklist(sourceActivity.id, "Checklist de controles")

    const publishedV1 = await createPdtpTemplateVersion({
      sourceProgramId: source.id,
      name: "Base controles críticos",
      description: "Base reutilizable para operaciones con controles críticos",
      userId: "user-1",
    })

    await updatePdtpActivity({
      activityId: sourceActivity.id,
      activity: "Verificar controles críticos antes de cada turno y registrar desviaciones",
      evidenceRequirement: "Lista firmada y registro de desviaciones",
    }, "user-1")
    const publishedV2 = await createPdtpTemplateVersion({
      sourceProgramId: source.id,
      name: "Base controles críticos",
      description: "Base reutilizable actualizada",
      userId: "user-1",
    })

    const fromV1 = await createLegacyPdtpProgramForTests({
      year: 2028,
      title: "Programa 2028 desde plantilla v1",
      userId: "user-1",
      templateVersionId: publishedV1.version.id,
    })
    const fromV2 = await createLegacyPdtpProgramForTests({
      year: 2029,
      title: "Programa 2029 desde plantilla v2",
      userId: "user-1",
      templateVersionId: publishedV2.version.id,
    })

    const [v1Activity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, fromV1.id))
    const [v2Activity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, fromV2.id))
    const v1Schedule = await inMemoryDb.select().from(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.activityId, v1Activity!.id))
    const v2Schedule = await inMemoryDb.select().from(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.activityId, v2Activity!.id))
    const v1Checklists = await inMemoryDb.select().from(schema.pdtpActivityChecklists)
      .where(eq(schema.pdtpActivityChecklists.programId, fromV1.id))
    const latestTemplates = await listActivePdtpTemplates()

    expect(publishedV1.version.version).toBe(1)
    expect(publishedV2.version.version).toBe(2)
    expect(fromV1).toMatchObject({
      creationMode: "template",
      sourceProgramId: source.id,
      sourceTemplateVersionId: publishedV1.version.id,
    })
    expect(v1Activity?.activity).toBe("Verificar controles críticos antes de iniciar el turno")
    expect(v1Activity?.evidenceRequirement).toBe("Lista de verificación firmada")
    expect(v2Activity?.activity).toBe("Verificar controles críticos antes de cada turno y registrar desviaciones")
    expect(v2Activity?.evidenceRequirement).toBe("Lista firmada y registro de desviaciones")
    expect(v1Schedule).toHaveLength(12)
    expect(v2Schedule).toHaveLength(12)
    expect(new Set(v1Schedule.map((cell) => cell.year))).toEqual(new Set([2028]))
    expect(new Set(v2Schedule.map((cell) => cell.year))).toEqual(new Set([2029]))
    expect(v1Checklists).toHaveLength(1)
    expect(latestTemplates).toHaveLength(1)
    expect(latestTemplates[0]?.currentVersion.id).toBe(publishedV2.version.id)
  })

  it("round-trips the five long 2026 activities without swapping or truncating their meaning", async () => {
    const { buildPdtpExport, readPdtpActivityContent, updatePdtpActivity } = await import("@/lib/services/prevention-pdtp")
    const { PDTP_2026_LONG_TEXT_ACTIVITY_IDS } = await import("@/lib/services/pdtp-adapters/contract-2026")
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)
    const { program } = await loadCatalog()
    const longTextIds = new Set<number>(PDTP_2026_LONG_TEXT_ACTIVITY_IDS)
    const expected = new Map(catalog.activities
      .filter((activity) => longTextIds.has(activity.n))
      .map((activity) => [activity.n, { activityDescription: activity.activity, executionGuidance: activity.program }]))
    expect(expected.size).toBe(PDTP_2026_LONG_TEXT_ACTIVITY_IDS.length)
    expect([...expected.values()].some((content) => content.activityDescription.length > 200 || content.executionGuidance.length > 200)).toBe(true)

    const persisted = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, program.id))
    for (const number of PDTP_2026_LONG_TEXT_ACTIVITY_IDS) {
      const row = persisted.find((activity) => activity.n === number)!
      const content = readPdtpActivityContent(row)
      expect(content).toEqual(expected.get(number))
      await updatePdtpActivity({
        activityId: row.id,
        activity: content.activityDescription,
        program: content.executionGuidance,
      }, "user-1")
    }

    const report = await buildPdtpExport({
      programId: program.id,
      year: program.year,
      sheetCode: "pdtp_general",
      worksiteId: "ws-1",
      scope: ["ws-1"],
    })
    expect(report.headers.slice(0, 4)).toEqual(["N°", "Actividad preventiva", "Guía de ejecución", "Responsables"])
    for (const number of PDTP_2026_LONG_TEXT_ACTIVITY_IDS) {
      const row = report.rows.find((candidate) => candidate[0] === number)!
      expect({ activityDescription: row[1], executionGuidance: row[2] }).toEqual(expected.get(number))
    }
  })

  it("mantiene los limites programa/plan/ejecucion: acreditar una ejecucion no muta el plan ni el contenido firmado", async () => {
    const { markPdtpExecution, approvePdtpExecution, getActivePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const program = await loadActiveCatalog()

    const before = await getActivePdtpProgram(2026)
    const activities = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(and(eq(schema.pdtpActivities.programId, program.id), eq(schema.pdtpActivities.scheduleMode, "scheduled")))
    const target = activities[0]!
    const scheduleBefore = await inMemoryDb.select().from(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.activityId, target.id))

    const execution = await markPdtpExecution({
      activityId: target.id, worksiteId: "ws-1", year: program.year, month: 1, week: 1, executedQuantity: 1,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(execution.id, "user-1", ["ws-1"])

    // La ejecucion vive en su propia tabla: no reescribe la planificacion...
    const scheduleAfter = await inMemoryDb.select().from(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.activityId, target.id))
    expect(scheduleAfter).toEqual(scheduleBefore)
    // ...ni la definicion de la actividad...
    const activityAfter = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, target.id))
    expect(activityAfter[0]).toEqual(target)
    // ...ni la version/digest firmados del programa (GOV-02: la firma cubre contenido, no avance).
    const after = await getActivePdtpProgram(2026)
    expect(after?.contentDigest).toBe(before?.contentDigest)
    expect(after?.version).toBe(before?.version)
  })

  it("audiences (sheet memberships) reuse the same 87 activities instead of duplicating rows per view", async () => {
    const { program } = await loadCatalog()

    const activities = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, program.id))
    expect(activities).toHaveLength(87)

    // pdtpSheetActivities no tiene programId propio: las membresías se leen
    // por los activityId de este programa, contra las ocho vistas globales
    // de la referencia 2026 (loadPdtpCatalog las crea sin programId, como
    // plantillas compartidas — resolveSheetForProgram las usa como fallback).
    const memberships = await inMemoryDb.select().from(schema.pdtpSheetActivities)
      .where(inArray(schema.pdtpSheetActivities.activityId, activities.map((a) => a.id)))

    // 8 vistas 2026 con membresías solapadas (una actividad puede pertenecer
    // a varias audiencias) suman más filas de membresía que actividades...
    expect(memberships.length).toBeGreaterThan(activities.length)
    // ...pero ninguna vista crea una copia de la actividad: el conjunto de
    // activityId referenciados por las membresías nunca excede las 87 filas
    // reales, y cada fila de pdtpActivities sigue siendo única por n.
    const referencedActivityIds = new Set(memberships.map((m) => m.activityId))
    expect(referencedActivityIds.size).toBeLessThanOrEqual(activities.length)
    expect(new Set(activities.map((a) => a.n)).size).toBe(activities.length)
  })

  it("keeps the 22 no-P activities visible without contaminating the calendarized denominator", async () => {
    const { listPdtpProgramActivities, getPdtpComplianceIndicators } = await import("@/lib/services/prevention-pdtp")
    // Base definitiva: 87 actividades, incluidas las que no tienen P numérica.
    const { PDTP_2026_SOURCE_INVARIANTS, PDTP_2026_NO_NUMERIC_PLAN_ACTIVITY_IDS } = await import("@/lib/services/pdtp-adapters/contract-2026")
    const { program } = await loadCatalog()

    const activities = await listPdtpProgramActivities(program.id)
    expect(activities).toHaveLength(PDTP_2026_SOURCE_INVARIANTS.activityCount)
    // Las 22 siguen visibles en el listado del constructor...
    for (const number of PDTP_2026_NO_NUMERIC_PLAN_ACTIVITY_IDS) {
      expect(activities.some((a) => a.n === number)).toBe(true)
    }

    // ...pero no aportan ninguna celda al denominador calendarizado: el total
    // planificado anual coincide exactamente con las 821 celdas/1.013
    // unidades de las 65 actividades que sí tienen P, sin inflar ni recortar
    // por la presencia de las 22 sin plan numérico.
    const indicators = await getPdtpComplianceIndicators(program.id, "ws-1")
    expect(indicators?.annual.planned).toBe(PDTP_2026_SOURCE_INVARIANTS.plannedQuantityTotal)
  })

  it("getPdtpManagementReport reports avance/desviaciones by actividad and fails closed outside scope", async () => {
    const { getPdtpManagementReport, markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    // Base definitiva normalizada.
    const { PDTP_2026_SOURCE_INVARIANTS } = await import("@/lib/services/pdtp-adapters/contract-2026")
    const program = await loadActiveCatalog()

    // Falla cerrado: una faena fuera del alcance del llamador nunca genera el reporte.
    await expect(getPdtpManagementReport({ programId: program.id, worksiteId: "ws-1", scope: ["ws-2"] }))
      .rejects.toThrow(/sin acceso/i)

    const report = await getPdtpManagementReport({ programId: program.id, worksiteId: "ws-1", scope: ["ws-1"] })
    expect(report).not.toBeNull()
    expect(report!.indicatorDefinitions.length).toBeGreaterThan(0)

    const scheduledCount = report!.activities.length
    expect(scheduledCount).toBe(PDTP_2026_SOURCE_INVARIANTS.activityCount - PDTP_2026_SOURCE_INVARIANTS.noNumericPlanCount)
    expect(report!.activities.every((activity) => activity.executed === 0)).toBe(true)
    expect(report!.activities.every((activity) => activity.responsibles.length > 0)).toBe(true)

    const activities = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(and(eq(schema.pdtpActivities.programId, program.id), eq(schema.pdtpActivities.scheduleMode, "scheduled")))
    // Una actividad anual (planned = 1) cumple su meta con una sola ejecución
    // aprobada (percent = 1.0 >= complianceTarget) — no sirve para probar el
    // filtro "deviates" más abajo. H-17 (AUDITORIA_BUGS_2026-08-05.md): elegir
    // explícitamente, con orden determinista, una actividad con más de una
    // unidad planificada en el año, en vez de `activities[0]` sin `ORDER BY`.
    const candidateRow = report!.activities.find((row) => row.planned > 1)!
    const target = activities.find((activity) => activity.n === candidateRow.activityNumber)!
    const execution = await markPdtpExecution({
      activityId: target.id, worksiteId: "ws-1", year: program.year, month: 1, week: 1, executedQuantity: 1,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(execution.id, "user-1", ["ws-1"])

    const updated = await getPdtpManagementReport({ programId: program.id, worksiteId: "ws-1", scope: ["ws-1"] })
    const updatedTarget = updated!.activities.find((row) => row.activityNumber === target.n)!
    expect(updatedTarget.executed).toBeGreaterThan(0)
    // El motivo por el que sigue en desviación tiene que quedar explícito: una
    // sola unidad ejecutada, contra un plan mayor a uno, no alcanza la meta.
    expect(updatedTarget.percent).toBeLessThan(program.complianceTarget)
    expect(updated!.activities.filter((row) => row.activityNumber !== target.n).every((row) => row.executed === 0)).toBe(true)

    const deviating = await getPdtpManagementReport({
      programId: program.id, worksiteId: "ws-1", scope: ["ws-1"], filters: { status: "deviates" },
    })
    expect(deviating!.activities.every((row) => !row.meetsTarget)).toBe(true)
    expect(deviating!.activities.some((row) => row.activityNumber === target.n)).toBe(true)
  })

  it("getPdtpAuditDossier assembles executions, sources, obligations, actions, approvals and changes scoped to one faena, and fails closed outside scope", async () => {
    const {
      getPdtpAuditDossier, markPdtpExecution, approvePdtpExecution,
      createActionPlanItem, addFollowup,
    } = await import("@/lib/services/prevention-pdtp")
    const program = await loadActiveCatalog()

    await expect(getPdtpAuditDossier({ programId: program.id, worksiteId: "ws-1", scope: ["ws-2"] }))
      .rejects.toThrow(/sin acceso/i)

    const activities = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(and(eq(schema.pdtpActivities.programId, program.id), eq(schema.pdtpActivities.scheduleMode, "scheduled")))
    const target = activities[0]!
    const execution = await markPdtpExecution({
      activityId: target.id, worksiteId: "ws-1", year: program.year, month: 1, week: 1, executedQuantity: 1,
      evidenceText: "Registro fotográfico revisado en terreno",
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(execution.id, "user-1", ["ws-1"])

    const action = await createActionPlanItem({
      executionId: execution.id, hallazgo: "Hallazgo de auditoría", accion: "Corregir",
      responsableRole: "prevencionista_faena", responsable: "Juan Pérez", plazo: "2099-01-01", prioridad: "media",
    } as never, "user-1")
    await addFollowup({ actionPlanItemId: action.id, estadoNuevo: "en_proceso", observacion: "Seguimiento inicial" }, "user-1")

    await inMemoryDb.insert(schema.preventionPdtpSourceLinks).values({
      id: "source-link-1", activityId: target.id, worksiteId: "ws-1", sourceType: "risk_control", sourceId: "control-1",
      sourceVersionSnapshot: "v1", justification: "Vínculo MIPER validado", createdByUserId: "user-1", createdAt: new Date().toISOString(),
    })
    await inMemoryDb.insert(schema.pdtpImportBatches).values({
      id: "batch-dossier-1", programId: program.id, status: "applied", adapterCode: "pdtp_2026_xlsx_v1",
      sourceFileName: "referencia.xlsx", sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceSizeBytes: 1, sourceChecksumSha256: "a".repeat(64), previewJson: {}, metadataJson: {}, warningsJson: [],
      targetWorksiteId: "ws-1", requestedByUserId: "user-1", appliedByUserId: "user-1",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), appliedAt: new Date().toISOString(),
    })

    const dossier = await getPdtpAuditDossier({ programId: program.id, worksiteId: "ws-1", scope: ["ws-1"] })
    expect(dossier).not.toBeNull()
    expect(dossier!.contentDigest).not.toBeNull()

    // Ejecuciones: incluye la aprobada, sin exponer la URL/texto de evidencia cruda.
    const executionRow = dossier!.executions.find((e) => e.executionId === execution.id)!
    expect(executionRow.status).toBe("approved")
    expect(executionRow.hasEvidence).toBe(true)
    expect(executionRow).not.toHaveProperty("evidenceUrl")
    expect(executionRow).not.toHaveProperty("evidenceText")

    // Fuentes, acciones, seguimientos y lotes de importación quedan acotados a la faena solicitada.
    expect(dossier!.sourceLinks.some((s) => s.id === "source-link-1")).toBe(true)
    const actionRow = dossier!.actions.find((a) => a.id === action.id)!
    expect(actionRow.worksiteId).toBe("ws-1")
    expect(dossier!.followupsByActionId[action.id]).toHaveLength(1)
    expect(dossier!.importBatches.some((b) => b.id === "batch-dossier-1")).toBe(true)

    // Aprobaciones y cambios del programa completo (no dependen de una faena).
    expect(dossier!.approvalSteps.length).toBeGreaterThan(0)
    expect(dossier!.approvalSteps.every((step) => step.decision?.decision === "approved")).toBe(true)
    expect(dossier!.changes.length).toBeGreaterThan(0)

    // Otra faena sin datos ve las mismas aprobaciones/cambios (a nivel de programa) pero listas vacías en lo acotado por faena.
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-2", name: "Faena B", code: "FB", isActive: true })
    const otherFaena = await getPdtpAuditDossier({ programId: program.id, worksiteId: "ws-2", scope: ["ws-2"] })
    expect(otherFaena!.executions).toHaveLength(0)
    expect(otherFaena!.sourceLinks).toHaveLength(0)
    expect(otherFaena!.importBatches).toHaveLength(0)
    expect(otherFaena!.changes.length).toBe(dossier!.changes.length)
  })

  it("stages without mutations, blocks activities outside General, applies P authoritatively and rolls back", async () => {
    const { readFile } = await import("node:fs/promises")
    const {
      addPdtpActivity,
      applyPdtpImportBatch,
      cancelPdtpImportBatch,
      createLegacyPdtpProgramForTests,
      ensureDefaultChecklist,
      getPdtpComplianceIndicators,
      rollbackPdtpImportBatch,
      stagePdtpXlsxImport,
    } = await import("@/lib/services/prevention-pdtp")
    const program = await createLegacyPdtpProgramForTests({ year: 2026, title: "Programa destino de migración", userId: "user-1" })
    const priorActivity = await addPdtpActivity({
      programId: program.id,
      activity: "Actividad previa que debe poder restaurarse",
      program: "Guía previa",
      responsibleSlugs: ["prf"],
      responsibleDisplay: "PRF",
      scheduleMode: "scheduled",
      recurrenceRule: { frequency: "annual", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
      sheetCodes: ["pdtp_general"],
    }, "user-1")
    await ensureDefaultChecklist(priorActivity.id, "Checklist previo")
    await inMemoryDb.insert(schema.preventionPdtpSourceLinks).values({
      id: "source-link-before-import",
      activityId: priorActivity.id,
      worksiteId: "ws-1",
      sourceType: "audit",
      sourceId: "audit-before-import",
      sourceVersionSnapshot: "v1",
      justification: "Vínculo previo que debe conservarse",
      createdByUserId: "user-1",
    })
    const bytes = await readFile(path.resolve(process.cwd(), "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx"))

    const staged = await stagePdtpXlsxImport({
      programId: program.id,
      bytes,
      fileName: "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      userId: "user-1",
    })
    const afterStageActivities = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, program.id))
    expect(afterStageActivities).toHaveLength(1)
    expect(afterStageActivities[0]?.activity).toBe("Actividad previa que debe poder restaurarse")
    expect(staged.preview.counts).toMatchObject({ activities: 87, plannedCells: 821, plannedQuantity: 1013, executedCells: 0, executedQuantity: 0 })
    expect(staged.preview.counts).toMatchObject({
      scheduleRowsReplaced: 0,
      checklistBindingsPreserved: 0,
      sourceLinksPreserved: 0,
      checklistBindingsLost: 0,
      sourceLinksLost: 0,
    })
    expect(staged.preview.calendarChanges.some((change) => change.activityNumber === priorActivity.n)).toBe(false)
    expect(staged.preview.blockingErrors).toEqual([
      expect.stringContaining("General es autoritativa"),
    ])

    await expect(applyPdtpImportBatch({
      batchId: staged.batch.id,
      userId: "user-1",
      worksiteId: "ws-ajena",
      acceptMissingEvidence: true,
      acceptanceReason: "Intento controlado con una faena ajena",
      scope: ["ws-1"],
    })).rejects.toThrow(/no tienes esa faena autorizada/i)
    expect(await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, program.id))).toHaveLength(1)

    await expect(applyPdtpImportBatch({
      batchId: staged.batch.id,
      userId: "user-1",
      worksiteId: "ws-1",
      acceptMissingEvidence: true,
      acceptanceReason: "Histórico validado por Jefatura de Prevención",
      scope: ["ws-1"],
    })).rejects.toThrow(/General es autoritativa/)
    await cancelPdtpImportBatch({
      batchId: staged.batch.id,
      userId: "user-1",
      reason: "Se revisará y retirará la actividad ajena antes de reimportar.",
    })
    await inMemoryDb.delete(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, priorActivity.id))

    const cleanStaged = await stagePdtpXlsxImport({
      programId: program.id,
      bytes,
      fileName: "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      userId: "user-1",
    })
    expect(cleanStaged.preview.blockingErrors).toEqual([])
    const applied = await applyPdtpImportBatch({
      batchId: cleanStaged.batch.id,
      userId: "user-1",
      worksiteId: "ws-1",
      acceptMissingEvidence: true,
      acceptanceReason: "Base autoritativa validada por Jefatura de Prevención",
      scope: ["ws-1"],
    })
    expect(applied).toMatchObject({ activityCount: 87, sheetCount: 8, plannedCellCount: 821, importedExecutionCount: 0, preservedExtraActivities: 0 })
    const [importedActivities, importedExecutions, appliedProgram, documentHistory, roleLegend] = await Promise.all([
      inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, program.id)),
      inMemoryDb.select().from(schema.pdtpExecutions),
      inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id)),
      inMemoryDb.select().from(schema.pdtpDocumentHistory).where(eq(schema.pdtpDocumentHistory.programId, program.id)),
      inMemoryDb.select().from(schema.pdtpRoleLegendEntries).where(eq(schema.pdtpRoleLegendEntries.programId, program.id)),
    ])
    expect(importedActivities).toHaveLength(87)
    expect(importedActivities.filter((activity) => activity.scheduleClassificationStatus === "needs_review")).toHaveLength(22)
    expect(importedActivities.filter((activity) => activity.scheduleClassificationStatus === "confirmed")).toHaveLength(65)
    expect(importedExecutions).toHaveLength(0)
    expect(appliedProgram[0]).toMatchObject({ documentCode: "RE-36", indicatorPeriodicity: "Mensual", measurementOwner: "Cada faena" })
    expect(documentHistory.map((entry) => entry.entryKind).sort()).toEqual(["approval", "change_control", "elaboration"])
    expect(documentHistory.find((entry) => entry.entryKind === "approval")?.linkedUserId).toBeNull()
    expect(roleLegend).toHaveLength(5)
    expect((await getPdtpComplianceIndicators(program.id, "ws-1"))?.annual).toEqual({ planned: 1013, executed: 0, percent: 0 })

    const { submitPdtpProgramForReview } = await import("@/lib/services/prevention-pdtp")
    await expect(submitPdtpProgramForReview(program.id, "user-1")).rejects.toThrow(/22 actividad\(es\).*requieren confirmar/i)

    await applyPdtpImportBatch({
      batchId: cleanStaged.batch.id,
      userId: "user-1",
      worksiteId: "ws-1",
      acceptMissingEvidence: true,
      acceptanceReason: "Reintento idempotente del lote validado",
      scope: ["ws-1"],
    })
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)

    await rollbackPdtpImportBatch({
      batchId: cleanStaged.batch.id,
      userId: "user-1",
      reason: "Restaurar el estado anterior de la prueba",
      scope: ["ws-1"],
    })
    const [rolledBackActivities, rolledBackExecutions, rolledBackChecklist, rolledBackSourceLink, rolledBackHistory, rolledBackRoleLegend] = await Promise.all([
      inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, program.id)),
      inMemoryDb.select().from(schema.pdtpExecutions),
      inMemoryDb.select().from(schema.pdtpActivityChecklists).where(eq(schema.pdtpActivityChecklists.activityId, priorActivity.id)),
      inMemoryDb.select().from(schema.preventionPdtpSourceLinks).where(eq(schema.preventionPdtpSourceLinks.activityId, priorActivity.id)),
      inMemoryDb.select().from(schema.pdtpDocumentHistory).where(eq(schema.pdtpDocumentHistory.programId, program.id)),
      inMemoryDb.select().from(schema.pdtpRoleLegendEntries).where(eq(schema.pdtpRoleLegendEntries.programId, program.id)),
    ])
    expect(rolledBackActivities).toHaveLength(0)
    expect(rolledBackExecutions).toHaveLength(0)
    expect(rolledBackChecklist).toHaveLength(0)
    expect(rolledBackSourceLink).toHaveLength(0)
    expect(rolledBackHistory).toHaveLength(0)
    expect(rolledBackRoleLegend).toHaveLength(0)

    const cancellationProgram = await createLegacyPdtpProgramForTests({ year: 2027, title: "Prueba de cancelación persistente", userId: "user-1" })
    const cancelled = await stagePdtpXlsxImport({
      programId: cancellationProgram.id,
      bytes,
      fileName: "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      userId: "user-1",
    })
    await cancelPdtpImportBatch({
      batchId: cancelled.batch.id,
      userId: "user-1",
      reason: "Cancelar para verificar un nuevo análisis",
    })
    const [cancelledRow] = await inMemoryDb.select().from(schema.pdtpImportBatches)
      .where(eq(schema.pdtpImportBatches.id, cancelled.batch.id))
    expect(cancelledRow).toMatchObject({
      status: "cancelled",
      cancelledByUserId: "user-1",
      cancellationReason: "Cancelar para verificar un nuevo análisis",
    })
    const restaged = await stagePdtpXlsxImport({
      programId: cancellationProgram.id,
      bytes,
      fileName: "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      userId: "user-1",
    })
    expect(restaged.batch.id).not.toBe(cancelled.batch.id)
    expect(restaged.batch.status).toBe("staged")
  })

  it("preserves a historical execution while applying a planning-only base", async () => {
    const { readFile } = await import("node:fs/promises")
    const { applyPdtpImportBatch, createLegacyPdtpProgramForTests, stagePdtpXlsxImport } = await import("@/lib/services/prevention-pdtp")
    const program = await createLegacyPdtpProgramForTests({ year: 2026, title: "Prueba de atomicidad tardía", userId: "user-1" })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: `${program.id}-activity-6-existing`,
      programId: program.id,
      n: 6,
      activity: "Actividad seis anterior",
      program: "Programa anterior",
      responsibleSlugs: ["prf"],
      responsibleDisplay: "PRF",
      sourceSheetRow: 1,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "execution-conflict-before-import",
      activityId: `${program.id}-activity-6-existing`,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 4,
      executedQuantity: 1,
      status: "draft",
      idempotencyKey: "manual-conflict-before-import",
      createdAt: now,
      updatedAt: now,
    })
    const bytes = await readFile(path.resolve(process.cwd(), "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx"))
    const staged = await stagePdtpXlsxImport({
      programId: program.id,
      bytes,
      fileName: "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      userId: "user-1",
    })

    await expect(applyPdtpImportBatch({
      batchId: staged.batch.id,
      userId: "user-1",
      worksiteId: "ws-1",
      scope: ["ws-1"],
    })).resolves.toMatchObject({ importedExecutionCount: 0 })

    const [activitiesAfterFailure, executionsAfterFailure, scheduleAfterFailure, batchAfterFailure] = await Promise.all([
      inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, program.id)),
      inMemoryDb.select().from(schema.pdtpExecutions),
      inMemoryDb.select().from(schema.pdtpActivitySchedule),
      inMemoryDb.select().from(schema.pdtpImportBatches).where(eq(schema.pdtpImportBatches.id, staged.batch.id)),
    ])
    expect(activitiesAfterFailure).toHaveLength(87)
    expect(activitiesAfterFailure.find((activity) => activity.n === 6)?.activity).not.toBe("Actividad seis anterior")
    expect(executionsAfterFailure).toHaveLength(1)
    expect(scheduleAfterFailure).toHaveLength(821)
    expect(batchAfterFailure[0]?.status).toBe("applied")
  })

  it("preserves declared document identities and links them only through explicit reconciliation", async () => {
    const { createLegacyPdtpProgramForTests, getPdtpDocumentMetadata, reconcilePdtpDeclaredActor } = await import("@/lib/services/prevention-pdtp")
    const { computePdtpProgramContentDigest } = await import("@/lib/services/pdtp/content-digest")
    const program = await createLegacyPdtpProgramForTests({ year: 2032, title: "Programa con historia documental", userId: "user-1" })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpImportBatches).values({
      id: "batch-document-history",
      programId: program.id,
      status: "applied",
      adapterCode: "pdtp_2026_xlsx_v1",
      sourceFileName: "referencia.xlsx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceSizeBytes: 1,
      sourceChecksumSha256: "a".repeat(64),
      previewJson: {},
      metadataJson: {},
      warningsJson: [],
      requestedByUserId: "user-1",
      appliedByUserId: "user-1",
      createdAt: now,
      updatedAt: now,
      appliedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpDocumentHistory).values({
      id: "declared-approval",
      programId: program.id,
      entryKind: "approval",
      stableKey: "approval",
      declaredActorName: "Nombre conservado del documento",
      declaredActorTitle: "Cargo declarado",
      declaredAtText: "23-12-2025",
      sourceImportBatchId: "batch-document-history",
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpRoleLegendEntries).values({
      id: "declared-role-prf",
      programId: program.id,
      code: "PRF",
      label: "Prevencionista de Riesgos de Faena",
      sourceImportBatchId: "batch-document-history",
      createdAt: now,
    })

    const beforeDigest = await computePdtpProgramContentDigest(program.id)
    const before = await getPdtpDocumentMetadata(program.id)
    expect(before.history[0]).toMatchObject({
      linkedUserName: null,
      adapterCode: "pdtp_2026_xlsx_v1",
      entry: { declaredActorName: "Nombre conservado del documento", linkedUserId: null },
    })
    expect(before.roleLegend[0]).toMatchObject({ adapterCode: "pdtp_2026_xlsx_v1", entry: { code: "PRF" } })

    const reconciled = await reconcilePdtpDeclaredActor({
      historyEntryId: "declared-approval",
      linkedUserId: "user-legal",
      actorUserId: "user-1",
      reason: "Identidad contrastada con el registro corporativo",
    })
    const afterDigest = await computePdtpProgramContentDigest(program.id)
    expect(reconciled).toMatchObject({
      declaredActorName: "Nombre conservado del documento",
      linkedUserId: "user-legal",
      reconciledByUserId: "user-1",
      reconciliationReason: "Identidad contrastada con el registro corporativo",
    })
    expect(afterDigest.digest).not.toBe(beforeDigest.digest)
  })

  it("repeats the 2026 post-import bootstrap without duplicating checklists or template versions", async () => {
    const { readFile } = await import("node:fs/promises")
    const {
      applyPdtpImportBatch,
      createLegacyPdtpProgramForTests,
      createPdtpTemplateVersion,
      ensurePdtp2026ChecklistTemplates,
      finalizePdtpImportBootstrap,
      rollbackPdtpImportBatch,
      stagePdtpXlsxImport,
      publishPdtpBase2026Revision,
    } = await import("@/lib/services/prevention-pdtp")
    const program = await createLegacyPdtpProgramForTests({ year: 2026, title: "Bootstrap repetible 2026", userId: "user-1" })
    const bytes = await readFile(path.resolve(process.cwd(), "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx"))
    const staged = await stagePdtpXlsxImport({
      programId: program.id,
      bytes,
      fileName: "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      userId: "user-1",
    })
    await applyPdtpImportBatch({
      batchId: staged.batch.id,
      userId: "user-1",
      worksiteId: "ws-1",
      acceptMissingEvidence: true,
      acceptanceReason: "Ejecuciones históricas validadas para bootstrap",
      scope: ["ws-1"],
    })

    const firstChecklists = await ensurePdtp2026ChecklistTemplates({ programId: program.id })
    const secondChecklists = await ensurePdtp2026ChecklistTemplates({ programId: program.id })
    await expect(createPdtpTemplateVersion({
      sourceProgramId: program.id,
      name: "Referencia preventiva 2026",
      userId: "user-1",
      skipIfUnchanged: true,
    })).rejects.toThrow(/modalidad confirmada/i)
    await inMemoryDb.update(schema.pdtpActivities).set({ scheduleClassificationStatus: "confirmed" })
      .where(eq(schema.pdtpActivities.programId, program.id))
    const firstTemplate = await publishPdtpBase2026Revision({
      sourceProgramId: program.id,
      sourceChecksumSha256: staged.batch.sourceChecksumSha256,
      userId: "user-1",
    })
    await finalizePdtpImportBootstrap({
      batchId: staged.batch.id,
      userId: "user-1",
      checklistIdsCreated: firstChecklists.createdChecklistIds,
      templateIdCreated: firstTemplate.template.id,
      templateVersionIdCreated: firstTemplate.version.id,
    })
    const secondTemplate = await publishPdtpBase2026Revision({
      sourceProgramId: program.id,
      sourceChecksumSha256: staged.batch.sourceChecksumSha256,
      userId: "user-1",
    })
    const artifactsAfterRetry = await finalizePdtpImportBootstrap({
      batchId: staged.batch.id,
      userId: "user-1",
      checklistIdsCreated: secondChecklists.createdChecklistIds,
    })

    expect(firstChecklists).toMatchObject({ expected: 10, created: 10, skipped: 0, missing: [] })
    expect(secondChecklists).toMatchObject({ expected: 10, created: 0, skipped: 10, missing: [] })
    expect(secondTemplate).toMatchObject({ unchanged: true })
    expect(secondTemplate.version.id).toBe(firstTemplate.version.id)
    expect(artifactsAfterRetry).toMatchObject({
      checklistIdsCreated: expect.arrayContaining(firstChecklists.createdChecklistIds),
      templateIdCreated: firstTemplate.template.id,
      templateVersionIdCreated: firstTemplate.version.id,
    })
    expect(await inMemoryDb.select().from(schema.pdtpActivityChecklists)).toHaveLength(10)
    expect(await inMemoryDb.select().from(schema.pdtpProgramTemplateVersions)).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)

    await rollbackPdtpImportBatch({
      batchId: staged.batch.id,
      userId: "user-1",
      reason: "Revertir bootstrap completo durante la prueba",
      scope: ["ws-1"],
    })
    expect(await inMemoryDb.select().from(schema.pdtpActivities)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.pdtpActivityChecklists)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.pdtpProgramTemplateVersions)).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.pdtpProgramTemplates)).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
  })

  it("operates triggered obligations idempotently, separates sin casos and closes only after approval", async () => {
    const {
      addPdtpActivity,
      approvePdtpExecution,
      approvePdtpProgramJdpr,
      cancelPdtpObligation,
      createPdtpObligation,
      createLegacyPdtpProgramForTests,
      getPdtpDemandIndicator,
      listPdtpDemandActivities,
      listPdtpObligationReminderCandidates,
      listPdtpObligations,
      recordPdtpObligationReminder,
      refreshPdtpObligationStatuses,
      rejectPdtpExecution,
      reportPdtpObligation,
      signPdtpProgramLegal,
      submitPdtpProgramForReview,
      activatePdtpProgram,
    } = await import("@/lib/services/prevention-pdtp")
    const program = await createLegacyPdtpProgramForTests({ year: 2026, title: "Programa operacional por eventos", userId: "user-1" })
    const activity = await addPdtpActivity({
      programId: program.id,
      activity: "Investigar y cerrar una desviación crítica",
      program: "Abrir el caso, investigar y documentar el cierre",
      responsibleSlugs: ["prf"],
      responsibleDisplay: "PRF",
      scheduleMode: "triggered",
      scheduleClassificationStatus: "confirmed",
      triggerType: "incident_closed",
      triggerDescription: "Cuando se registra una desviación crítica",
      dueDays: 2,
      evidenceRequirement: "Informe de investigación y evidencia de cierre",
      indicatorMode: "closed_on_time",
      targetValue: 100,
      targetUnit: "%",
      sheetCodes: ["pdtp_general"],
    }, "user-1")
    await submitPdtpProgramForReview(program.id, "user-1")
    await approvePdtpProgramJdpr(program.id, "user-jdpr")
    await signPdtpProgramLegal(program.id, "user-legal")
    await activatePdtpProgram(program.id, "user-jdpr")

    expect(await getPdtpDemandIndicator({ programId: program.id, worksiteId: "ws-1", scope: ["ws-1"] }))
      .toMatchObject({ state: "no_cases", caseCount: 0, rate: null })
    expect((await listPdtpDemandActivities()).map((item) => item.id)).toContain(activity.id)

    const currentSourceAt = new Date(Date.now() - 60_000).toISOString()
    const firstInput = {
      activityId: activity.id,
      worksiteId: "ws-1",
      origin: "manual" as const,
      clientRequestId: "incident:case-1",
      sourceType: "incident",
      sourceId: "case-1",
      sourceOccurredAt: currentSourceAt,
      plannedQuantity: 1,
      manualReason: "Caso operacional validado por la persona responsable",
    }
    await expect(createPdtpObligation({
      activityId: activity.id,
      worksiteId: "ws-1",
      origin: "integration",
      sourceType: "incident",
      sourceId: "case-without-timestamp",
      userId: "user-1",
      scope: ["ws-1"],
    })).rejects.toThrow(/fecha y hora del evento/i)
    await expect(createPdtpObligation({ ...firstInput, userId: "user-1", scope: [] })).rejects.toThrow(/sin acceso/i)
    const first = await createPdtpObligation({ ...firstInput, userId: "user-1", scope: ["ws-1"] })
    const retried = await createPdtpObligation({ ...firstInput, userId: "user-1", scope: ["ws-1"] })
    expect(first.created).toBe(true)
    expect(retried).toMatchObject({ created: false, obligation: { id: first.obligation.id } })

    const oldSourceAt = new Date(Date.now() - 10 * 86_400_000).toISOString()
    const second = await createPdtpObligation({
      ...firstInput,
      clientRequestId: "incident:case-2",
      sourceId: "case-2",
      sourceOccurredAt: oldSourceAt,
      userId: "user-1",
      scope: ["ws-1"],
    })
    await refreshPdtpObligationStatuses()
    const queue = await listPdtpObligations({ scope: ["ws-1"], programId: program.id })
    expect(queue).toHaveLength(2)
    expect(queue.find((item) => item.obligation.id === second.obligation.id)?.obligation.status).toBe("overdue")

    const reminderCandidates = await listPdtpObligationReminderCandidates({ scope: ["ws-1"] })
    expect(reminderCandidates.find((item) => item.obligation.id === second.obligation.id)?.window).toBe("overdue")
    const reminder = await recordPdtpObligationReminder({
      obligationId: second.obligation.id,
      recipientUserId: "user-1",
      window: "overdue",
    })
    const reminderRetry = await recordPdtpObligationReminder({
      obligationId: second.obligation.id,
      recipientUserId: "user-1",
      window: "overdue",
    })
    expect(reminder.created).toBe(true)
    expect(reminderRetry.created).toBe(false)

    await expect(reportPdtpObligation({ obligationId: first.obligation.id, executedQuantity: 1, userId: "user-1", scope: ["ws-1"] }))
      .rejects.toThrow(/evidencia requerida/i)
    const firstReport = await reportPdtpObligation({
      obligationId: first.obligation.id,
      executedQuantity: 1,
      evidenceText: "Informe y fotografías revisadas en el expediente del incidente",
      userId: "user-1",
      scope: ["ws-1"],
    })
    const firstReportRetry = await reportPdtpObligation({
      obligationId: first.obligation.id,
      executedQuantity: 1,
      evidenceText: "Informe y fotografías revisadas en el expediente del incidente",
      userId: "user-1",
      scope: ["ws-1"],
    })
    const secondReport = await reportPdtpObligation({
      obligationId: second.obligation.id,
      executedQuantity: 1,
      evidenceText: "Informe tardío asociado al segundo expediente",
      userId: "user-1",
      scope: ["ws-1"],
    })
    expect(firstReport.obligation.status).toBe("reported")
    expect(firstReportRetry.created).toBe(false)
    expect(secondReport.obligation.status).toBe("reported")
    const obligationExecutions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, activity.id))
    expect(obligationExecutions).toHaveLength(2)
    expect(new Set(obligationExecutions.map((execution) => `${execution.year}-${execution.month}-${execution.week}`)).size).toBe(1)

    await rejectPdtpExecution(secondReport.execution.id, "user-jdpr", "La evidencia debe corregirse antes del cierre", ["ws-1"])
    await cancelPdtpObligation({
      obligationId: second.obligation.id,
      reason: "El caso fue fusionado formalmente con otro expediente",
      userId: "user-1",
      scope: ["ws-1"],
    })
    await approvePdtpExecution(firstReport.execution.id, "user-jdpr", ["ws-1"])

    expect(await getPdtpDemandIndicator({ programId: program.id, worksiteId: "ws-1", scope: ["ws-1"] })).toMatchObject({
      state: "with_cases",
      caseCount: 1,
      completed: 1,
      onTime: 1,
      rate: 1,
    })
    const [closed, cancelled] = await Promise.all([
      inMemoryDb.select().from(schema.pdtpObligations).where(eq(schema.pdtpObligations.id, first.obligation.id)),
      inMemoryDb.select().from(schema.pdtpObligations).where(eq(schema.pdtpObligations.id, second.obligation.id)),
    ])
    expect(closed[0]?.status).toBe("completed")
    expect(cancelled[0]).toMatchObject({ status: "cancelled", cancellationReason: "El caso fue fusionado formalmente con otro expediente" })
  })
})
