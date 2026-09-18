import { existsSync } from "node:fs"
import { and, eq, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { pdtpActivities, pdtpActivityExecutionConfigs, pdtpExecutions, pdtpPrograms, pdtpScheduledInstances } from "@/db/schema"
import { assertPdtpWorksiteCanOperateProgram } from "./worksites"
import { getPdtpExecutionConnector, type PdtpEvidenceKind } from "./connectors"
import { resolvePdtpEvidenceFile } from "@/lib/storage/config"

export type PdtpScheduledInstanceAction = "submit" | "complete" | "not_applicable" | "cancel"

type ScheduledExecutionClient = DB | Tx

function isTransactionHost(client: ScheduledExecutionClient): client is DB {
  return typeof (client as DB).transaction === "function"
}

export function assertPdtpScheduledInstanceTransition(currentStatus: string, action: PdtpScheduledInstanceAction): "submitted" | "completed" | "not_applicable" | "cancelled" {
  if (["completed", "not_applicable", "cancelled"].includes(currentStatus)) {
    // Reintentar la misma confirmación es idempotente; cualquier otra acción
    // sobre un estado terminal sería una mutación silenciosa del histórico.
    const terminalByAction: Record<PdtpScheduledInstanceAction, string> = {
      submit: "submitted",
      complete: "completed",
      not_applicable: "not_applicable",
      cancel: "cancelled",
    }
    if (terminalByAction[action] === currentStatus) return currentStatus as "completed" | "not_applicable" | "cancelled"
    throw new Error("La instancia programada ya tiene un resultado terminal.")
  }
  if (action === "submit") return "submitted"
  if (action === "complete") return "completed"
  if (action === "not_applicable") return "not_applicable"
  return "cancelled"
}

export function pdtpScheduledExecutionStartIdempotencyKey(
  instanceId: string,
  connectorKey: string,
  instrumentId: string | null | undefined,
): string {
  return `pdtp-start:${instanceId}:${connectorKey}:${instrumentId || "none"}`
}

/**
 * El instrumento que llega desde una URL es sólo una sugerencia de contexto;
 * la configuración anual sigue siendo la fuente de verdad. Sin esta
 * comprobación alguien podía cambiar `instrumento` en el enlace y reservar la
 * misma instancia contra otro binding o contra uno que la actividad no tenía.
 */
export function resolvePdtpScheduledInstrument(
  configuredInstrumentId: string | null | undefined,
  requestedInstrumentId: string | null | undefined,
): string | null {
  const configured = configuredInstrumentId ?? null
  const requested = requestedInstrumentId ?? null
  if (requested && !configured) {
    throw new Error("La instancia no tiene un instrumento operativo configurado.")
  }
  if (requested && configured !== requested) {
    throw new Error("El instrumento de la instancia cambió. Recarga la actividad.")
  }
  return requested ?? configured
}

function sourceMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function sourceRecordId(metadata: Record<string, unknown>): string | null {
  for (const key of ["sourceRecordId", "sourceId", "executionId"]) {
    const value = metadata[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function completionPolicySatisfied(policy: string | undefined, metadata: Record<string, unknown>): boolean {
  const recordId = sourceRecordId(metadata)
  if (policy === "source_completed") return Boolean(recordId)
  if (policy === "source_approved") {
    return Boolean(recordId) && (
      metadata.sourceApproved === true
      || metadata.approvalStatus === "approved"
      || (typeof metadata.approvedAt === "string" && metadata.approvedAt.trim().length > 0)
    )
  }
  if (policy === "checklist_completed") {
    return metadata.checklistCompleted === true
      || metadata.checklistStatus === "completed"
      || (metadata.sourceRecordType === "checklist" && Boolean(recordId))
  }
  return true
}

function evidenceKindForOutcome(evidenceRef: string | null | undefined, metadata: Record<string, unknown>): PdtpEvidenceKind | null {
  const declared = metadata.evidenceKind
  if (typeof declared === "string" && ["file", "photo", "checklist", "signature", "generated_record"].includes(declared)) {
    return declared as PdtpEvidenceKind
  }
  if (sourceRecordId(metadata)) return "generated_record"
  if (evidenceRef?.trim()) return "file"
  return null
}

function evidencePolicySatisfied(
  config: { evidenceRequired: boolean; acceptedEvidenceKinds: unknown } | null | undefined,
  evidenceRef: string | null | undefined,
  metadata: Record<string, unknown>,
): boolean {
  if (!config?.evidenceRequired) return true
  const kind = evidenceKindForOutcome(evidenceRef, metadata)
  if (!kind) return false
  const accepted = Array.isArray(config.acceptedEvidenceKinds)
    ? config.acceptedEvidenceKinds.filter((value): value is string => typeof value === "string")
    : []
  return accepted.length === 0 || accepted.includes(kind)
}

export async function getPdtpScheduledInstanceStartContext(instanceId: string) {
  const [row] = await db.select({
    instance: pdtpScheduledInstances,
    config: pdtpActivityExecutionConfigs,
  }).from(pdtpScheduledInstances)
    .innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpScheduledInstances.activityId))
    .leftJoin(pdtpActivityExecutionConfigs, eq(pdtpActivityExecutionConfigs.activityId, pdtpScheduledInstances.activityId))
    .where(eq(pdtpScheduledInstances.id, instanceId))
    .limit(1)
  const connector = getPdtpExecutionConnector(row?.config?.destinationConnectorKey)
  if (!row || !connector) return null
  return { ...row, connector }
}

/**
 * Marca una ocurrencia como iniciada y devuelve el enlace contextual del
 * conector. El registro nativo se crea únicamente cuando el formulario de ese
 * conector se confirma; esta operación sólo reserva la instancia de forma
 * idempotente para que dos clics no abran dos trabajos distintos.
 */
export async function startPdtpScheduledInstance(input: {
  instanceId: string
  userId: string
  connectorKey?: string
  instrumentId?: string | null
}) {
  const [candidate] = await db.select({
    instance: pdtpScheduledInstances,
    activity: pdtpActivities,
    program: pdtpPrograms,
    config: pdtpActivityExecutionConfigs,
  }).from(pdtpScheduledInstances)
    .innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpScheduledInstances.activityId))
    .innerJoin(pdtpPrograms, eq(pdtpPrograms.id, pdtpScheduledInstances.programId))
    .leftJoin(pdtpActivityExecutionConfigs, eq(pdtpActivityExecutionConfigs.activityId, pdtpActivities.id))
    .where(eq(pdtpScheduledInstances.id, input.instanceId))
    .limit(1)
  if (!candidate) throw new Error("Instancia programada no encontrada.")
  const connectorKey = input.connectorKey ?? candidate.config?.destinationConnectorKey
  const connector = getPdtpExecutionConnector(connectorKey)
  if (!connector) throw new Error("La instancia no tiene un destino operativo válido.")
  if (!candidate.config || candidate.config.destinationConnectorKey !== connector.key) {
    throw new Error("El destino operativo de la instancia cambió. Recarga la actividad.")
  }
  if (candidate.program.status !== "active") throw new Error("El programa no está activo.")
  if (candidate.activity.status !== "active") throw new Error("La actividad ya no está activa.")
  await assertPdtpWorksiteCanOperateProgram(candidate.instance.programId, candidate.instance.worksiteId)

  const instrumentId = resolvePdtpScheduledInstrument(candidate.config.accreditationBindingId, input.instrumentId)
  const startKey = pdtpScheduledExecutionStartIdempotencyKey(candidate.instance.id, connector.key, instrumentId)
  const now = new Date().toISOString()
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpScheduledInstances} WHERE ${pdtpScheduledInstances.id} = ${candidate.instance.id} FOR UPDATE`)
    const [current] = await tx.select().from(pdtpScheduledInstances)
      .where(eq(pdtpScheduledInstances.id, candidate.instance.id)).limit(1)
    if (!current) throw new Error("Instancia programada no encontrada.")
    if (["completed", "not_applicable", "cancelled"].includes(current.status)) return current
    const metadata = {
      ...sourceMetadata(current.sourceMetadataJson),
      startIdempotencyKey: startKey,
      destinationConnectorKey: connector.key,
      instrumentId,
    }
    const [row] = await tx.update(pdtpScheduledInstances).set({
      status: current.status === "submitted" ? "submitted" : "in_progress",
      startedAt: current.startedAt ?? now,
      startedByUserId: current.startedByUserId ?? input.userId,
      sourceMetadataJson: metadata,
      updatedAt: now,
    }).where(and(
      eq(pdtpScheduledInstances.id, current.id),
      eq(pdtpScheduledInstances.status, current.status),
    )).returning()
    return row ?? current
  })

  return {
    instance: updated,
    connector,
    startIdempotencyKey: startKey,
    startHref: connector.buildStartHref({
      id: updated.id,
      programId: updated.programId,
      activityId: updated.activityId,
      worksiteId: updated.worksiteId,
      instrumentId,
    }),
    created: updated.startedAt === now,
  }
}

/**
 * Registra el resultado de una ocurrencia sin crear un segundo sistema de
 * evidencias. Los adaptadores nativos llaman esta función después de guardar
 * su propio registro y pasan la referencia verificable en `evidenceRef` o en
 * `sourceMetadata`; así la instancia PDTP sólo enlaza el hecho que ya existe.
 */
export async function recordPdtpScheduledInstanceOutcome(input: {
  instanceId: string
  action: PdtpScheduledInstanceAction
  userId?: string | null
  evidenceRef?: string | null
  reason?: string | null
  sourceMetadata?: Record<string, unknown>
  completedAt?: string
}, client: ScheduledExecutionClient = db) {
  const now = new Date().toISOString()
  const execute = async (tx: ScheduledExecutionClient) => {
    await tx.execute(sql`SELECT id FROM ${pdtpScheduledInstances} WHERE ${pdtpScheduledInstances.id} = ${input.instanceId} FOR UPDATE`)
    const [row] = await tx.select({
      instance: pdtpScheduledInstances,
      config: pdtpActivityExecutionConfigs,
    }).from(pdtpScheduledInstances)
      .leftJoin(pdtpActivityExecutionConfigs, eq(pdtpActivityExecutionConfigs.activityId, pdtpScheduledInstances.activityId))
      .where(eq(pdtpScheduledInstances.id, input.instanceId))
      .limit(1)
    if (!row) throw new Error("Instancia programada no encontrada.")

    const nextStatus = assertPdtpScheduledInstanceTransition(row.instance.status, input.action)
    if (nextStatus === row.instance.status) return row.instance
    const reason = input.reason?.trim() || null
    if (nextStatus === "not_applicable" && (!reason || reason.length < 3)) {
      throw new Error("Indica por qué la instancia no aplica.")
    }
    if (nextStatus === "cancelled" && (!reason || reason.length < 3)) {
      throw new Error("Indica el motivo de cancelación.")
    }
    const incomingMetadata = input.sourceMetadata ?? {}
    if (input.evidenceRef) {
      const evidenceFile = resolvePdtpEvidenceFile(input.evidenceRef)
      if (!evidenceFile || !existsSync(evidenceFile)) {
        throw new Error("La evidencia adjunta no existe en el almacenamiento autorizado.")
      }
    }
    if (nextStatus === "completed" && !completionPolicySatisfied(row.config?.completionPolicy, incomingMetadata)) {
      throw new Error("El criterio de cumplimiento todavía no está satisfecho por el submódulo de origen.")
    }
    if (nextStatus === "completed" && !evidencePolicySatisfied(row.config, input.evidenceRef, incomingMetadata)) {
      throw new Error("La actividad requiere evidencia verificable antes de completarse.")
    }
    const metadata = {
      ...sourceMetadata(row.instance.sourceMetadataJson),
      ...incomingMetadata,
      ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
      ...(reason ? { outcomeReason: reason } : {}),
      outcomeRecordedAt: now,
      ...(input.userId ? { outcomeRecordedByUserId: input.userId } : {}),
    }
    const [updated] = await tx.update(pdtpScheduledInstances).set({
      status: nextStatus,
      completedAt: nextStatus === "completed" ? (input.completedAt ?? now) : row.instance.completedAt,
      completedByUserId: nextStatus === "completed" ? (input.userId ?? row.instance.completedByUserId) : row.instance.completedByUserId,
      notApplicableReason: nextStatus === "not_applicable" ? reason : row.instance.notApplicableReason,
      cancelledAt: nextStatus === "cancelled" ? now : row.instance.cancelledAt,
      cancelledByUserId: nextStatus === "cancelled" ? input.userId : row.instance.cancelledByUserId,
      cancellationReason: nextStatus === "cancelled" ? reason : row.instance.cancellationReason,
      sourceMetadataJson: metadata,
      updatedAt: now,
    }).where(eq(pdtpScheduledInstances.id, input.instanceId)).returning()
    if (!updated) throw new Error("La instancia programada cambió antes de registrar el resultado.")

    // Cuando el conector ya produjo una fila en el ledger PDTP, se enlaza de
    // forma explícita a esta ocurrencia. No se crea una ejecución paralela ni
    // se permite secuestrar una ejecución de otra actividad/faena.
    const executionId = typeof incomingMetadata.executionId === "string" ? incomingMetadata.executionId.trim() : ""
    if (executionId) {
      const [execution] = await tx.select({
        id: pdtpExecutions.id,
        activityId: pdtpExecutions.activityId,
        worksiteId: pdtpExecutions.worksiteId,
        scheduledInstanceId: pdtpExecutions.scheduledInstanceId,
        sourceMetadataJson: pdtpExecutions.sourceMetadataJson,
      }).from(pdtpExecutions).where(eq(pdtpExecutions.id, executionId)).limit(1)
      if (!execution || execution.activityId !== row.instance.activityId || execution.worksiteId !== row.instance.worksiteId) {
        throw new Error("La ejecución fuente no corresponde a la instancia programada.")
      }
      if (execution.scheduledInstanceId && execution.scheduledInstanceId !== row.instance.id) {
        throw new Error("La ejecución fuente ya está enlazada a otra instancia.")
      }
      await tx.update(pdtpExecutions).set({
        scheduledInstanceId: row.instance.id,
        sourceMetadataJson: { ...sourceMetadata(execution.sourceMetadataJson), scheduledInstanceId: row.instance.id },
        updatedAt: now,
      }).where(eq(pdtpExecutions.id, executionId))
    }
    return updated
  }
  return isTransactionHost(client) ? client.transaction((tx) => execute(tx)) : execute(client)
}
