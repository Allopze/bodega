/**
 * Expediente auditor (Fase 6.5): ejecuciones, fuentes, evidencias,
 * obligaciones a demanda, acciones, seguimientos, aprobaciones y cambios de
 * un programa/faena, con actor/timestamp/faena/estado/digest/lote/motivo por
 * fila. No incluye URLs de evidencia crudas ni rutas internas — solo
 * identificadores que se resuelven navegando dentro de la aplicación con la
 * autorización del visitante, nunca un enlace directo al archivo.
 */
import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpChangeLog,
  pdtpExecutions,
  pdtpImportBatches,
  pdtpPrograms,
  preventionPdtpSourceLinks,
  worksites,
} from "@/db/schema"
import { assertWorksiteAccess, type WorksiteScope } from "./helpers"
import { getPdtpApprovalProgress } from "./approval-flow"
import { listActionsByProgram } from "./action-plan"
import { listFollowups } from "./followups"
import { listPdtpObligations } from "./obligations"

export type PdtpAuditDossierExecutionRow = {
  executionId: string
  activityN: number
  activityName: string
  worksiteId: string
  year: number
  month: number
  week: number
  executedQuantity: number
  status: string
  hasEvidence: boolean
  executedByUserId: string | null
  executedAt: string | null
}

export type PdtpAuditDossierSourceLinkRow = {
  id: string
  activityN: number
  sourceType: string
  sourceId: string
  isActive: boolean
  justification: string
  createdByUserId: string
  createdAt: string
  retiredByUserId: string | null
  retiredAt: string | null
  retirementReason: string | null
}

export type PdtpAuditDossierChangeRow = {
  id: string
  version: number
  changedByUserId: string | null
  changedAt: string
  section: string
  note: string | null
}

export type PdtpAuditDossierImportBatchRow = {
  id: string
  status: string
  adapterCode: string
  sourceFileName: string
  sourceChecksumSha256: string
  requestedByUserId: string
  appliedByUserId: string | null
  createdAt: string
  appliedAt: string | null
  cancellationReason: string | null
}

export type PdtpAuditDossier = {
  programId: string
  programTitle: string
  worksiteId: string
  /** Nombre de la faena. El expediente lo imprimía como id crudo (regla A6). */
  worksiteName: string
  contentVersion: number
  contentDigest: string | null
  status: string
  executions: PdtpAuditDossierExecutionRow[]
  sourceLinks: PdtpAuditDossierSourceLinkRow[]
  obligations: Awaited<ReturnType<typeof listPdtpObligations>>
  actions: Awaited<ReturnType<typeof listActionsByProgram>>
  followupsByActionId: Record<string, Awaited<ReturnType<typeof listFollowups>>>
  approvalSteps: Awaited<ReturnType<typeof getPdtpApprovalProgress>>
  changes: PdtpAuditDossierChangeRow[]
  importBatches: PdtpAuditDossierImportBatchRow[]
}

export async function getPdtpAuditDossier(input: {
  programId: string
  worksiteId: string
  scope: WorksiteScope
}): Promise<PdtpAuditDossier | null> {
  assertWorksiteAccess(input.worksiteId, input.scope)

  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) return null

  const executionRows = await db.select({
    execution: pdtpExecutions,
    activityN: pdtpActivities.n,
    activityName: pdtpActivities.activity,
  }).from(pdtpExecutions)
    .innerJoin(pdtpActivities, eq(pdtpExecutions.activityId, pdtpActivities.id))
    .where(eq(pdtpActivities.programId, program.id))
    .orderBy(desc(pdtpExecutions.updatedAt))
  const executions: PdtpAuditDossierExecutionRow[] = executionRows
    .filter((row) => row.execution.worksiteId === input.worksiteId)
    .map((row) => ({
      executionId: row.execution.id,
      activityN: row.activityN,
      activityName: row.activityName,
      worksiteId: row.execution.worksiteId,
      year: row.execution.year,
      month: row.execution.month,
      week: row.execution.week,
      executedQuantity: row.execution.executedQuantity,
      status: row.execution.status,
      hasEvidence: Boolean(row.execution.evidenceUrl || row.execution.evidenceText || (Array.isArray(row.execution.evidencePhotos) && row.execution.evidencePhotos.length > 0)),
      executedByUserId: row.execution.executedByUserId,
      executedAt: row.execution.executedAt,
    }))

  const sourceLinkRows = await db.select({
    link: preventionPdtpSourceLinks,
    activityN: pdtpActivities.n,
  }).from(preventionPdtpSourceLinks)
    .innerJoin(pdtpActivities, eq(preventionPdtpSourceLinks.activityId, pdtpActivities.id))
    .where(eq(pdtpActivities.programId, program.id))
    .orderBy(desc(preventionPdtpSourceLinks.createdAt))
  const sourceLinks: PdtpAuditDossierSourceLinkRow[] = sourceLinkRows
    .filter((row) => row.link.worksiteId === input.worksiteId)
    .map((row) => ({
      id: row.link.id,
      activityN: row.activityN,
      sourceType: row.link.sourceType,
      sourceId: row.link.sourceId,
      isActive: row.link.isActive,
      justification: row.link.justification,
      createdByUserId: row.link.createdByUserId,
      createdAt: row.link.createdAt,
      retiredByUserId: row.link.retiredByUserId,
      retiredAt: row.link.retiredAt,
      retirementReason: row.link.retirementReason,
    }))

  const [obligations, actions, approvalSteps, changeRows, importBatchRows] = await Promise.all([
    listPdtpObligations({ scope: input.scope, programId: program.id, worksiteId: input.worksiteId }),
    listActionsByProgram(program.id, input.scope, { worksiteId: input.worksiteId }),
    getPdtpApprovalProgress(program.id),
    db.select().from(pdtpChangeLog).where(eq(pdtpChangeLog.programId, program.id)).orderBy(desc(pdtpChangeLog.changedAt)),
    db.select().from(pdtpImportBatches).where(eq(pdtpImportBatches.programId, program.id)).orderBy(desc(pdtpImportBatches.createdAt)),
  ])

  const followupEntries = await Promise.all(actions.map(async (action) => [action.id, await listFollowups(action.id)] as const))
  const followupsByActionId = Object.fromEntries(followupEntries)

  const changes: PdtpAuditDossierChangeRow[] = changeRows.map((row) => ({
    id: row.id, version: row.version, changedByUserId: row.changedByUserId, changedAt: row.changedAt, section: row.section, note: row.note,
  }))
  const importBatches: PdtpAuditDossierImportBatchRow[] = importBatchRows
    .filter((row) => !row.targetWorksiteId || row.targetWorksiteId === input.worksiteId)
    .map((row) => ({
      id: row.id, status: row.status, adapterCode: row.adapterCode, sourceFileName: row.sourceFileName,
      sourceChecksumSha256: row.sourceChecksumSha256, requestedByUserId: row.requestedByUserId, appliedByUserId: row.appliedByUserId,
      createdAt: row.createdAt, appliedAt: row.appliedAt, cancellationReason: row.cancellationReason,
    }))

  const [worksite] = await db.select({ name: worksites.name })
    .from(worksites).where(eq(worksites.id, input.worksiteId)).limit(1)

  return {
    programId: program.id,
    programTitle: program.title,
    worksiteId: input.worksiteId,
    worksiteName: worksite?.name ?? input.worksiteId,
    contentVersion: program.contentVersion,
    contentDigest: program.contentDigest,
    status: program.status,
    executions,
    sourceLinks,
    obligations,
    actions,
    followupsByActionId,
    approvalSteps,
    changes,
    importBatches,
  }
}
