/**
 * lib/services/pdtp/program-copy.ts
 *
 * PREV-C03.1 (tanda T5): la ÚNICA copia de contenido programa → programa.
 *
 * Antes vivía dentro de `createPdtpProgramAttempt` (programs.ts) y sólo la usaba
 * la revisión v+1. La copia al año siguiente necesitaba lo mismo con otras
 * reglas, y dos copias del mismo bloque se separan en cuanto una de las dos
 * aprende una columna nueva (C05-A fue exactamente eso). Hay un solo recorrido
 * con dos modos:
 *
 * - `revision` (v+1, mismo año): copia todo —historia documental, leyenda,
 *   faenas, planificación, overrides, padrón— salvo ejecuciones, firmas y
 *   decisiones de aprobación.
 * - `next_year` (D20): parte de la versión vigente del año anterior y la lleva
 *   al año destino. No copia actividades retiradas (re-anclar su retiro las
 *   dejaría vigentes parte del año nuevo), ni overrides por faena (son ajustes
 *   del año), ni el padrón (`expectedSubjectCount`, un hecho del mundo, no un
 *   compromiso), ni la historia documental (pertenece al documento del año de
 *   origen). Sí copia la leyenda de roles y re-ancla la programación fechada
 *   con `remapPdtpScheduleDefinitionToYear`. Las asignaciones nominales no
 *   entran al borrador (no están firmadas y sólo se asignan en programas
 *   activos): se traspasan al activar.
 *
 * Devuelve un informe de lo que se re-ancló u omitió, para el changelog y para
 * decírselo a quien creó el programa.
 */

