import { and, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityChecklists,
  pdtpActivityExecutorAssignments,
  pdtpActivitySchedule,
  pdtpActivityScheduleOverrides,
  pdtpActivityWorksiteExclusions,
  pdtpActivityWorksiteParams,
  pdtpObjectives,
  pdtpPrograms,
  pdtpRevisionDiffDecisions,
  pdtpSheetActivities,
  pdtpSheets,
  preventionPdtpSourceLinks,
  roles,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { comparePdtpRevisionToCurrentBase, type PdtpRevisionDiff } from "./base-comparison"
import { pdtpActivityChecklistId } from "./checklist-domain"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState, pdtpActivityId, pdtpScheduleId, pdtpSheetActivityId } from "./helpers"
import { getCurrentPdtpBase2026Version } from "./templates"

type SnapshotRecord = Record<string, unknown>
type DiffDecision = "applied" | "kept"
type QueryClient = typeof db | Tx

function records(value: unknown): SnapshotRecord[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is SnapshotRecord => typeof entry === "object" && entry !== null)
    : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function activityIdentity(activity: SnapshotRecord) {
  return typeof activity.catalogActivityId === "string" && activity.catalogActivityId
    ? `catalog:${activity.catalogActivityId}`
    : `number:${String(activity.n)}`
}

function activityValues(activity: SnapshotRecord, now: string, objectiveIdByCode: Map<string, string>) {
  return {
    catalogActivityId: typeof activity.catalogActivityId === "string" ? activity.catalogActivityId : null,
    catalogRevision: typeof activity.catalogRevision === "number" ? activity.catalogRevision : null,
    // El objetivo se resuelve por código, no por id: la Base declara
    // `objectiveCode` (ver content-digest.ts, ≥15), y el id real depende de
    // qué objetivo con ese código tenga ESTE programa — nunca el id del
    // objetivo en el programa de la Base, que violaría la FK compuesta
    // `pdtp_activities_objective_same_program_fk`. Un código que ya no
    // exista en este programa (objetivo eliminado localmente) cae a `null`
    // en vez de fallar la adopción completa de la diferencia.
    objectiveId: typeof activity.objectiveCode === "string"
      ? (objectiveIdByCode.get(activity.objectiveCode) ?? null)
      : null,
    displayOrder: numberValue(activity.displayOrder, numberValue(activity.n)),
    status: stringValue(activity.status, "active"),
    retiredReason: typeof activity.retiredReason === "string" ? activity.retiredReason : null,
    retiredEffectiveFrom: typeof activity.retiredEffectiveFrom === "string" ? activity.retiredEffectiveFrom : null,
    retiredByUserId: typeof activity.retiredByUserId === "string" ? activity.retiredByUserId : null,
    retiredAt: typeof activity.retiredAt === "string" ? activity.retiredAt : null,
    activity: stringValue(activity.activity, "Actividad"),
    program: stringValue(activity.program, "Gestión preventiva"),
    responsibleSlugs: strings(activity.responsibleSlugs),
    responsibleDisplay: stringValue(activity.responsibleDisplay, "Equipo de Prevención"),
    audienceRoles: strings(activity.audienceRoles),
    scheduleMode: stringValue(activity.scheduleMode, "scheduled"),
    scheduleClassificationStatus: stringValue(activity.scheduleClassificationStatus, "confirmed"),
    recurrenceRule: activity.recurrenceRule ?? null,
    triggerType: typeof activity.triggerType === "string" ? activity.triggerType : null,
    triggerDescription: typeof activity.triggerDescription === "string" ? activity.triggerDescription : null,
    dueDays: typeof activity.dueDays === "number" ? activity.dueDays : null,
    dueHours: typeof activity.dueHours === "number" ? activity.dueHours : null,
    evidenceRequirement: typeof activity.evidenceRequirement === "string" ? activity.evidenceRequirement : null,
    mechanism: stringValue(activity.mechanism, "sin_definir"),
    indicatorMode: stringValue(activity.indicatorMode, "planned_vs_completed"),
    subjectSource: typeof activity.subjectSource === "string" ? activity.subjectSource : null,
    subjectCapabilityCodes: Array.isArray(activity.subjectCapabilityCodes)
      ? strings(activity.subjectCapabilityCodes)
      : null,
    targetValue: typeof activity.targetValue === "number" ? activity.targetValue : null,
    targetUnit: typeof activity.targetUnit === "string" ? activity.targetUnit : null,
    notes: typeof activity.notes === "string" ? activity.notes : null,
    updatedAt: now,
  }
}

