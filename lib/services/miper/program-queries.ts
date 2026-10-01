import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskMatrices, preventionRiskMatrixVersions, preventionRiskOccurrenceEvidence,
  preventionRiskProgramActionControls, preventionRiskProgramActions, preventionRiskProgramOccurrenceRecords,
  preventionRiskProgramOccurrences, preventionRiskPrograms, preventionRiskProcesses, worksites,
} from "@/db/schema"
import type { RiskClassification } from "@/lib/prevention/miper/methodology"
import { programProgress, type OccurrenceOutcome, type ProgramProgress } from "@/lib/prevention/miper/progress"
import type { ProgramScheduleKind } from "@/lib/prevention/miper/schedule"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { todayInChile } from "@/lib/utils"
import { requireAccess, scopeAllows, userNames, type MiperAccess } from "./shared"

const VIEW = "prevention:risk:view"

/**
 * Encabezado RE-04.1 (§7.1). Los campos de empresa viven en la fila del
 * programa; acá se agregan los dos que **no** se guardan porque se calculan:
 * el N° de centros de trabajo y la fecha de la última revisión sellada.
 */
export type ProgramHeaderView = typeof preventionRiskPrograms.$inferSelect & {
  /**
   * «N° de centros de trabajo» (calculado, §7.1): las faenas activas de la
   * empresa. No se guarda en el programa porque deja de ser cierto en cuanto se
   * abre o cierra una faena.
   */
  worksiteCount: number
  /** «Fecha última revisión» = `approved_at` de la última versión sellada de esta MIPER. */
  lastReviewedOn: string | null
  /** Nombre del encargado del programa (columna «Encargado»), para la cabecera. */
  programManagerName: string | null
}

/** Una ocurrencia con su resultado **vigente** (el del último registro no anulado). */
export type ProgramOccurrenceView = {
  id: string
  dueOn: string
  outcome: OccurrenceOutcome
  late: boolean
  effectiveOn: string | null
  reason: string | null
  /** Evidencias no retiradas del registro vigente. */
  evidenceCount: number
}

/** Una actividad del programa con sus medidas vinculadas, ocurrencias y avance derivado. */
export type ProgramActionView = {
  id: string
  actionNumber: number
  processName: string | null
  description: string
  responsibleUserId: string | null
  responsibleName: string | null
  locationLabel: string | null
  scheduleKind: ProgramScheduleKind
  startsOn: string
  status: "active" | "retired"
  retiredReason: string | null
  /** Versión para la concurrencia optimista de la edición/retiro. */
  version: number
  controls: Array<{ id: string; rowNumber: number; description: string }>
  occurrences: ProgramOccurrenceView[]
  progress: ProgramProgress
}

/**
 * Propuestas de generación (Task 4). La consulta todavía no las calcula —eso
 * vive en `proposeProgramActions` de `program.ts`—, pero el contrato del panel
 * las expone desde ya para no romperlo cuando la tarea de generación las llene.
 */
export type ProgramProposalView = {
  measures: Array<{
    controlId: string; entryId: string; rowNumber: number; description: string
    classification: RiskClassification | null; suggestedGroupKey: string | null; linkedActionId: string | null
  }>
  groups: Array<{ key: string; description: string; measures: string[] }>
}

/** Todo lo que el panel «Programa» necesita en una sola lectura (Task 8). */
export type ProgramWorkspace = {
  program: ProgramHeaderView | null
  actions: ProgramActionView[]
  proposals: ProgramProposalView | null
  progress: ProgramProgress
}

/**
 * Encabezado del programa de una MIPER, con los dos campos derivados. Devuelve
 * `null` si el MIPER todavía no tiene programa. Lo comparte `getMiperWorkspace`
 * para que el armazón del espacio de trabajo sepa si la pestaña tiene contenido.
 */
