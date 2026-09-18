import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { nanoid } from "@/lib/id"
import {
  pdtpActivities,
  pdtpActivityChecklists,
  pdtpActivityExecutorAssignments,
  pdtpActivitySchedule,
  pdtpActivityScheduleOverrides,
  pdtpActivityWorksiteExclusions,
  pdtpActivityWorksiteParams,
  pdtpDocumentHistory,
  pdtpImportBatches,
  pdtpObjectives,
  pdtpPrograms,
  pdtpProgramWorksites,
  pdtpSheetActivities,
  pdtpSheets,
  pdtpRoleLegendEntries,
  preventionPdtpSourceLinks,
  users as schemaUsers,
} from "@/db/schema"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState, isUniqueViolation, pdtpActivityId, pdtpProgramId, pdtpScheduleId, pdtpSheetActivityId } from "./helpers"
import { copyPdtpApprovalSteps, ensureDefaultPdtpApprovalSteps } from "./approval-flow"
import { pdtpActivityChecklistId } from "./checklist-domain"
import { getCurrentPdtpBase2026Version, getPdtpTemplateVersion, instantiatePdtpTemplateVersion } from "./templates"

type LegacyPdtpProgramCreateInput = {
  year: number; title: string; userId: string; copySheetsFromProgramId?: string; templateVersionId?: string; revisionFromProgramId?: string; appliesToAllWorksites?: boolean
}

export async function createAnnualPdtpProgram(input: { year: number; userId: string }) {
  if (!Number.isInteger(input.year) || input.year < 2024 || input.year > 2100) {
    throw new Error("El año del programa debe estar entre 2024 y 2100.")
  }

  const create = async () => db.transaction(async (tx) => {
    const [existing] = await tx.select().from(pdtpPrograms)
      .where(eq(pdtpPrograms.year, input.year))
      .orderBy(desc(pdtpPrograms.version))
      .limit(1)
    if (existing) return { programId: existing.id, program: existing, created: false, baseVersionId: existing.sourceTemplateVersionId }

    const base = await getCurrentPdtpBase2026Version(tx)
    if (!base) {
      throw new Error("La Base preventiva 2026 aún no está publicada. Instálala antes de crear programas anuales.")
    }

    const [elaborator] = await tx.select({ name: schemaUsers.name }).from(schemaUsers)
      .where(eq(schemaUsers.id, input.userId))
      .limit(1)
    const now = new Date().toISOString()
    const programId = pdtpProgramId(input.year, 1)
    const [program] = await tx.insert(pdtpPrograms).values({
      id: programId,
      year: input.year,
      version: 1,
      status: "draft",
      title: `Programa de Trabajo Preventivo SG-SST ${input.year}`,
      periodStart: `${input.year}-01-01`,
      periodEnd: `${input.year}-12-31`,
      creationMode: "base_2026",
      sourceProgramId: base.version.sourceProgramId,
      sourceContentVersion: base.version.sourceContentVersion,
      sourceTemplateVersionId: base.version.id,
      sourceMetadataJson: {
        baseCode: base.template.code,
        baseRevision: base.version.version,
        baseContentDigest: base.version.contentDigest,
      },
      elaboratedByUserId: input.userId,
      elaboratedByName: elaborator?.name?.trim() || "Equipo de Prevención",
      elaboratedByTitle: elaborator?.name?.trim() ? "Prevencionista" : "Sistema",
      createdAt: now,
      updatedAt: now,
    }).returning()
    if (!program) throw new Error("No se pudo crear el programa anual.")

    await instantiatePdtpTemplateVersion({
      templateVersionId: base.version.id,
      targetProgramId: program.id,
      targetYear: input.year,
      client: tx,
    })
    await ensureDefaultPdtpApprovalSteps(program.id, tx)
    await addPdtpChangeLogEntry(
      program.id,
      1,
      input.userId,
      "lifecycle",
      null,
      { status: "draft", baseTemplateVersionId: base.version.id },
      `Programa anual creado desde Base preventiva 2026, revisión ${base.version.version}.`,
      tx,
    )
    return { programId: program.id, program, created: true, baseVersionId: base.version.id }
  })

  try {
    return await create()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const [existing] = await db.select().from(pdtpPrograms)
      .where(eq(pdtpPrograms.year, input.year))
      .orderBy(desc(pdtpPrograms.version))
      .limit(1)
    if (!existing) throw error
    return { programId: existing.id, program: existing, created: false, baseVersionId: existing.sourceTemplateVersionId }
  }
}

