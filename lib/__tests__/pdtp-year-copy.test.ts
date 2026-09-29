/**
 * lib/__tests__/pdtp-year-copy.test.ts
 *
 * PREV-C03.1 (tanda T5): crear el programa del año siguiente copiando la
 * versión vigente del año anterior (D20), no la Base preventiva 2026. El
 * programa nuevo no puede nacer con bloqueos que el origen no tenía.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq, getTableColumns } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

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

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/** T6: simula que la siembra de casillas posterior a la activación falla. */
const slotSeeding = vi.hoisted(() => ({ fail: false }))
vi.mock("@/lib/services/prevention-program-slots", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/services/prevention-program-slots")>()
  return {
    ...original,
    ensurePreventionProgramSlotsForProgram: async (programId: string) => {
      if (slotSeeding.fail) throw new Error("disco lleno")
      return original.ensurePreventionProgramSlotsForProgram(programId)
    },
  }
})

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const SOURCE_YEAR = 2076
const TARGET_YEAR = 2077
const USER_ID = "user-copy"
const JDPR = "user-copy-jdpr"
const LEGAL = "user-copy-legal"
const WS_ID = "ws-copy"
const WS_OLD = "ws-copy-old"

const { createAnnualPdtpProgram, createLegacyPdtpProgramForTests } = await import("@/lib/services/pdtp/programs")
const { addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
const lifecycle = await import("@/lib/services/pdtp/lifecycle")

beforeEach(async () => {
  // Desde M04 (T7a) ejecuciones, desvíos y cierres restringen el borrado de
  // actividades y programas: se limpian antes.
  await inMemoryDb.delete(schema.pdtpPeriodClosures)
  await inMemoryDb.delete(schema.pdtpExecutionDeviations)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpFulfillmentEventTargets)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpScheduledInstances)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteAssignees)
  await inMemoryDb.delete(schema.pdtpApprovalDecisions)
  await inMemoryDb.delete(schema.pdtpApprovalSteps)
  await inMemoryDb.delete(schema.pdtpActivityReminderRules)
  await inMemoryDb.delete(schema.pdtpActivityExecutionConfigs)
  await inMemoryDb.delete(schema.pdtpActivityExecutorAssignments)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteParams)
  await inMemoryDb.delete(schema.pdtpActivityScheduleOverrides)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpSheetActivities)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpSheets)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpProgramTemplateVersions)
  await inMemoryDb.delete(schema.pdtpProgramTemplates)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.rolePermissions)
  await inMemoryDb.delete(schema.permissions)
  await inMemoryDb.delete(schema.roles)
  // PREV-C03.4: activar un programa siembra las casillas del año en sus faenas.
  await inMemoryDb.delete(schema.preventionTrainingOccurrenceEvidence)
  await inMemoryDb.delete(schema.preventionTrainingOccurrences)
  await inMemoryDb.delete(schema.preventionHygieneMeasurementSlots)
  await inMemoryDb.delete(schema.preventionProtocolApplicabilities)
  await inMemoryDb.delete(schema.preventionAlcotestSlots)
  await inMemoryDb.delete(schema.preventionGrdMeetingSlots)
  await inMemoryDb.delete(schema.preventionEmergencyDrillSlots)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.insert(schema.users).values([
    { id: USER_ID, name: "Prevencionista", email: "copy@test", hashedPassword: "x", isActive: true },
    { id: JDPR, name: "Jefatura", email: "copy-jdpr@test", hashedPassword: "x", isActive: true },
    { id: LEGAL, name: "Legal", email: "copy-legal@test", hashedPassword: "x", isActive: true },
  ])
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_ID, name: "Faena copia", code: "FC", isActive: true },
    { id: WS_OLD, name: "Faena cerrada", code: "FX", isActive: true },
  ])
  await inMemoryDb.insert(schema.roles).values({ id: "role-copy", name: "prevencionista_copia", label: "Prevencionista" })
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values({ slug: "prevencionista", displayName: "Prevencionista", roleName: "prevencionista_copia", kind: "rbac_role" })
  await inMemoryDb.insert(schema.permissions).values([
    { id: "perm-copy-constancias", name: "prevention:constancias:execute", module: "prevention" },
    { id: "perm-copy-pdtp", name: "prevention:pdtp:execute", module: "prevention" },
    { id: "perm-copy-inspections", name: "prevention:inspections:execute", module: "prevention" },
  ])
  await inMemoryDb.insert(schema.rolePermissions).values([
    { roleId: "role-copy", permissionId: "perm-copy-constancias" },
    { roleId: "role-copy", permissionId: "perm-copy-pdtp" },
    { roleId: "role-copy", permissionId: "perm-copy-inspections" },
  ])
})