export async function getProgramHeader(matrixId: string): Promise<ProgramHeaderView | null> {
  const [program] = await db.select().from(preventionRiskPrograms).where(eq(preventionRiskPrograms.matrixId, matrixId)).limit(1)
  if (!program) return null
  const [worksiteCounts, lastVersion, managerNames] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(worksites).where(eq(worksites.isActive, true)),
    db.select({ approvedAt: preventionRiskMatrixVersions.approvedAt }).from(preventionRiskMatrixVersions)
      .where(eq(preventionRiskMatrixVersions.matrixId, matrixId)).orderBy(desc(preventionRiskMatrixVersions.versionNumber)).limit(1),
    userNames(db, [program.programManagerUserId]),
  ])
  return {
    ...program,
    worksiteCount: worksiteCounts[0]?.count ?? 0,
    lastReviewedOn: lastVersion[0]?.approvedAt ?? null,
    programManagerName: program.programManagerUserId ? managerNames.get(program.programManagerUserId) ?? null : null,
  }
}

/**
 * Una sola lectura para el panel del Programa de Trabajo RE-04.1 (§7): el
 * encabezado, las actividades con sus medidas y ocurrencias, y el avance
 * **derivado** con `programProgress` (nunca una columna de avance). Fuera de
 * alcance lanza el mismo error de dominio que el resto de consultas MIPER.
 */