import { eq, inArray, isNull, or } from "drizzle-orm"
import type { Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityChecklists,
  pdtpActivityDocumentRequirements,
  pdtpActivityExecutionConfigs,
  pdtpActivityExecutorAssignments,
  pdtpActivityReminderRules,
  pdtpActivitySchedule,
  pdtpActivityScheduleOverrides,
  pdtpActivityWorksiteExclusions,
  pdtpActivityWorksiteParams,
  pdtpDocumentHistory,
  pdtpImportBatches,
  pdtpObjectives,
  pdtpPrograms,
  pdtpProgramWorksites,
  pdtpRoleLegendEntries,
  pdtpSheetActivities,
  pdtpSheets,
  preventionPdtpSourceLinks,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { copyPdtpApprovalSteps } from "./approval-flow"
import { pdtpActivityChecklistId } from "./checklist-domain"
import { pdtpActivityId, pdtpScheduleId, pdtpSheetActivityId } from "./helpers"
import { remapPdtpScheduleDefinitionToYear, type PdtpScheduleDefinition, type PdtpScheduleRemapNote } from "./schedule-definition"

export type PdtpProgramCopyMode = "revision" | "next_year"

export type PdtpProgramCopyReport = {
  mode: PdtpProgramCopyMode
  copiedActivities: number
  /** Actividades retiradas en el origen que no pasan al año nuevo. */
  skippedRetiredActivityNumbers: number[]
  /** Programación fechada re-anclada, por número de actividad. */
  scheduleNotes: Array<{ n: number; notes: PdtpScheduleRemapNote[] }>
  /** Ajustes puntuales de meta por faena que no pasan al año nuevo. */
  droppedScheduleOverrides: number
  /** Filas de padrón por faena cuyo conteo no pasa al año nuevo. */
  droppedSubjectCounts: number
  /** Faenas del origen que ya no están activas y no entran al programa nuevo. */
  skippedInactiveWorksiteIds: string[]
}

type SourceProgram = typeof pdtpPrograms.$inferSelect

export async function copyPdtpProgramContent(tx: Tx, input: {
  sourceProgram: SourceProgram
  targetProgramId: string
  targetYear: number
  mode: PdtpProgramCopyMode
  userId: string
  now: string
}): Promise<PdtpProgramCopyReport> {
  const { sourceProgram, targetProgramId: programId, targetYear: year, mode, now } = input
  const nextYear = mode === "next_year"
  const report: PdtpProgramCopyReport = {
    mode,
    copiedActivities: 0,
    skippedRetiredActivityNumbers: [],
    scheduleNotes: [],
    droppedScheduleOverrides: 0,
    droppedSubjectCounts: 0,
    skippedInactiveWorksiteIds: [],
  }

  // La trazabilidad documental también pertenece a la revisión. Se clonan
  // los lotes de importación que sostienen la historia/leyenda y se
  // remapean sus FKs al nuevo programa; no se copian ejecuciones, firmas ni
  // decisiones de aprobación. En la copia anual sólo viaja la leyenda: la
  // historia es del documento del año de origen.
  const [sourceHistory, sourceRoleLegend] = await Promise.all([
    nextYear ? Promise.resolve([] as Array<typeof pdtpDocumentHistory.$inferSelect>) : tx.select().from(pdtpDocumentHistory).where(eq(pdtpDocumentHistory.programId, sourceProgram.id)),
    tx.select().from(pdtpRoleLegendEntries).where(eq(pdtpRoleLegendEntries.programId, sourceProgram.id)),
  ])
  const sourceBatchIds = [...new Set([
    ...sourceHistory.map((entry) => entry.sourceImportBatchId).filter((id): id is string => Boolean(id)),
    ...sourceRoleLegend.map((entry) => entry.sourceImportBatchId),
  ])]
  const batchIdMap = new Map<string, string>()
  if (sourceBatchIds.length > 0) {
    const sourceBatches = await tx.select().from(pdtpImportBatches)
      .where(inArray(pdtpImportBatches.id, sourceBatchIds))
    await tx.insert(pdtpImportBatches).values(sourceBatches.map((batch) => {
      const id = `pdtp-import-${nanoid()}`
      batchIdMap.set(batch.id, id)
      return {
        id,
        programId,
        status: "applied",
        adapterCode: batch.adapterCode,
        sourceFileName: batch.sourceFileName,
        sourceMimeType: batch.sourceMimeType,
        sourceSizeBytes: batch.sourceSizeBytes,
        sourceChecksumSha256: batch.sourceChecksumSha256,
        previewJson: batch.previewJson,
        metadataJson: { ...(batch.metadataJson as Record<string, unknown>), clonedFromProgramId: sourceProgram.id },
        warningsJson: batch.warningsJson,
        preApplySnapshotJson: batch.preApplySnapshotJson,
        applyResultJson: batch.applyResultJson,
        targetWorksiteId: batch.targetWorksiteId,
        acceptedMissingEvidence: batch.acceptedMissingEvidence,
        acceptanceReason: batch.acceptanceReason,
        requestedByUserId: input.userId,
        appliedByUserId: input.userId,
        createdAt: now,
        updatedAt: now,
        appliedAt: now,
      }
    })).onConflictDoNothing()
  }
  if (sourceHistory.length > 0) {
    await tx.insert(pdtpDocumentHistory).values(sourceHistory.map((entry) => ({
      id: `pdtp-history-${nanoid()}`,
      programId,
      entryKind: entry.entryKind,
      stableKey: entry.stableKey,
      sequence: entry.sequence,
      declaredActorName: entry.declaredActorName,
      declaredActorTitle: entry.declaredActorTitle,
      declaredAtText: entry.declaredAtText,
      description: entry.description,
      linkedUserId: entry.linkedUserId,
      reconciledByUserId: entry.reconciledByUserId,
      reconciledAt: entry.reconciledAt,
      reconciliationReason: entry.reconciliationReason,
      sourceImportBatchId: entry.sourceImportBatchId ? (batchIdMap.get(entry.sourceImportBatchId) ?? null) : null,
      sourceMetadataJson: entry.sourceMetadataJson,
      createdAt: now,
      updatedAt: now,
    })))
  }
  if (sourceRoleLegend.length > 0) {
    const copiedLegend = sourceRoleLegend.map((entry) => {
      const sourceImportBatchId = batchIdMap.get(entry.sourceImportBatchId)
      if (!sourceImportBatchId) throw new Error("No se pudo conservar el origen documental de la leyenda de roles.")
      return {
        id: `pdtp-role-legend-${nanoid()}`,
        programId,
        code: entry.code,
        label: entry.label,
        sourceImportBatchId,
        createdAt: now,
      }
    })
    await tx.insert(pdtpRoleLegendEntries).values(copiedLegend)
  }

  // El alcance por faena también es parte del programa. Las ejecuciones no
  // se tocan: siguen referidas exclusivamente a las actividades del origen.
  const sourceWorksites = await tx.select({
    membership: pdtpProgramWorksites,
    worksiteIsActive: worksites.isActive,
  }).from(pdtpProgramWorksites)
    .innerJoin(worksites, eq(worksites.id, pdtpProgramWorksites.worksiteId))
    .where(eq(pdtpProgramWorksites.programId, sourceProgram.id))
  const worksitesToCopy = nextYear
    ? sourceWorksites.filter((row) => {
        const keep = row.membership.isActive && row.worksiteIsActive
        if (!keep && row.membership.isActive) report.skippedInactiveWorksiteIds.push(row.membership.worksiteId)
        return keep
      })
    : sourceWorksites
  if (worksitesToCopy.length > 0) {
    await tx.insert(pdtpProgramWorksites).values(worksitesToCopy.map(({ membership }) => ({
      id: `pdtp-program-worksite-${nanoid()}`,
      programId,
      worksiteId: membership.worksiteId,
      isActive: membership.isActive,
      addedByUserId: membership.addedByUserId,
      /* La fecha de incorporación es de la faena, no de esta copia:
       * responde "desde cuándo esta faena está dentro del programa", y
       * versionar el programa no la cambia. Escribir `now` acá hacía que
       * cada versión nueva dijera que todas las faenas entraron ese día,
       * y como el corte de exigibilidad se calcula desde este dato,
       * versionar en noviembre habría borrado el año entero del
       * denominador de cumplimiento de todas las faenas. */
      addedAt: membership.addedAt,
    }))).onConflictDoNothing()
  }

  // Copia la definición de los pasos, nunca decisiones ni firmas.
  await copyPdtpApprovalSteps(sourceProgram.id, programId, tx)

  const sourceSheetCandidates = await tx.select().from(pdtpSheets)
    .where(or(isNull(pdtpSheets.programId), eq(pdtpSheets.programId, sourceProgram.id)))
  const sourceSheetByCode = new Map<string, typeof pdtpSheets.$inferSelect>()
  for (const sheet of sourceSheetCandidates) {
    const current = sourceSheetByCode.get(sheet.code)
    if (!current || sheet.programId === sourceProgram.id) sourceSheetByCode.set(sheet.code, sheet)
  }
  const sourceSheets = [...sourceSheetByCode.values()]
  if (sourceSheets.length > 0) {
    await tx.insert(pdtpSheets).values(sourceSheets.map((sheet) => ({
      id: `${programId}-${sheet.code}`,
      code: sheet.code,
      programId,
      label: sheet.label,
      area: sheet.area,
      defaultScopeRoles: sheet.defaultScopeRoles,
      isActive: sheet.isActive,
    }))).onConflictDoNothing()
  }

  // Los objetivos (RE-36) se clonan antes que las actividades: la FK
  // compuesta `pdtp_activities_objective_same_program_fk` exige que el
  // `objectiveId` de una actividad apunte a un objetivo del MISMO
  // programa, así que copiar el id del objetivo origen tal cual violaría
  // esa restricción. Se remapea por posición (mismo código, id nuevo).
  const sourceObjectives = await tx.select().from(pdtpObjectives)
    .where(eq(pdtpObjectives.programId, sourceProgram.id))
    .orderBy(pdtpObjectives.displayOrder, pdtpObjectives.code)
  const objectiveIdMap = new Map<string, string>()
  if (sourceObjectives.length > 0) {
    const copiedObjectives = sourceObjectives.map((objective) => {
      const newObjectiveId = `pdtp-objective-${nanoid()}`
      objectiveIdMap.set(objective.id, newObjectiveId)
      return {
        id: newObjectiveId,
        programId,
        code: objective.code,
        name: objective.name,
        displayOrder: objective.displayOrder,
        createdAt: now,
        updatedAt: now,
      }
    })
    await tx.insert(pdtpObjectives).values(copiedObjectives)
  }

  // Estructura completa: actividades + planificación + a qué hoja pertenece
  // cada una. La planificación se reancla al año del programa nuevo (`year`).
  const allSourceActivities = await tx.select().from(pdtpActivities)
    .where(eq(pdtpActivities.programId, sourceProgram.id))
    .orderBy(pdtpActivities.n)
  const sourceActivities = nextYear
    ? allSourceActivities.filter((activity) => {
        if (activity.status === "retired") report.skippedRetiredActivityNumbers.push(activity.n)
        return activity.status !== "retired"
      })
    : allSourceActivities
  const activityIdMap = new Map<string, string>()
  const activityNMap = new Map<string, number>()
  const copiedActivities: Array<typeof pdtpActivities.$inferInsert> = []
  const sourcePeriod = {
    startDate: sourceProgram.periodStart ?? `${sourceProgram.year}-01-01`,
    endDate: sourceProgram.periodEnd ?? `${sourceProgram.year}-12-31`,
  }

  for (const activity of sourceActivities) {
    const newActivityId = pdtpActivityId(programId, activity.n)
    activityIdMap.set(activity.id, newActivityId)
    activityNMap.set(activity.id, activity.n)
    let scheduleDefinition: PdtpScheduleDefinition | null
    if (nextYear) {
      const remapped = remapPdtpScheduleDefinitionToYear(activity.scheduleDefinition as PdtpScheduleDefinition | null, { sourcePeriod, targetYear: year })
      scheduleDefinition = remapped.definition
      if (remapped.notes.length > 0) report.scheduleNotes.push({ n: activity.n, notes: remapped.notes })
    } else {
      // C05-A: la programación fechada sólo vale en el mismo año; otro año
      // exige re-anclarla, que es trabajo del modo `next_year`.
      scheduleDefinition = sourceProgram.year === year ? activity.scheduleDefinition as PdtpScheduleDefinition | null : null
    }
    copiedActivities.push({
      id: newActivityId, programId, n: activity.n, displayOrder: activity.displayOrder,
      catalogActivityId: activity.catalogActivityId, catalogRevision: activity.catalogRevision,
      objectiveId: activity.objectiveId ? (objectiveIdMap.get(activity.objectiveId) ?? null) : null,
      status: activity.status, retiredReason: activity.retiredReason,
      retiredEffectiveFrom: activity.retiredEffectiveFrom,
      retiredByUserId: activity.retiredByUserId, retiredAt: activity.retiredAt,
      activity: activity.activity, program: activity.program,
      responsibleSlugs: activity.responsibleSlugs, responsibleDisplay: activity.responsibleDisplay,
      audienceRoles: activity.audienceRoles, scheduleMode: activity.scheduleMode,
      scheduleClassificationStatus: activity.scheduleClassificationStatus,
      recurrenceRule: activity.recurrenceRule, triggerType: activity.triggerType,
      triggerDescription: activity.triggerDescription, dueDays: activity.dueDays, dueHours: activity.dueHours,
      evidenceRequirement: activity.evidenceRequirement, mechanism: activity.mechanism, indicatorMode: activity.indicatorMode,
      // C05-A: la política de evidencia es contenido firmado (las 19
      // excepciones de PREV-B02).
      manualEvidencePolicy: activity.manualEvidencePolicy,
      scheduleDefinition,
      subjectSource: activity.subjectSource, subjectCapabilityCodes: activity.subjectCapabilityCodes,
      targetValue: activity.targetValue, targetUnit: activity.targetUnit,
      minAnnualExecutions: activity.minAnnualExecutions,
      sourceSheetRow: activity.sourceSheetRow, notes: activity.notes, createdAt: now, updatedAt: now,
    })
  }
  if (copiedActivities.length > 0) await tx.insert(pdtpActivities).values(copiedActivities)
  report.copiedActivities = copiedActivities.length

  if (activityIdMap.size === 0) return report

  const sourceActivityIds = [...activityIdMap.keys()]
  const [scheduleRows, membershipRows, sourceLinks, checklistRows, overrideRows, exclusionRows, paramRows, executorRows, documentRequirementRows, executionConfigRows, reminderRuleRows] = await Promise.all([
    tx.select().from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, sourceActivityIds)),
    tx.select().from(pdtpSheetActivities).where(inArray(pdtpSheetActivities.activityId, sourceActivityIds)),
    tx.select().from(preventionPdtpSourceLinks).where(inArray(preventionPdtpSourceLinks.activityId, sourceActivityIds)),
    tx.select().from(pdtpActivityChecklists).where(inArray(pdtpActivityChecklists.activityId, sourceActivityIds)),
    tx.select().from(pdtpActivityScheduleOverrides).where(inArray(pdtpActivityScheduleOverrides.activityId, sourceActivityIds)),
    tx.select().from(pdtpActivityWorksiteExclusions).where(inArray(pdtpActivityWorksiteExclusions.activityId, sourceActivityIds)),
    tx.select().from(pdtpActivityWorksiteParams).where(inArray(pdtpActivityWorksiteParams.activityId, sourceActivityIds)),
    tx.select().from(pdtpActivityExecutorAssignments).where(inArray(pdtpActivityExecutorAssignments.activityId, sourceActivityIds)),
    tx.select().from(pdtpActivityDocumentRequirements).where(inArray(pdtpActivityDocumentRequirements.activityId, sourceActivityIds)),
    tx.select().from(pdtpActivityExecutionConfigs).where(inArray(pdtpActivityExecutionConfigs.activityId, sourceActivityIds)),
    tx.select().from(pdtpActivityReminderRules).where(inArray(pdtpActivityReminderRules.activityId, sourceActivityIds)),
  ])
  const copiedSchedule: Array<typeof pdtpActivitySchedule.$inferInsert> = []
  for (const cell of scheduleRows) {
    const newActivityId = activityIdMap.get(cell.activityId)!
    copiedSchedule.push({
      id: pdtpScheduleId(newActivityId, year, cell.month, cell.week), activityId: newActivityId,
      year, month: cell.month, week: cell.week, plannedQuantity: cell.plannedQuantity, sourceColumn: cell.sourceColumn,
    })
  }
  if (copiedSchedule.length > 0) await tx.insert(pdtpActivitySchedule).values(copiedSchedule).onConflictDoNothing()

  const copiedMemberships: Array<typeof pdtpSheetActivities.$inferInsert> = []
  for (const membership of membershipRows) {
    const newActivityId = activityIdMap.get(membership.activityId)!
    const activityN = activityNMap.get(membership.activityId)!
    const newSheetId = `${programId}-${membership.sheetCode}`
    copiedMemberships.push({
      id: pdtpSheetActivityId(programId, membership.sheetCode, activityN),
      sheetId: newSheetId, sheetCode: membership.sheetCode, activityId: newActivityId,
      sheetRow: membership.sheetRow, displayOrder: membership.displayOrder,
    })
  }
  if (copiedMemberships.length > 0) await tx.insert(pdtpSheetActivities).values(copiedMemberships).onConflictDoNothing()

  if (sourceLinks.length > 0) {
    await tx.insert(preventionPdtpSourceLinks).values(sourceLinks.map((link) => ({
      id: `pdtpsource-${nanoid()}`,
      activityId: activityIdMap.get(link.activityId)!,
      worksiteId: link.worksiteId,
      sourceType: link.sourceType,
      sourceId: link.sourceId,
      sourceVersionSnapshot: link.sourceVersionSnapshot,
      justification: `Copiado desde ${sourceProgram.id}: ${link.justification}`,
      isActive: link.isActive,
      createdByUserId: input.userId,
      retiredByUserId: link.isActive ? null : link.retiredByUserId,
      retiredAt: link.isActive ? null : link.retiredAt,
      retirementReason: link.isActive ? null : link.retirementReason,
      createdAt: now,
    }))).onConflictDoNothing()
  }

  if (checklistRows.length > 0) {
    await tx.insert(pdtpActivityChecklists).values(checklistRows.map((checklist) => {
      const newActivityId = activityIdMap.get(checklist.activityId)!
      return {
        id: pdtpActivityChecklistId(newActivityId, checklist.version),
        activityId: newActivityId,
        programId,
        version: checklist.version,
        label: checklist.label,
        definitionJson: checklist.definitionJson,
        isActive: checklist.isActive,
        createdAt: now,
        updatedAt: now,
      }
    })).onConflictDoNothing()
  }

  // Los overrides por faena son ajustes puntuales del año: la revisión v+1 los
  // conserva (mismo año) y la copia anual no.
  if (nextYear) {
    report.droppedScheduleOverrides = overrideRows.length
  } else if (overrideRows.length > 0) {
    await tx.insert(pdtpActivityScheduleOverrides).values(overrideRows.map((override) => ({
      id: `pdtp-override-${nanoid()}`,
      activityId: activityIdMap.get(override.activityId)!,
      worksiteId: override.worksiteId,
      year,
      month: override.month,
      week: override.week,
      plannedQuantity: override.plannedQuantity,
      updatedByUserId: override.updatedByUserId,
      createdAt: now,
      updatedAt: now,
    }))).onConflictDoNothing()
  }

  if (exclusionRows.length > 0) {
    await tx.insert(pdtpActivityWorksiteExclusions).values(exclusionRows.map((exclusion) => ({
      id: `pdtp-exclusion-${nanoid()}`,
      activityId: activityIdMap.get(exclusion.activityId)!,
      worksiteId: exclusion.worksiteId,
      reason: exclusion.reason,
      createdByUserId: exclusion.createdByUserId,
      createdAt: now,
    }))).onConflictDoNothing()
  }

  // El padrón (`expectedSubjectCount`) es cuántos sujetos hay hoy, no un
  // compromiso (ver content-digest): la copia anual lo deja en blanco y sólo
  // conserva lo firmado de la fila (meta de cobertura y responsables).
  const paramsToCopy = nextYear
    ? paramRows.flatMap((param) => {
        if (param.expectedSubjectCount !== null) report.droppedSubjectCounts++
        const hasSignedContent = param.targetCoveragePercent !== null || param.responsibleSlugs !== null
          || param.responsibleDisplay !== null || param.responsibleReason !== null
        return hasSignedContent ? [{ ...param, expectedSubjectCount: null }] : []
      })
    : paramRows
  if (paramsToCopy.length > 0) {
    await tx.insert(pdtpActivityWorksiteParams).values(paramsToCopy.map((param) => ({
      id: `pdtp-worksite-param-${nanoid()}`,
      activityId: activityIdMap.get(param.activityId)!,
      worksiteId: param.worksiteId,
      expectedSubjectCount: param.expectedSubjectCount,
      targetCoveragePercent: param.targetCoveragePercent,
      responsibleSlugs: param.responsibleSlugs,
      responsibleDisplay: param.responsibleDisplay,
      responsibleReason: param.responsibleReason,
      updatedByUserId: param.updatedByUserId,
      createdAt: now,
      updatedAt: now,
    }))).onConflictDoNothing()
  }

  if (executorRows.length > 0) {
    await tx.insert(pdtpActivityExecutorAssignments).values(executorRows.map((assignment) => ({
      id: `pdtp-executor-${nanoid()}`,
      activityId: activityIdMap.get(assignment.activityId)!,
      roleId: assignment.roleId,
      createdAt: now,
      updatedAt: now,
    }))).onConflictDoNothing()
  }

  // C05-A: destino, política de cumplimiento y evidencia aceptada, y los
  // recordatorios configurados. El id sigue la convención de
  // `updatePdtpActivity` (una configuración por actividad).
  if (executionConfigRows.length > 0) {
    await tx.insert(pdtpActivityExecutionConfigs).values(executionConfigRows.map((config) => {
      const newActivityId = activityIdMap.get(config.activityId)!
      return {
        id: `pdtp-exec-config-${newActivityId}`,
        activityId: newActivityId,
        destinationConnectorKey: config.destinationConnectorKey,
        accreditationBindingId: config.accreditationBindingId,
        completionPolicy: config.completionPolicy,
        evidenceRequired: config.evidenceRequired,
        acceptedEvidenceKinds: config.acceptedEvidenceKinds,
        createdAt: now,
        updatedAt: now,
      }
    })).onConflictDoNothing()
  }

  if (reminderRuleRows.length > 0) {
    await tx.insert(pdtpActivityReminderRules).values(reminderRuleRows.map((rule) => ({
      id: `pdtp-reminder-rule-${nanoid()}`,
      activityId: activityIdMap.get(rule.activityId)!,
      offsetValue: rule.offsetValue,
      offsetUnit: rule.offsetUnit,
      recipientKind: rule.recipientKind,
      recipientUserId: rule.recipientUserId,
      isActive: rule.isActive,
      createdAt: now,
      updatedAt: now,
    }))).onConflictDoNothing()
  }

  // La carpeta que exige la actividad (N°19) es contenido firmado: la
  // versión nueva la hereda igual que ejecutores y exclusiones.
  if (documentRequirementRows.length > 0) {
    await tx.insert(pdtpActivityDocumentRequirements).values(documentRequirementRows.map((requirement) => ({
      id: `pdtp-docreq-${nanoid()}`,
      activityId: activityIdMap.get(requirement.activityId)!,
      documentTypeId: requirement.documentTypeId,
      scope: requirement.scope,
      mustFollowDocumentTypeId: requirement.mustFollowDocumentTypeId,
      displayOrder: requirement.displayOrder,
      createdAt: now,
      updatedAt: now,
    }))).onConflictDoNothing()
  }

  return report
}