/** Un programa activo del año de origen con una actividad configurada a fondo y una retirada. */
async function seedSourceProgram() {
  const source = await createLegacyPdtpProgramForTests({ year: SOURCE_YEAR, title: `Programa ${SOURCE_YEAR}`, userId: USER_ID })
  const configured = await addPdtpActivity({
    programId: source.id,
    activity: "Inspección planificada de extintores",
    program: "Inspecciones",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    sheetCodes: [],
    scheduleMode: "on_demand",
  }, USER_ID)
  const retired = await addPdtpActivity({
    programId: source.id,
    activity: "Actividad que se dejó de hacer",
    program: "Inspecciones",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    sheetCodes: [],
    scheduleMode: "on_demand",
  }, USER_ID)
  const now = new Date().toISOString()
  await inMemoryDb.update(schema.pdtpActivities).set({
    mechanism: "enganche",
    manualEvidencePolicy: "declaration_allowed",
    dueHours: 48,
    scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed",
    scheduleDefinition: { version: 1, kind: "recurring", startDate: `${SOURCE_YEAR}-01-01`, endDate: `${SOURCE_YEAR}-12-31`, every: 1, unit: "month", dayOfMonth: 10 },
  }).where(eq(schema.pdtpActivities.id, configured.id))
  await inMemoryDb.update(schema.pdtpActivities).set({
    status: "retired", retiredReason: "Se dejó de ejecutar en la faena", retiredEffectiveFrom: `${SOURCE_YEAR}-06-01`, retiredAt: now,
  }).where(eq(schema.pdtpActivities.id, retired.id))
  await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
    id: `sched-${configured.id}`, activityId: configured.id, year: SOURCE_YEAR, month: 3, week: 2, plannedQuantity: 1, sourceColumn: "P",
  })
  await inMemoryDb.insert(schema.pdtpActivityExecutionConfigs).values({
    id: `pdtp-exec-config-${configured.id}`, activityId: configured.id, destinationConnectorKey: "inspections",
    completionPolicy: "source_completed", evidenceRequired: true, acceptedEvidenceKinds: ["file"], createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivityReminderRules).values({
    id: "rule-copy", activityId: configured.id, offsetValue: 2, offsetUnit: "day", recipientKind: "responsible", isActive: true, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivityExecutorAssignments).values({
    id: "executor-copy", activityId: configured.id, roleId: "role-copy", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
    id: "exclusion-copy", activityId: configured.id, worksiteId: WS_OLD, reason: "La faena no tiene extintores propios", createdAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivityScheduleOverrides).values({
    id: "override-copy", activityId: configured.id, worksiteId: WS_ID, year: SOURCE_YEAR, month: 4, week: 1, plannedQuantity: 3, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivityWorksiteParams).values({
    id: "param-copy", activityId: configured.id, worksiteId: WS_ID, expectedSubjectCount: 14, targetCoveragePercent: 80, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.update(schema.pdtpPrograms).set({
    status: "active", activatedAt: `${SOURCE_YEAR}-01-05T12:00:00.000Z`, documentCode: "RE-36", documentRevision: "04",
  }).where(eq(schema.pdtpPrograms.id, source.id))
  const [sourceRow] = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, source.id))
  return { source: sourceRow!, configuredId: configured.id, retiredId: retired.id }
}

describe("createAnnualPdtpProgram — copia del año anterior (D20)", () => {
  it("la copia conserva número e identidad de catálogo: el contrato de destinos sigue apuntando al mismo módulo (M-13)", async () => {
    const { engancheDestinationFor } = await import("@/lib/services/pdtp-adapters/fulfillment-contract-2026")
    const { source } = await seedSourceProgram()
    const result = await createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID })
    const identity = (rows: Array<typeof schema.pdtpActivities.$inferSelect>) => rows
      .map((row) => ({ n: row.n, catalogActivityId: row.catalogActivityId, mechanism: row.mechanism }))
      .sort((a, b) => a.n - b.n)
    const sourceRows = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, source.id))
    const copyRows = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, result.program.id))
    // Las retiradas no pasan al año nuevo; las demás conservan su identidad.
    expect(identity(copyRows)).toEqual(identity(sourceRows.filter((row) => row.status !== "retired")))
    for (const row of copyRows) expect(engancheDestinationFor(row.n)).toEqual(engancheDestinationFor(sourceRows.find((s) => s.n === row.n)!.n))
  })

  it("la cabecera lleva el cargo real de quien elabora, no siempre «Prevencionista» (C-01)", async () => {
    await seedSourceProgram()
    await inMemoryDb.insert(schema.roles).values({ id: "role-jdpr-copy", name: "jefatura_dpr_copia", label: "Jefatura del DPR" })
    await inMemoryDb.insert(schema.userRoles).values({ userId: JDPR, roleId: "role-jdpr-copy" })
    const result = await createAnnualPdtpProgram({ year: TARGET_YEAR, userId: JDPR })
    expect(result.program).toMatchObject({ elaboratedByName: "Jefatura", elaboratedByTitle: "Jefatura del DPR" })
  })

  it("por omisión copia la versión vigente del año anterior, con período, título y cabecera del año nuevo", async () => {
    const { source } = await seedSourceProgram()
    const result = await createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID })
    expect(result.created).toBe(true)
    expect(result.program).toMatchObject({
      year: TARGET_YEAR,
      version: 1,
      status: "draft",
      title: `Programa de Trabajo Preventivo SG-SST ${TARGET_YEAR}`,
      periodStart: `${TARGET_YEAR}-01-01`,
      periodEnd: `${TARGET_YEAR}-12-31`,
      creationMode: "program_copy",
      sourceProgramId: source.id,
      appliesToAllWorksites: source.appliesToAllWorksites,
      documentCode: "RE-36",
      documentRevision: "04",
      complianceTarget: source.complianceTarget,
    })
    expect(result.program.sourceMetadataJson).toMatchObject({ copiedFrom: { programId: source.id, year: SOURCE_YEAR } })
  })

  it("cada columna de la actividad llega igual, salvo identidad y la programación, que se re-ancla al año nuevo", async () => {
    const { configuredId } = await seedSourceProgram()
    const result = await createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID })
    const [source] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, configuredId))
    const [copy] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(and(eq(schema.pdtpActivities.programId, result.programId), eq(schema.pdtpActivities.n, source!.n)))
    const ownColumns = new Set(["id", "programId", "createdAt", "updatedAt", "objectiveId", "scheduleDefinition"])
    const differing = Object.keys(getTableColumns(schema.pdtpActivities))
      .filter((column) => !ownColumns.has(column))
      .filter((column) => JSON.stringify((source as Record<string, unknown>)[column]) !== JSON.stringify((copy as Record<string, unknown>)[column]))
    expect(differing).toEqual([])
    expect(copy!.scheduleDefinition).toMatchObject({ startDate: `${TARGET_YEAR}-01-01`, endDate: `${TARGET_YEAR}-12-31`, dayOfMonth: 10 })

    const [cell] = await inMemoryDb.select().from(schema.pdtpActivitySchedule).where(eq(schema.pdtpActivitySchedule.activityId, copy!.id))
    expect(cell).toMatchObject({ year: TARGET_YEAR, month: 3, week: 2, plannedQuantity: 1 })
  })

  it("copia configuración, recordatorios, ejecutores y exclusiones; no copia overrides, padrón ni retiradas", async () => {
    const { configuredId, retiredId } = await seedSourceProgram()
    const result = await createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID })
    const copies = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, result.programId))
    const [retiredSource] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, retiredId))
    expect(copies.map((row) => row.n)).not.toContain(retiredSource!.n)
    const [sourceActivity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, configuredId))
    const copy = copies.find((row) => row.n === sourceActivity!.n)!

    expect(await inMemoryDb.select().from(schema.pdtpActivityExecutionConfigs).where(eq(schema.pdtpActivityExecutionConfigs.activityId, copy.id)))
      .toEqual([expect.objectContaining({ destinationConnectorKey: "inspections", completionPolicy: "source_completed" })])
    expect(await inMemoryDb.select().from(schema.pdtpActivityReminderRules).where(eq(schema.pdtpActivityReminderRules.activityId, copy.id))).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.pdtpActivityExecutorAssignments).where(eq(schema.pdtpActivityExecutorAssignments.activityId, copy.id)))
      .toEqual([expect.objectContaining({ roleId: "role-copy" })])
    expect(await inMemoryDb.select().from(schema.pdtpActivityWorksiteExclusions).where(eq(schema.pdtpActivityWorksiteExclusions.activityId, copy.id))).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.pdtpActivityScheduleOverrides).where(eq(schema.pdtpActivityScheduleOverrides.activityId, copy.id))).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.pdtpActivityWorksiteParams).where(eq(schema.pdtpActivityWorksiteParams.activityId, copy.id)))
      .toEqual([expect.objectContaining({ expectedSubjectCount: null, targetCoveragePercent: 80 })])

    expect(result.copyReport).toMatchObject({
      mode: "next_year",
      skippedRetiredActivityNumbers: [retiredSource!.n],
      droppedScheduleOverrides: 1,
      droppedSubjectCounts: 1,
    })
    const [log] = await inMemoryDb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.programId, result.programId))
    expect(log?.note).toMatch(new RegExp(`copiando ${SOURCE_YEAR} v1`))
  })

  it("el borrador copiado no nace con bloqueos que el origen no tenía", async () => {
    const { source } = await seedSourceProgram()
    const result = await createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID })
    const sourceBlockers = await lifecycle.getPdtpSubmitReviewBlockers(source.id)
    const copyBlockers = await lifecycle.getPdtpSubmitReviewBlockers(result.programId)
    expect(copyBlockers).toEqual(sourceBlockers)
  })

  it("si el año ya existe no crea otro y lo dice (created:false)", async () => {
    await seedSourceProgram()
    const first = await createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID })
    const again = await createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID })
    expect(again).toMatchObject({ created: false, programId: first.programId })
    expect(again.program.creationMode).toBe("program_copy")
  })

  it("dos creaciones concurrentes devuelven el mismo programa", async () => {
    await seedSourceProgram()
    const [left, right] = await Promise.all([
      createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID }),
      createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID }),
    ])
    expect(left.programId).toBe(`pdtp-${TARGET_YEAR}-v1`)
    expect(right.programId).toBe(left.programId)
  })

  it("rechaza copiar un borrador, una versión superada o un año que no es anterior", async () => {
    const { source } = await seedSourceProgram()
    await expect(createAnnualPdtpProgram({ year: SOURCE_YEAR - 1, userId: USER_ID, source: { kind: "previous_program", programId: source.id } }))
      .rejects.toThrow(/año anterior/)

    // v1 superada por una v2 del mismo año: su contenido ya no es el vigente.
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "closed" }).where(eq(schema.pdtpPrograms.id, source.id))
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: `pdtp-${SOURCE_YEAR}-v2`, year: SOURCE_YEAR, version: 2, status: "active", title: "v2",
      elaboratedByName: "P", elaboratedByTitle: "P", appliesToAllWorksites: true, createdAt: now, updatedAt: now,
    })
    await expect(createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID, source: { kind: "previous_program", programId: source.id } }))
      .rejects.toThrow(/versión vigente de 2076.*v2/)

    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" }).where(eq(schema.pdtpPrograms.id, `pdtp-${SOURCE_YEAR}-v2`))
    await expect(createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID, source: { kind: "previous_program", programId: `pdtp-${SOURCE_YEAR}-v2` } }))
      .rejects.toThrow(/versión vigente/)
  })

  it("al activar el año nuevo se traspasan las asignaciones nominales vigentes del año copiado", async () => {
    const { configuredId, source } = await seedSourceProgram()
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpActivityWorksiteAssignees).values([
      { id: "assignee-active", activityId: configuredId, worksiteId: WS_ID, userId: USER_ID, validFrom: `${SOURCE_YEAR}-02-01`, createdAt: now, updatedAt: now },
      { id: "assignee-inactive-user", activityId: configuredId, worksiteId: WS_ID, userId: LEGAL, validFrom: `${SOURCE_YEAR}-02-01`, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, LEGAL))
    const result = await createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID })
    // El borrador no las trae: no están firmadas y sólo se asignan en programas activos.
    const [copy] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(and(eq(schema.pdtpActivities.programId, result.programId), eq(schema.pdtpActivities.status, "active")))
    expect(await inMemoryDb.select().from(schema.pdtpActivityWorksiteAssignees).where(eq(schema.pdtpActivityWorksiteAssignees.activityId, copy!.id))).toHaveLength(0)

    await inMemoryDb.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, LEGAL))
    await lifecycle.submitPdtpProgramForReview(result.programId, USER_ID)
    await lifecycle.approvePdtpProgramJdpr(result.programId, JDPR)
    await lifecycle.signPdtpProgramLegal(result.programId, LEGAL)
    await inMemoryDb.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, LEGAL))
    const activated = await lifecycle.activatePdtpProgram(result.programId, JDPR)
    expect(activated.status).toBe("active")

    const handed = await inMemoryDb.select().from(schema.pdtpActivityWorksiteAssignees).where(eq(schema.pdtpActivityWorksiteAssignees.activityId, copy!.id))
    expect(handed.map((row) => row.userId)).toEqual([USER_ID])
    expect(handed[0]!.validFrom >= `${TARGET_YEAR}-01-01`).toBe(true)
    // El año de origen sigue activo con sus asignaciones intactas.
    const [stillActive] = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, source.id))
    expect(stillActive?.status).toBe("active")
    expect(await inMemoryDb.select().from(schema.pdtpActivityWorksiteAssignees).where(eq(schema.pdtpActivityWorksiteAssignees.activityId, configuredId))).toHaveLength(2)
  })

  it("una Base publicada desde un programa de cualquier año restaura todo al instanciarse (PREV-C03.2)", async () => {
    const { createPdtpTemplateVersion } = await import("@/lib/services/pdtp/templates")
    const { configuredId, source } = await seedSourceProgram()
    const now = new Date().toISOString()
    // Un recordatorio a una persona puntual y un ejecutor extra cuyos destinos
    // desaparecen después de publicar: se omiten y se informan, no se re-apuntan.
    await inMemoryDb.insert(schema.users).values({ id: "user-gone", name: "Se fue", email: "gone@test", hashedPassword: "x" })
    await inMemoryDb.insert(schema.roles).values({ id: "role-gone", name: "rol_retirado", label: "Rol retirado" })
    await inMemoryDb.insert(schema.pdtpActivityReminderRules).values({
      id: "rule-user", activityId: configuredId, offsetValue: 1, offsetUnit: "day", recipientKind: "user", recipientUserId: "user-gone", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpActivityExecutorAssignments).values({
      id: "executor-gone", activityId: configuredId, roleId: "role-gone", createdAt: now, updatedAt: now,
    })

    // Publicar la Base desde un programa que no es de 2026: la publicación
    // genérica no exige el año del documento oficial.
    const published = await createPdtpTemplateVersion({ sourceProgramId: source.id, name: "Base preventiva 2026", userId: USER_ID })
    expect(published.version.snapshotJson).toMatchObject({ schemaVersion: 20 })
    await inMemoryDb.delete(schema.pdtpActivityReminderRules).where(eq(schema.pdtpActivityReminderRules.id, "rule-user"))
    await inMemoryDb.delete(schema.users).where(eq(schema.users.id, "user-gone"))
    await inMemoryDb.delete(schema.pdtpActivityExecutorAssignments).where(eq(schema.pdtpActivityExecutorAssignments.id, "executor-gone"))
    await inMemoryDb.delete(schema.roles).where(eq(schema.roles.id, "role-gone"))

    const result = await createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID, source: { kind: "base" } })
    expect(result.program.creationMode).toBe("base_2026")
    const [sourceActivity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, configuredId))
    const copies = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, result.programId))
    // La retirada no vuelve (re-anclar su retiro la dejaba vigente parte del año).
    expect(copies).toHaveLength(1)
    const copy = copies[0]!
    expect(copy).toMatchObject({
      n: sourceActivity!.n,
      mechanism: "enganche",
      dueHours: 48,
      manualEvidencePolicy: "declaration_allowed",
      scheduleMode: "scheduled",
    })
    expect(copy.scheduleDefinition).toMatchObject({ startDate: `${TARGET_YEAR}-01-01`, endDate: `${TARGET_YEAR}-12-31` })
    expect(await inMemoryDb.select().from(schema.pdtpActivityExecutionConfigs).where(eq(schema.pdtpActivityExecutionConfigs.activityId, copy.id)))
      .toEqual([expect.objectContaining({ destinationConnectorKey: "inspections", evidenceRequired: true })])
    expect((await inMemoryDb.select().from(schema.pdtpActivityReminderRules).where(eq(schema.pdtpActivityReminderRules.activityId, copy.id))).map((rule) => rule.recipientKind))
      .toEqual(["responsible"])
    expect((await inMemoryDb.select().from(schema.pdtpActivityExecutorAssignments).where(eq(schema.pdtpActivityExecutorAssignments.activityId, copy.id))).map((row) => row.roleId))
      .toEqual(["role-copy"])
    expect(await inMemoryDb.select().from(schema.pdtpActivityWorksiteExclusions).where(eq(schema.pdtpActivityWorksiteExclusions.activityId, copy.id))).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.pdtpActivityWorksiteParams).where(eq(schema.pdtpActivityWorksiteParams.activityId, copy.id)))
      .toEqual([expect.objectContaining({ targetCoveragePercent: 80, expectedSubjectCount: null })])
    // Los ajustes puntuales por faena no se instancian desde una plantilla.
    expect(await inMemoryDb.select().from(schema.pdtpActivityScheduleOverrides).where(eq(schema.pdtpActivityScheduleOverrides.activityId, copy.id))).toHaveLength(0)

    const [log] = await inMemoryDb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.programId, result.programId))
    expect(log?.after).toMatchObject({
      instantiationReport: {
        skippedReminderRules: [expect.objectContaining({ activityNumber: sourceActivity!.n, reason: expect.stringMatching(/usuario/) })],
        skippedExecutorAssignments: [expect.objectContaining({ activityNumber: sourceActivity!.n, roleId: "role-gone" })],
      },
    })
  })

  it("sin programa anterior, o pidiendo la Base, usa la Base preventiva 2026", async () => {
    await expect(createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID })).rejects.toThrow(/Base preventiva 2026 aún no está publicada/)
    await seedSourceProgram()
    await expect(createAnnualPdtpProgram({ year: TARGET_YEAR, userId: USER_ID, source: { kind: "base" } })).rejects.toThrow(/Base preventiva 2026 aún no está publicada/)
  })
})