export async function getProgramWorkspace(matrixId: string, access: MiperAccess): Promise<ProgramWorkspace> {
  requireAccess(access, VIEW)
  const [matrix] = await db.select({ worksiteId: preventionRiskMatrices.worksiteId }).from(preventionRiskMatrices)
    .where(eq(preventionRiskMatrices.id, matrixId)).limit(1)
  if (!matrix || !scopeAllows(access.scope, matrix.worksiteId)) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")

  const today = todayInChile()
  const program = await getProgramHeader(matrixId)
  if (!program) return { program: null, actions: [], proposals: null, progress: programProgress([], today) }

  const actionRows = await db.select({ action: preventionRiskProgramActions, processName: preventionRiskProcesses.name })
    .from(preventionRiskProgramActions)
    .leftJoin(preventionRiskProcesses, eq(preventionRiskProcesses.id, preventionRiskProgramActions.processId))
    .where(eq(preventionRiskProgramActions.programId, program.id))
    .orderBy(asc(preventionRiskProgramActions.actionNumber))
  const actionIds = actionRows.map((row) => row.action.id)

  const [controlRows, occurrenceRows, responsibleNames] = await Promise.all([
    actionIds.length === 0 ? Promise.resolve([] as Array<{ actionId: string; controlId: string; rowNumber: number | null; description: string }>)
      : db.select({
        actionId: preventionRiskProgramActionControls.actionId,
        controlId: preventionRiskControls.id,
        rowNumber: preventionRiskEntries.rowNumber,
        description: preventionRiskControls.description,
      }).from(preventionRiskProgramActionControls)
        .innerJoin(preventionRiskControls, eq(preventionRiskControls.id, preventionRiskProgramActionControls.controlId))
        .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
        .where(inArray(preventionRiskProgramActionControls.actionId, actionIds))
        .orderBy(asc(preventionRiskEntries.rowNumber)),
    actionIds.length === 0
      ? Promise.resolve([] as Array<{ occurrence: typeof preventionRiskProgramOccurrences.$inferSelect; recordId: string | null; recordOutcome: string | null; effectiveOn: string | null; late: boolean | null; reason: string | null }>)
      : db.select({
        occurrence: preventionRiskProgramOccurrences,
        recordId: preventionRiskProgramOccurrenceRecords.id,
        recordOutcome: preventionRiskProgramOccurrenceRecords.outcome,
        effectiveOn: preventionRiskProgramOccurrenceRecords.effectiveOn,
        late: preventionRiskProgramOccurrenceRecords.late,
        reason: preventionRiskProgramOccurrenceRecords.reason,
      }).from(preventionRiskProgramOccurrences)
        .leftJoin(preventionRiskProgramOccurrenceRecords, eq(preventionRiskProgramOccurrenceRecords.id, preventionRiskProgramOccurrences.currentRecordId))
        .where(inArray(preventionRiskProgramOccurrences.actionId, actionIds))
        .orderBy(asc(preventionRiskProgramOccurrences.dueOn)),
    userNames(db, actionRows.map((row) => row.action.responsibleUserId)),
  ])

  // Evidencias no retiradas del registro vigente de cada ocurrencia.
  const occurrenceIds = occurrenceRows.map((row) => row.occurrence.id)
  const evidenceRows: Array<{ occurrenceId: string; count: number }> = occurrenceIds.length === 0 ? [] : await db.select({
    occurrenceId: preventionRiskProgramOccurrences.id,
    count: sql<number>`count(*)::int`,
  }).from(preventionRiskOccurrenceEvidence)
    .innerJoin(preventionRiskProgramOccurrences, eq(preventionRiskProgramOccurrences.currentRecordId, preventionRiskOccurrenceEvidence.recordId))
    .where(and(inArray(preventionRiskProgramOccurrences.id, occurrenceIds), isNull(preventionRiskOccurrenceEvidence.withdrawnAt)))
    .groupBy(preventionRiskProgramOccurrences.id)
  const evidenceByOccurrence = new Map(evidenceRows.map((row) => [row.occurrenceId, row.count]))

  const controlsByAction = new Map<string, Array<{ id: string; rowNumber: number; description: string }>>()
  for (const link of controlRows) {
    const list = controlsByAction.get(link.actionId) ?? []
    list.push({ id: link.controlId, rowNumber: link.rowNumber ?? 0, description: link.description })
    controlsByAction.set(link.actionId, list)
  }

  const occurrencesByAction = new Map<string, ProgramOccurrenceView[]>()
  for (const row of occurrenceRows) {
    const list = occurrencesByAction.get(row.occurrence.actionId) ?? []
    list.push({
      id: row.occurrence.id,
      dueOn: row.occurrence.dueOn,
      // El resultado vigente es el del registro actual; sin registro, el resumen
      // de la ocurrencia (`pending`, o `superseded` si el programa se reemplazó).
      outcome: (row.recordId ? row.recordOutcome : row.occurrence.outcome) as OccurrenceOutcome,
      late: row.recordId ? row.late ?? false : false,
      effectiveOn: row.recordId ? row.effectiveOn : null,
      reason: row.recordId ? row.reason : null,
      evidenceCount: evidenceByOccurrence.get(row.occurrence.id) ?? 0,
    })
    occurrencesByAction.set(row.occurrence.actionId, list)
  }

  const actions: ProgramActionView[] = actionRows.map(({ action, processName }) => {
    const occurrences = occurrencesByAction.get(action.id) ?? []
    return {
      id: action.id,
      actionNumber: action.actionNumber,
      processName: processName ?? null,
      description: action.description,
      responsibleUserId: action.responsibleUserId,
      // El nombre/cargo queda congelado (`responsible_snapshot`); el usuario
      // vivo es sólo el respaldo si el servicio no alcanzó a guardar la foto.
      responsibleName: action.responsibleSnapshot ?? (action.responsibleUserId ? responsibleNames.get(action.responsibleUserId) ?? null : null),
      locationLabel: action.locationLabel,
      scheduleKind: action.scheduleKind as ProgramScheduleKind,
      startsOn: action.startsOn,
      status: action.status as "active" | "retired",
      retiredReason: action.retiredReason,
      version: action.version,
      controls: controlsByAction.get(action.id) ?? [],
      occurrences,
      progress: programProgress(occurrences, today),
    }
  })

  return { program, actions, proposals: null, progress: programProgress(actions.flatMap((action) => action.occurrences), today) }
}
