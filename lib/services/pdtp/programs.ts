import { and, desc, eq, inArray, isNull, or } from "drizzle-orm"
import { db } from "@/db"
import { nanoid } from "@/lib/id"
import {
  pdtpActivities,
  pdtpActivityChecklists,
  pdtpActivitySchedule,
  pdtpPrograms,
  pdtpSheetActivities,
  pdtpSheets,
  preventionPdtpSourceLinks,
  users as schemaUsers,
} from "@/db/schema"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState, isUniqueViolation, pdtpActivityId, pdtpProgramId, pdtpScheduleId, pdtpSheetActivityId } from "./helpers"
import { copyPdtpApprovalSteps, ensureDefaultPdtpApprovalSteps } from "./approval-flow"
import { pdtpActivityChecklistId } from "./checklist-domain"
import { getPdtpTemplateVersion, instantiatePdtpTemplateVersion } from "./templates"

export type PdtpProgramCreateInput = {
  year: number; title: string; userId: string; copySheetsFromProgramId?: string; templateVersionId?: string
}

export async function createPdtpProgram(input: PdtpProgramCreateInput) {
  const now = new Date().toISOString()
  const MAX_ATTEMPTS = 8

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await createPdtpProgramAttempt(input, now)
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

async function createPdtpProgramAttempt(input: PdtpProgramCreateInput, now: string) {
  return db.transaction(async (tx) => {
      if (input.copySheetsFromProgramId && input.templateVersionId) {
        throw new Error("Selecciona un solo origen: plantilla o programa anterior.")
      }
      const existingVersion = await tx.select({ version: pdtpPrograms.version })
        .from(pdtpPrograms)
        .where(eq(pdtpPrograms.year, input.year))
        .orderBy(desc(pdtpPrograms.version)).limit(1)
      const version = (existingVersion[0]?.version ?? 0) + 1
      const programId = pdtpProgramId(input.year, version)

      const sourceProgram = input.copySheetsFromProgramId
        ? (await tx.select({ id: pdtpPrograms.id, contentVersion: pdtpPrograms.contentVersion })
            .from(pdtpPrograms)
            .where(eq(pdtpPrograms.id, input.copySheetsFromProgramId))
            .limit(1))[0]
        : undefined
      if (input.copySheetsFromProgramId && !sourceProgram) {
        throw new Error("El programa de origen ya no existe.")
      }
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
        id: programId, year: input.year, version, status: "draft", title: input.title,
        periodStart: `${input.year}-01-01`, periodEnd: `${input.year}-12-31`,
        creationMode: templateVersion ? "template" : sourceProgram ? "program_copy" : "blank",
        sourceProgramId: templateVersion?.sourceProgramId ?? sourceProgram?.id ?? null,
        sourceContentVersion: templateVersion?.sourceContentVersion ?? sourceProgram?.contentVersion ?? null,
        sourceTemplateVersionId: templateVersion?.id ?? null,
        elaboratedByUserId: input.userId, elaboratedByName, elaboratedByTitle,
        createdAt: now, updatedAt: now,
      }).returning()
      if (!program) throw new Error("No se pudo crear el programa PDTP.")

      if (templateVersion) {
        await instantiatePdtpTemplateVersion({
          templateVersionId: templateVersion.id,
          targetProgramId: programId,
          targetYear: input.year,
          client: tx,
        })
      } else if (input.copySheetsFromProgramId) {
        await copyPdtpApprovalSteps(input.copySheetsFromProgramId, programId, tx)
      } else {
        await ensureDefaultPdtpApprovalSteps(programId, tx)
      }

      if (templateVersion) {
        // La estructura completa fue materializada desde la foto inmutable.
      } else if (input.copySheetsFromProgramId) {
        const sourceSheetCandidates = await tx.select().from(pdtpSheets)
          .where(and(
            or(isNull(pdtpSheets.programId), eq(pdtpSheets.programId, input.copySheetsFromProgramId)),
          ))
        const sourceSheetByCode = new Map<string, typeof pdtpSheets.$inferSelect>()
        for (const sheet of sourceSheetCandidates) {
          const current = sourceSheetByCode.get(sheet.code)
          if (!current || sheet.programId === input.copySheetsFromProgramId) sourceSheetByCode.set(sheet.code, sheet)
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
          }))).onConflictDoNothing()
        }

        // "Duplicar programa" es estructura completa, no solo hojas: copia
        // actividades + planificación + a qué hoja pertenece cada una. La
        // planificación se reancla al año del programa nuevo (`input.year`),
        // no al del programa origen.
        const sourceActivities = await tx.select().from(pdtpActivities)
          .where(eq(pdtpActivities.programId, input.copySheetsFromProgramId))
          .orderBy(pdtpActivities.n)
        const activityIdMap = new Map<string, string>()
        const activityNMap = new Map<string, number>()
        const copiedActivities: Array<typeof pdtpActivities.$inferInsert> = []

        for (const activity of sourceActivities) {
          const newActivityId = pdtpActivityId(programId, activity.n)
          activityIdMap.set(activity.id, newActivityId)
          activityNMap.set(activity.id, activity.n)
          copiedActivities.push({
            id: newActivityId, programId, n: activity.n, objectiveOrder: activity.objectiveOrder,
            objective: activity.objective, activity: activity.activity, program: activity.program,
            responsibleSlugs: activity.responsibleSlugs, responsibleDisplay: activity.responsibleDisplay,
            audienceRoles: activity.audienceRoles, scheduleMode: activity.scheduleMode,
            scheduleClassificationStatus: activity.scheduleClassificationStatus,
            recurrenceRule: activity.recurrenceRule, triggerType: activity.triggerType,
            triggerDescription: activity.triggerDescription, dueDays: activity.dueDays,
            evidenceRequirement: activity.evidenceRequirement, indicatorMode: activity.indicatorMode,
            targetValue: activity.targetValue, targetUnit: activity.targetUnit,
            sourceSheetRow: activity.sourceSheetRow, notes: activity.notes, createdAt: now, updatedAt: now,
          })
        }
        if (copiedActivities.length > 0) await tx.insert(pdtpActivities).values(copiedActivities)

        if (activityIdMap.size > 0) {
          const sourceActivityIds = [...activityIdMap.keys()]
          const [scheduleRows, membershipRows, sourceLinks, checklistRows] = await Promise.all([
            tx.select().from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, sourceActivityIds)),
            tx.select().from(pdtpSheetActivities).where(inArray(pdtpSheetActivities.activityId, sourceActivityIds)),
            tx.select().from(preventionPdtpSourceLinks).where(and(inArray(preventionPdtpSourceLinks.activityId, sourceActivityIds), eq(preventionPdtpSourceLinks.isActive, true))),
            tx.select().from(pdtpActivityChecklists).where(and(inArray(pdtpActivityChecklists.activityId, sourceActivityIds), eq(pdtpActivityChecklists.isActive, true))),
          ])
          const copiedSchedule: Array<typeof pdtpActivitySchedule.$inferInsert> = []
          for (const cell of scheduleRows) {
            const newActivityId = activityIdMap.get(cell.activityId)!
            copiedSchedule.push({
              id: pdtpScheduleId(newActivityId, input.year, cell.month, cell.week), activityId: newActivityId,
              year: input.year, month: cell.month, week: cell.week, plannedQuantity: cell.plannedQuantity, sourceColumn: cell.sourceColumn,
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
              justification: `Copiado desde ${input.copySheetsFromProgramId}: ${link.justification}`,
              createdByUserId: input.userId,
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
        }
      } else {
        // Vista única por defecto para un programa en blanco: no asume la
        // estructura de ocho hojas de la plantilla 2026.
        await tx.insert(pdtpSheets).values({
          id: `${programId}-pdtp_general`, code: "pdtp_general", programId,
          label: "Vista general", area: "prevencion", defaultScopeRoles: ["prevencionista", "administrador"],
        })
      }

      await addPdtpChangeLogEntry(programId, version, input.userId, "lifecycle", null, { status: "draft" }, "Programa creado.", tx)
      return program
  })
}

export async function updatePdtpProgram(programId: string, input: { title?: string; complianceTarget?: number }, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
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

  const [updated] = await db.update(pdtpPrograms).set(updates).where(eq(pdtpPrograms.id, programId)).returning()
  if (!updated) throw new Error("No se pudo actualizar el programa PDTP.")

  if (Object.keys(after).length > 0) {
    await addPdtpChangeLogEntry(programId, program.version, userId, "metadata", before, after, "Metadatos actualizados.")
  }
  return updated
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
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)

  // El delete cascadea a hojas/actividades/schedule/ejecuciones/overrides/
  // change_log (FK ON DELETE CASCADE). No escribimos un changelog "programa
  // eliminado" después: el programa ya no existe, y la fila violaría su
  // propia FK (además, el cascade ya borró el historial previo).
  await db.delete(pdtpPrograms).where(eq(pdtpPrograms.id, programId))
}