async function upsertDecision(input: {
  programId: string
  baseTemplateVersionId: string
  activityIdentity: string
  decision: DiffDecision
  userId: string
  now: string
  client: QueryClient
}) {
  const [existing] = await input.client.select({ id: pdtpRevisionDiffDecisions.id })
    .from(pdtpRevisionDiffDecisions)
    .where(and(
      eq(pdtpRevisionDiffDecisions.programId, input.programId),
      eq(pdtpRevisionDiffDecisions.baseTemplateVersionId, input.baseTemplateVersionId),
      eq(pdtpRevisionDiffDecisions.activityIdentity, input.activityIdentity),
    ))
    .limit(1)
  if (existing) {
    await input.client.update(pdtpRevisionDiffDecisions).set({
      decision: input.decision,
      decidedByUserId: input.userId,
      decidedAt: input.now,
      updatedAt: input.now,
    }).where(eq(pdtpRevisionDiffDecisions.id, existing.id))
    return
  }
  await input.client.insert(pdtpRevisionDiffDecisions).values({
    id: `pdtp-revision-diff-${nanoid()}`,
    programId: input.programId,
    baseTemplateVersionId: input.baseTemplateVersionId,
    activityIdentity: input.activityIdentity,
    decision: input.decision,
    decidedByUserId: input.userId,
    decidedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export type PdtpRevisionDiffDecisionView = {
  activityIdentity: string
  decision: DiffDecision
  decidedAt: string
}

export async function listPdtpRevisionDiffDecisions(
  programId: string,
  baseTemplateVersionId: string,
): Promise<PdtpRevisionDiffDecisionView[]> {
  return db.select({
    activityIdentity: pdtpRevisionDiffDecisions.activityIdentity,
    decision: pdtpRevisionDiffDecisions.decision,
    decidedAt: pdtpRevisionDiffDecisions.decidedAt,
  }).from(pdtpRevisionDiffDecisions).where(and(
    eq(pdtpRevisionDiffDecisions.programId, programId),
    eq(pdtpRevisionDiffDecisions.baseTemplateVersionId, baseTemplateVersionId),
  )) as Promise<PdtpRevisionDiffDecisionView[]>
}

/**
 * Conserva una diferencia sin alterar la revisión, o adopta de forma
 * deliberada la actividad equivalente de la Base vigente. Nunca se invoca al
 * clonar: cada cambio requiere esta acción explícita del operador.
 */
export async function decidePdtpRevisionDiff(input: {
  programId: string
  activityIdentity: string
  decision: DiffDecision
  userId: string
}) {
  const comparison = await comparePdtpRevisionToCurrentBase(input.programId)
  if (!comparison) throw new Error("No existe una Base preventiva vigente para comparar esta revisión.")
  const item = comparison.items.find((candidate) => candidate.identity === input.activityIdentity)
  if (!item) throw new Error("La diferencia ya no existe frente a la Base vigente. Actualiza la revisión antes de decidir.")

  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms)
      .where(eq(pdtpPrograms.id, input.programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)
    if (program.version <= 1 || !program.sourceProgramId) {
      throw new Error("Las decisiones contra la Base sólo se aplican en una revisión v+1.")
    }

    const now = new Date().toISOString()
    if (input.decision === "kept") {
      await upsertDecision({
        programId: program.id,
        baseTemplateVersionId: comparison.baseTemplateVersionId,
        activityIdentity: item.identity,
        decision: "kept",
        userId: input.userId,
        now,
        client: tx,
      })
      await addPdtpChangeLogEntry(
        program.id,
        program.version,
        input.userId,
        "revision:base-diff",
        null,
        { baseTemplateVersionId: comparison.baseTemplateVersionId, activityIdentity: item.identity, decision: "kept" },
        `Se conserva la diferencia ${item.identity} respecto de la Base vigente.`,
        tx,
      )
      return { decision: "kept" as const, activityIdentity: item.identity }
    }

    const base = await getCurrentPdtpBase2026Version(tx)
    if (!base || base.version.id !== comparison.baseTemplateVersionId) {
      throw new Error("La Base preventiva cambió mientras se revisaba la diferencia. Actualiza la pantalla e inténtalo otra vez.")
    }
    const snapshot = base.version.snapshotJson as SnapshotRecord
    const baseActivity = records(snapshot.activities).find((activity) => activityIdentity(activity) === item.identity)
    const currentActivities = await tx.select().from(pdtpActivities)
      .where(eq(pdtpActivities.programId, program.id))
    const currentActivity = currentActivities.find((activity) => activityIdentity(activity as unknown as SnapshotRecord) === item.identity)

    if (item.kind === "only_in_revision") {
      if (!currentActivity) throw new Error("La actividad de la revisión ya no existe.")
      await tx.delete(pdtpActivities).where(eq(pdtpActivities.id, currentActivity.id))
    } else {
      if (!baseActivity) throw new Error("La actividad ya no está disponible en la Base vigente.")
      const activityNumber = numberValue(baseActivity.n)
      if (activityNumber < 1) throw new Error("La Base contiene una actividad sin número válido.")
      const programObjectives = await tx.select({ id: pdtpObjectives.id, code: pdtpObjectives.code })
        .from(pdtpObjectives)
        .where(eq(pdtpObjectives.programId, program.id))
      const objectiveIdByCode = new Map(programObjectives.map((objective) => [objective.code, objective.id]))
      let activityId = currentActivity?.id
      if (!activityId) {
        const [sameNumber] = await tx.select({ id: pdtpActivities.id }).from(pdtpActivities)
          .where(and(eq(pdtpActivities.programId, program.id), eq(pdtpActivities.n, activityNumber))).limit(1)
        if (sameNumber) throw new Error(`La actividad N°${activityNumber} ya existe con otra identidad; resuelve el conflicto manualmente.`)
        activityId = pdtpActivityId(program.id, activityNumber)
        await tx.insert(pdtpActivities).values({
          id: activityId,
          programId: program.id,
          n: activityNumber,
          sourceSheetRow: 0,
          createdAt: now,
          ...activityValues(baseActivity, now, objectiveIdByCode),
        })
      } else {
        const values = activityValues(baseActivity, now, objectiveIdByCode)
        // Las Bases anteriores a la v14 no declaraban `mechanism` en su
        // snapshot. Adoptar otra diferencia no debe borrar el mecanismo que
        // ya tiene la revisión por una ausencia histórica del campo.
        if (!("mechanism" in baseActivity)) {
          delete (values as Partial<typeof pdtpActivities.$inferInsert>).mechanism
        }
        // Mismo criterio para `objectiveCode`: las Bases anteriores a la v15
        // no lo declaraban. Adoptar otra diferencia no debe desasignar el
        // objetivo que ya tiene la revisión por una ausencia histórica del
        // campo — a diferencia de una Base v15+ que sí declara el campo y
        // cuyo `null` explícito (objetivo quitado en la Base) sí debe pisar.
        if (!("objectiveCode" in baseActivity)) {
          delete (values as Partial<typeof pdtpActivities.$inferInsert>).objectiveId
        }
        await tx.update(pdtpActivities).set({
          n: activityNumber,
          ...values,
        })
          .where(eq(pdtpActivities.id, activityId))
      }

      await tx.delete(pdtpActivitySchedule).where(eq(pdtpActivitySchedule.activityId, activityId))
      const schedules = records(snapshot.schedules).filter((schedule) => numberValue(schedule.activityNumber) === activityNumber)
      if (schedules.length > 0) {
        await tx.insert(pdtpActivitySchedule).values(schedules.map((schedule) => ({
          id: pdtpScheduleId(activityId, program.year, numberValue(schedule.month), numberValue(schedule.week)),
          activityId,
          year: program.year,
          month: numberValue(schedule.month),
          week: numberValue(schedule.week),
          plannedQuantity: numberValue(schedule.plannedQuantity),
          sourceColumn: "base-revision",
        })))
      }

      await tx.delete(pdtpActivityExecutorAssignments).where(eq(pdtpActivityExecutorAssignments.activityId, activityId))
      const baseRoleIds = records(snapshot.executorAssignments)
        .filter((assignment) => numberValue(assignment.activityNumber) === activityNumber)
        .flatMap((assignment) => typeof assignment.roleId === "string" ? [assignment.roleId] : [])
      if (baseRoleIds.length > 0) {
        const availableRoles = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, baseRoleIds))
        if (availableRoles.length !== new Set(baseRoleIds).size) {
          throw new Error("La Base referencia un rol ejecutor que ya no existe; no se puede aplicar esta diferencia.")
        }
        await tx.insert(pdtpActivityExecutorAssignments).values([...new Set(baseRoleIds)].map((roleId) => ({
          id: `pdtp-executor-${nanoid()}`,
          activityId,
          roleId,
          createdAt: now,
          updatedAt: now,
        })))
      }

      await tx.delete(pdtpActivityChecklists).where(eq(pdtpActivityChecklists.activityId, activityId))
      const checklists = records(snapshot.checklists).filter((checklist) => numberValue(checklist.activityNumber) === activityNumber)
      if (checklists.length > 0) {
        await tx.insert(pdtpActivityChecklists).values(checklists.map((checklist) => {
          const checklistVersion = stringValue(checklist.version, "01")
          return {
            id: pdtpActivityChecklistId(activityId, checklistVersion),
            activityId,
            programId: program.id,
            version: checklistVersion,
            label: stringValue(checklist.label, "Checklist"),
            definitionJson: checklist.definitionJson ?? {},
            isActive: true,
            createdAt: now,
            updatedAt: now,
          }
        }))
      }

      await tx.delete(pdtpSheetActivities).where(eq(pdtpSheetActivities.activityId, activityId))
      const sheets = await tx.select({ id: pdtpSheets.id, code: pdtpSheets.code }).from(pdtpSheets)
        .where(eq(pdtpSheets.programId, program.id))
      const sheetIdByCode = new Map(sheets.map((sheet) => [sheet.code, sheet.id]))
      const memberships = records(snapshot.memberships).filter((membership) => numberValue(membership.activityNumber) === activityNumber)
      const membershipRows = memberships.flatMap((membership, index) => {
        const sheetCode = stringValue(membership.viewCode)
        const sheetId = sheetIdByCode.get(sheetCode)
        if (!sheetId) return []
        return [{
          id: pdtpSheetActivityId(program.id, sheetCode, activityNumber),
          sheetId,
          sheetCode,
          activityId,
          sheetRow: numberValue(membership.sheetRow, index + 1),
          displayOrder: numberValue(membership.displayOrder, index + 1),
        }]
      })
      if (membershipRows.length > 0) await tx.insert(pdtpSheetActivities).values(membershipRows)

      // La decisión de aplicar una diferencia debe sincronizar todo el
      // contenido asociado a la actividad, no sólo la fila y la planilla. Las
      // ejecuciones quedan intactas porque no pertenecen a estas tablas de
      // autoría; los hechos históricos nunca se clonan ni se reescriben.
      await tx.delete(preventionPdtpSourceLinks).where(eq(preventionPdtpSourceLinks.activityId, activityId))
      const sourceLinks = records(snapshot.sourceLinks)
        .filter((link) => numberValue(link.activityNumber) === activityNumber)
      if (sourceLinks.length > 0) {
        await tx.insert(preventionPdtpSourceLinks).values(sourceLinks.map((link) => ({
          id: `pdtp-source-${nanoid()}`,
          activityId,
          worksiteId: stringValue(link.worksiteId),
          sourceType: stringValue(link.sourceType, "campana"),
          sourceId: stringValue(link.sourceId),
          sourceVersionSnapshot: stringValue(link.sourceVersionSnapshot, "base"),
          justification: stringValue(link.justification, "Vínculo copiado desde la Base vigente."),
          isActive: link.isActive !== false,
          createdByUserId: input.userId,
          createdAt: now,
        })))
      }

      await tx.delete(pdtpActivityWorksiteExclusions).where(eq(pdtpActivityWorksiteExclusions.activityId, activityId))
      const exclusions = records(snapshot.activityWorksiteExclusions)
        .filter((exclusion) => numberValue(exclusion.activityNumber) === activityNumber)
      if (exclusions.length > 0) {
        await tx.insert(pdtpActivityWorksiteExclusions).values(exclusions.map((exclusion) => ({
          id: `pdtp-exclusion-${nanoid()}`,
          activityId,
          worksiteId: stringValue(exclusion.worksiteId),
          reason: stringValue(exclusion.reason, "Exclusión copiada desde la Base vigente."),
          createdByUserId: input.userId,
          createdAt: now,
        })))
      }

      // expectedSubjectCount es un hecho operativo no firmado. Se conserva
      // la cifra local al adoptar los parámetros firmados de la Base.
      const existingParams = await tx.select().from(pdtpActivityWorksiteParams)
        .where(eq(pdtpActivityWorksiteParams.activityId, activityId))
      const expectedByWorksite = new Map(existingParams.map((row) => [row.worksiteId, row.expectedSubjectCount]))
      const baseParams = records(snapshot.activityWorksiteAdjustments)
        .filter((adjustment) => numberValue(adjustment.activityNumber) === activityNumber)
      const baseParamWorksites = new Set(baseParams.map((param) => stringValue(param.worksiteId)))
      for (const row of existingParams) {
        if (!baseParamWorksites.has(row.worksiteId)) {
          if (row.expectedSubjectCount === null) {
            await tx.delete(pdtpActivityWorksiteParams).where(eq(pdtpActivityWorksiteParams.id, row.id))
          } else {
            await tx.update(pdtpActivityWorksiteParams).set({
              targetCoveragePercent: null,
              responsibleSlugs: null,
              responsibleDisplay: null,
              responsibleReason: null,
              updatedByUserId: input.userId,
              updatedAt: now,
            }).where(eq(pdtpActivityWorksiteParams.id, row.id))
          }
        }
      }
      for (const param of baseParams) {
        const worksiteId = stringValue(param.worksiteId)
        const existing = existingParams.find((row) => row.worksiteId === worksiteId)
        const values = {
          expectedSubjectCount: expectedByWorksite.get(worksiteId) ?? null,
          targetCoveragePercent: typeof param.targetCoveragePercent === "number" ? param.targetCoveragePercent : null,
          responsibleSlugs: Array.isArray(param.responsibleSlugs) && strings(param.responsibleSlugs).length > 0
            ? strings(param.responsibleSlugs)
            : null,
          responsibleDisplay: typeof param.responsibleDisplay === "string" ? param.responsibleDisplay : null,
          responsibleReason: typeof param.responsibleReason === "string" ? param.responsibleReason : null,
          updatedByUserId: input.userId,
          updatedAt: now,
        }
        if (existing) {
          await tx.update(pdtpActivityWorksiteParams).set(values)
            .where(eq(pdtpActivityWorksiteParams.id, existing.id))
        } else {
          await tx.insert(pdtpActivityWorksiteParams).values({
            id: `pdtp-worksite-param-${nanoid()}`,
            activityId,
            worksiteId,
            ...values,
            createdAt: now,
          })
        }
      }

      await tx.delete(pdtpActivityScheduleOverrides).where(eq(pdtpActivityScheduleOverrides.activityId, activityId))
      const overrides = records(snapshot.activityScheduleOverrides)
        .filter((override) => numberValue(override.activityNumber) === activityNumber)
      if (overrides.length > 0) {
        await tx.insert(pdtpActivityScheduleOverrides).values(overrides.map((override) => ({
          id: `pdtp-override-${nanoid()}`,
          activityId,
          worksiteId: stringValue(override.worksiteId),
          year: program.year,
          month: numberValue(override.month),
          week: numberValue(override.week),
          plannedQuantity: numberValue(override.plannedQuantity),
          updatedByUserId: input.userId,
          createdAt: now,
          updatedAt: now,
        })))
      }
    }

    await upsertDecision({
      programId: program.id,
      baseTemplateVersionId: comparison.baseTemplateVersionId,
      activityIdentity: item.identity,
      decision: "applied",
      userId: input.userId,
      now,
      client: tx,
    })
    await addPdtpChangeLogEntry(
      program.id,
      program.version,
      input.userId,
      "revision:base-diff",
      null,
      { baseTemplateVersionId: comparison.baseTemplateVersionId, activityIdentity: item.identity, decision: "applied", kind: item.kind },
      `Se aplicó la diferencia ${item.identity} desde la Base vigente.`,
      tx,
    )
    return { decision: "applied" as const, activityIdentity: item.identity }
  })
}

/** Helper exportado para las vistas que necesitan la forma estable de la decisión. */
export type { DiffDecision, PdtpRevisionDiff }