/**
 * Constructor legado conservado exclusivamente para fixtures de regresión.
 * No se exporta por la interfaz productiva: la creación real siempre usa
 * `createAnnualPdtpProgram`.
 */
export async function createLegacyPdtpProgramForTests(input: LegacyPdtpProgramCreateInput) {
  const now = new Date().toISOString()
  const MAX_ATTEMPTS = 8
  // Este constructor sólo existe para conservar fixtures históricos. Antes de
  // PDTP-003 una instancia sin filas de membresía significaba alcance global;
  // los tests que lo usan deben seguir declarando ese contrato por defecto.
  const legacyInput = { ...input, appliesToAllWorksites: input.appliesToAllWorksites ?? true }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await createPdtpProgramAttempt(legacyInput, now)
    } catch (e) {
      // Violación de unique(year, version): otra creación concurrente para
      // el mismo año ganó la carrera del número de versión (el SELECT
      // MAX(version)+1 no es atómico entre transacciones). Reintentar
      // recalcula la versión contra lo que la otra transacción ya
      // committeó, en vez de rendirse a la primera colisión. El jitter
      // evita que varios competidores reintenten en el mismo instante y
      // vuelvan a pisarse entre sí (thundering herd).
      if (isUniqueViolation(e) && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * (20 + Math.floor(Math.random() * 60))))
        continue
      }
      if (isUniqueViolation(e)) {
        throw new Error(`Ya se creó otra versión del programa ${input.year} al mismo tiempo. Intenta de nuevo.`)
      }
      throw e
    }
  }
  throw new Error("No se pudo crear el programa PDTP tras varios intentos concurrentes.")
}

/**
 * Abre una revisión v+1 sin tocar el programa activo de origen.
 *
 * El bloqueo de la fila fuente y la búsqueda del borrador abierto ocurren en
 * la misma transacción que crea el clon. Eso hace que dos clics concurrentes
 * devuelvan el mismo borrador en vez de generar dos revisiones para el año.
 */
export async function createPdtpRevision(input: { sourceProgramId: string; userId: string }) {
  const MAX_ATTEMPTS = 8
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const program = await createPdtpProgramAttempt({
        year: 0,
        title: "",
        userId: input.userId,
        revisionFromProgramId: input.sourceProgramId,
      }, new Date().toISOString())
      return { programId: program.id, program }
    } catch (error) {
      if (isUniqueViolation(error) && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * (20 + Math.floor(Math.random() * 60))))
        continue
      }
      if (isUniqueViolation(error)) {
        throw new Error("No se pudo reservar una versión nueva del programa. Intenta nuevamente.")
      }
      throw error
    }
  }
  throw new Error("No se pudo crear la revisión PDTP tras varios intentos concurrentes.")
}