describe("activatePdtpProgram — revisión v+1 (PREV-C05-D)", () => {
  it("traspasa en la misma activación los desvíos abiertos cuya semana ya es de la versión nueva", async () => {
    const { createPdtpRevision } = await import("@/lib/services/pdtp/programs")
    const { configuredId, source } = await seedSourceProgram()
    await inMemoryDb.insert(schema.pdtpExecutionDeviations).values({
      id: "dev-reprog-wired", activityId: configuredId, worksiteId: WS_ID, year: SOURCE_YEAR, month: 3, week: 2,
      kind: "reprogrammed", targetMonth: 4, targetWeek: 2, reason: "Se mueve por la parada de planta",
      status: "active", createdByUserId: USER_ID, createdAt: new Date().toISOString(),
    })
    const revision = await createPdtpRevision({ sourceProgramId: source.id, userId: USER_ID })
    await lifecycle.submitPdtpProgramForReview(revision.programId, USER_ID)
    await lifecycle.approvePdtpProgramJdpr(revision.programId, JDPR)
    await lifecycle.signPdtpProgramLegal(revision.programId, LEGAL)
    const activated = await lifecycle.activatePdtpProgram(revision.programId, JDPR)
    expect(activated.status).toBe("active")

    const [copy] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(and(eq(schema.pdtpActivities.programId, revision.programId), eq(schema.pdtpActivities.status, "active")))
    const moved = await inMemoryDb.select().from(schema.pdtpExecutionDeviations)
      .where(eq(schema.pdtpExecutionDeviations.activityId, copy!.id))
    expect(moved).toEqual([expect.objectContaining({ kind: "reprogrammed", status: "active", month: 3, week: 2, targetMonth: 4, targetWeek: 2 })])
    const [original] = await inMemoryDb.select().from(schema.pdtpExecutionDeviations)
      .where(eq(schema.pdtpExecutionDeviations.id, "dev-reprog-wired"))
    expect(original!.status).toBe("withdrawn")
  })
})