async function createPdtpProgramAttempt(input: LegacyPdtpProgramCreateInput, now: string) {
  return db.transaction(async (tx) => {
      if (input.copySheetsFromProgramId && input.templateVersionId) {
        throw new Error("Selecciona un solo origen: plantilla o programa anterior.")
      }
      if (input.revisionFromProgramId && (input.copySheetsFromProgramId || input.templateVersionId)) {
        throw new Error("Una revisión sólo puede partir de un programa activo.")
      }
      if (input.revisionFromProgramId) {
        await tx.execute(sql`SELECT id FROM ${pdtpPrograms} WHERE id = ${input.revisionFromProgramId} FOR UPDATE`)
      }
      const sourceProgramId = input.revisionFromProgramId ?? input.copySheetsFromProgramId
      const sourceProgram = sourceProgramId
        ? (await tx.select().from(pdtpPrograms)
            .where(eq(pdtpPrograms.id, sourceProgramId))
            .limit(1))[0]
        : undefined
      if (sourceProgramId && !sourceProgram) {
        throw new Error("El programa de origen ya no existe.")
      }
      if (input.revisionFromProgramId && sourceProgram?.status !== "active") {
        throw new Error("Sólo se puede crear una revisión desde el programa activo.")
      }
      // La copia genérica conserva estructura pero se reancla al año que el
      // operador pidió. Sólo la revisión v+1 debe permanecer en el mismo año
      // que su programa activo de origen.
      const year = input.revisionFromProgramId && sourceProgram ? sourceProgram.year : input.year
      if (input.revisionFromProgramId && sourceProgram) {
        const [openRevision] = await tx.select().from(pdtpPrograms)
          .where(and(
            eq(pdtpPrograms.year, sourceProgram.year),
            eq(pdtpPrograms.sourceProgramId, sourceProgram.id),
            inArray(pdtpPrograms.status, ["draft", "in_review"]),
          ))
          .orderBy(desc(pdtpPrograms.version))
          .limit(1)
        if (openRevision) return openRevision
      }
      const existingVersion = await tx.select({ version: pdtpPrograms.version })
        .from(pdtpPrograms)
        .where(eq(pdtpPrograms.year, year))
        .orderBy(desc(pdtpPrograms.version)).limit(1)
      const version = (existingVersion[0]?.version ?? 0) + 1
      const programId = pdtpProgramId(year, version)
      const templateVersion = input.templateVersionId
        ? await getPdtpTemplateVersion(input.templateVersionId, tx)
        : null
      if (input.templateVersionId && !templateVersion) {
        throw new Error("La versión de plantilla seleccionada ya no existe.")
      }

      const [elaborator] = await tx
        .select({ name: schemaUsers.name })
        .from(schemaUsers)
        .where(eq(schemaUsers.id, input.userId))
        .limit(1)
      const elaboratedByName = elaborator?.name?.trim() || "Equipo de Prevención"
      const elaboratedByTitle = elaborator?.name?.trim() ? "Prevencionista" : "Sistema"

      const [program] = await tx.insert(pdtpPrograms).values({
        id: programId,
        year,
        version,
        status: "draft",
        title: sourceProgram?.title ?? input.title,
        periodStart: sourceProgram?.periodStart ?? `${year}-01-01`,
        periodEnd: sourceProgram?.periodEnd ?? `${year}-12-31`,
        documentCode: sourceProgram?.documentCode ?? null,
        documentRevision: sourceProgram?.documentRevision ?? null,
        validFrom: sourceProgram?.validFrom ?? null,
        validUntil: sourceProgram?.validUntil ?? null,
        indicatorName: sourceProgram?.indicatorName ?? null,
        indicatorType: sourceProgram?.indicatorType ?? null,
        indicatorFormula: sourceProgram?.indicatorFormula ?? null,
        indicatorPeriodicity: sourceProgram?.indicatorPeriodicity ?? null,
        measurementOwner: sourceProgram?.measurementOwner ?? null,
        complianceTarget: sourceProgram?.complianceTarget ?? 0.9,
        pesoEjecucion: sourceProgram?.pesoEjecucion ?? 0.5,
        pesoVerificacion: sourceProgram?.pesoVerificacion ?? 0.3,
        pesoCierre: sourceProgram?.pesoCierre ?? 0.2,
        appliesToAllWorksites: sourceProgram?.appliesToAllWorksites ?? input.appliesToAllWorksites ?? false,
        creationMode: templateVersion ? "template" : sourceProgram ? "program_copy" : "blank",
        sourceProgramId: templateVersion?.sourceProgramId ?? sourceProgram?.id ?? null,
        sourceContentVersion: templateVersion?.sourceContentVersion ?? sourceProgram?.contentVersion ?? null,
        sourceTemplateVersionId: templateVersion?.id ?? sourceProgram?.sourceTemplateVersionId ?? null,
        sourceMetadataJson: sourceProgram
          ? { ...(sourceProgram.sourceMetadataJson as Record<string, unknown>), revisionFrom: { programId: sourceProgram.id, contentVersion: sourceProgram.contentVersion } }
          : {},
        elaboratedByUserId: input.userId, elaboratedByName, elaboratedByTitle,
        createdAt: now, updatedAt: now,
      }).returning()
      if (!program) throw new Error("No se pudo crear el programa PDTP.")

      // La trazabilidad documental también pertenece a la revisión. Se clonan
      // los lotes de importación que sostienen la historia/leyenda y se
      // remapean sus FKs al nuevo programa; no se copian ejecuciones, firmas ni
      // decisiones de aprobación.
      if (sourceProgram) {
        const [sourceHistory, sourceRoleLegend] = await Promise.all([
          tx.select().from(pdtpDocumentHistory).where(eq(pdtpDocumentHistory.programId, sourceProgram.id)),
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
      }

      // El alcance por faena también es parte del programa. Las ejecuciones no
      // se tocan: siguen referidas exclusivamente a las actividades del origen.
      if (sourceProgram) {
        const sourceWorksites = await tx.select().from(pdtpProgramWorksites)
          .where(eq(pdtpProgramWorksites.programId, sourceProgram.id))
        if (sourceWorksites.length > 0) {
          await tx.insert(pdtpProgramWorksites).values(sourceWorksites.map((membership) => ({
            id: `pdtp-program-worksite-${nanoid()}`,
            programId,
            worksiteId: membership.worksiteId,
            isActive: membership.isActive,
            addedByUserId: membership.addedByUserId,
            addedAt: now,
          }))).onConflictDoNothing()
        }
      }

      if (templateVersion) {
        await instantiatePdtpTemplateVersion({
          templateVersionId: templateVersion.id,
          targetProgramId: programId,
          targetYear: year,
          client: tx,
        })
      } else if (sourceProgram) {
        // Copia la definición de los pasos, nunca decisiones ni firmas.
        await copyPdtpApprovalSteps(sourceProgram.id, programId, tx)
      } else {
        await ensureDefaultPdtpApprovalSteps(programId, tx)
      }

      if (templateVersion) {
        // La estructura completa fue materializada desde la foto inmutable.
      } else if (sourceProgram) {
        const sourceSheetCandidates = await tx.select().from(pdtpSheets)
          .where(and(
            or(isNull(pdtpSheets.programId), eq(pdtpSheets.programId, sourceProgram.id)),
          ))
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

        // "Duplicar programa" es estructura completa, no solo hojas: copia
        // actividades + planificación + a qué hoja pertenece cada una. La
        // planificación se reancla al año del programa nuevo (`year`),
        // no al del programa origen.
        const sourceActivities = await tx.select().from(pdtpActivities)
          .where(eq(pdtpActivities.programId, sourceProgram.id))
          .orderBy(pdtpActivities.n)
        const activityIdMap = new Map<string, string>()
        const activityNMap = new Map<string, number>()
        const copiedActivities: Array<typeof pdtpActivities.$inferInsert> = []

        for (const activity of sourceActivities) {
          const newActivityId = pdtpActivityId(programId, activity.n)
          activityIdMap.set(activity.id, newActivityId)
          activityNMap.set(activity.id, activity.n)
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
            subjectSource: activity.subjectSource, subjectCapabilityCodes: activity.subjectCapabilityCodes,
            targetValue: activity.targetValue, targetUnit: activity.targetUnit,
            sourceSheetRow: activity.sourceSheetRow, notes: activity.notes, createdAt: now, updatedAt: now,
          })
        }
        if (copiedActivities.length > 0) await tx.insert(pdtpActivities).values(copiedActivities)

        if (activityIdMap.size > 0) {
          const sourceActivityIds = [...activityIdMap.keys()]
          const [scheduleRows, membershipRows, sourceLinks, checklistRows, overrideRows, exclusionRows, paramRows, executorRows] = await Promise.all([
            tx.select().from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, sourceActivityIds)),
            tx.select().from(pdtpSheetActivities).where(inArray(pdtpSheetActivities.activityId, sourceActivityIds)),
            tx.select().from(preventionPdtpSourceLinks).where(inArray(preventionPdtpSourceLinks.activityId, sourceActivityIds)),
            tx.select().from(pdtpActivityChecklists).where(inArray(pdtpActivityChecklists.activityId, sourceActivityIds)),
            tx.select().from(pdtpActivityScheduleOverrides).where(inArray(pdtpActivityScheduleOverrides.activityId, sourceActivityIds)),
            tx.select().from(pdtpActivityWorksiteExclusions).where(inArray(pdtpActivityWorksiteExclusions.activityId, sourceActivityIds)),
            tx.select().from(pdtpActivityWorksiteParams).where(inArray(pdtpActivityWorksiteParams.activityId, sourceActivityIds)),
            tx.select().from(pdtpActivityExecutorAssignments).where(inArray(pdtpActivityExecutorAssignments.activityId, sourceActivityIds)),
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

          if (overrideRows.length > 0) {
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

          if (paramRows.length > 0) {
            await tx.insert(pdtpActivityWorksiteParams).values(paramRows.map((param) => ({
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
        }
      } else {
        // Vista única por defecto para un programa en blanco: no asume la
        // estructura de ocho hojas de la plantilla 2026.
        await tx.insert(pdtpSheets).values({
          id: `${programId}-pdtp_general`, code: "pdtp_general", programId,
          label: "Vista general", area: "prevencion", defaultScopeRoles: ["prevencionista", "administrador"],
        })
      }

      await addPdtpChangeLogEntry(
        programId,
        version,
        input.userId,
        "lifecycle",
        null,
        { status: "draft", revisionFromProgramId: input.revisionFromProgramId ?? null },
        input.revisionFromProgramId
          ? `Revisión v${version} creada desde ${input.revisionFromProgramId}; se copiaron estructura y configuración, no ejecuciones ni firmas.`
          : "Programa creado.",
        tx,
      )
      return program
  })
}

export async function updatePdtpProgram(programId: string, input: { title?: string; complianceTarget?: number }, userId: string) {
  // Lock + re-chequeo dentro de la transacción: sin esto, un submit-a-revisión
  // concurrente podía confirmar entre el SELECT plano y el UPDATE, mutando un
  // programa ya bloqueado (mismo patrón que el resto del módulo).
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpPrograms} WHERE id = ${programId} FOR UPDATE`)
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)

    const now = new Date().toISOString()
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    const updates: Partial<typeof pdtpPrograms.$inferInsert> = { updatedAt: now }

    if (input.title !== undefined && input.title !== program.title) {
      before.title = program.title; after.title = input.title; updates.title = input.title
    }
    if (input.complianceTarget !== undefined && input.complianceTarget !== program.complianceTarget) {
      before.complianceTarget = program.complianceTarget; after.complianceTarget = input.complianceTarget
      updates.complianceTarget = input.complianceTarget
    }

    const [updated] = await tx.update(pdtpPrograms).set(updates).where(eq(pdtpPrograms.id, programId)).returning()
    if (!updated) throw new Error("No se pudo actualizar el programa PDTP.")

    if (Object.keys(after).length > 0) {
      await addPdtpChangeLogEntry(programId, program.version, userId, "metadata", before, after, "Metadatos actualizados.", tx)
    }
    return updated
  })
}

export async function listPdtpPrograms(opts?: { status?: string; year?: number }) {
  const conditions = []
  if (opts?.status) conditions.push(eq(pdtpPrograms.status, opts.status))
  if (opts?.year) conditions.push(eq(pdtpPrograms.year, opts.year))
  return db.select().from(pdtpPrograms).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(pdtpPrograms.year), desc(pdtpPrograms.version))
}

export async function getPdtpProgram(programId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  return program ?? null
}

export async function deletePdtpProgram(programId: string) {
  // Lock + re-chequeo: borrar en carrera con un submit-a-revisión cascadearía
  // hojas/actividades/ejecuciones de un programa que ya entró a revisión.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpPrograms} WHERE id = ${programId} FOR UPDATE`)
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)

    // El delete cascadea a hojas/actividades/schedule/ejecuciones/overrides/
    // change_log (FK ON DELETE CASCADE). No escribimos un changelog "programa
    // eliminado" después: el programa ya no existe, y la fila violaría su
    // propia FK (además, el cascade ya borró el historial previo).
    await tx.delete(pdtpPrograms).where(eq(pdtpPrograms.id, programId))
  })
}