describe("activatePdtpProgram — pasos posteriores a la activación (T6)", () => {
  it("si la siembra de casillas falla, la activación queda vigente pero lo avisa y lo deja en el control de cambios", async () => {
    const { createPdtpRevision } = await import("@/lib/services/pdtp/programs")
    const { source } = await seedSourceProgram()
    const revision = await createPdtpRevision({ sourceProgramId: source.id, userId: USER_ID })
    await lifecycle.submitPdtpProgramForReview(revision.programId, USER_ID)
    await lifecycle.approvePdtpProgramJdpr(revision.programId, JDPR)
    await lifecycle.signPdtpProgramLegal(revision.programId, LEGAL)
    slotSeeding.fail = true
    try {
      const activated = await lifecycle.activatePdtpProgram(revision.programId, JDPR)
      expect(activated.status).toBe("active")
      expect(activated.postActivationWarnings).toEqual([expect.stringMatching(/casillas/)])
    } finally {
      slotSeeding.fail = false
    }
    const [entry] = await inMemoryDb.select().from(schema.pdtpChangeLog)
      .where(and(eq(schema.pdtpChangeLog.programId, revision.programId), eq(schema.pdtpChangeLog.section, "lifecycle:post-activation")))
    expect(entry!.note).toMatch(/casillas/)
  })
})
