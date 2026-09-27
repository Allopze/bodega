import { existsSync } from "node:fs"
import { and, eq, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { pdtpActivities, pdtpActivityExecutionConfigs, pdtpExecutions, pdtpPrograms, pdtpScheduledInstances } from "@/db/schema"
import { assertPdtpWorksiteCanOperateProgram } from "./worksites"
import { getPdtpExecutionConnector } from "./connectors"
import { assertPdtpPeriodOpen } from "./period-guard"
import { resolvePdtpEvidenceFile } from "@/lib/storage/config"
import { PDTP_REASON_MIN_LENGTH } from "@/lib/prevention/pdtp"
import { assertPdtpEvidenceLinkable } from "./evidence-references"
import type { WorksiteScope } from "./helpers"

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

/**
 * Motivo recortado de un resultado, o `null` si no trae. PREV-C07: el "No
 * aplica" de una instancia exige el mismo mínimo que el de una celda
 * (`PDTP_REASON_MIN_LENGTH`, igual que `pdtpDeviationSchema` y el CHECK de
 * `pdtp_execution_deviations`); antes bastaban 3 caracteres.
 */
export function assertPdtpScheduledOutcomeReason(nextStatus: string, rawReason: string | null | undefined): string | null {
  const reason = rawReason?.trim() || null
  if (nextStatus === "not_applicable") {
    if (!reason) throw new Error("Indica por qué la instancia no aplica.")
    if (reason.length < PDTP_REASON_MIN_LENGTH) {
      throw new Error(`El motivo de "no aplica" debe tener al menos ${PDTP_REASON_MIN_LENGTH} caracteres.`)
    }
  }
  return reason
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

/**
 * Acciones que admite la vía manual (PREV-I08-c, D19). Completar ya no es una
 * de ellas: una ocurrencia se cumple sólo cuando su ejecución del libro queda
 * aprobada (`syncPdtpScheduledInstanceFromExecution`). Antes la acción aceptaba
 * `{ sourceApproved: true, sourceRecordId }` del cliente y completaba sin
 * aprobación ni guarda de mes cerrado.
 */
export type PdtpScheduledInstanceManualAction = Exclude<PdtpScheduledInstanceAction, "complete">

export function assertPdtpScheduledInstanceManualAction(action: PdtpScheduledInstanceAction): asserts action is PdtpScheduledInstanceManualAction {
  if (action === "complete") {
    throw new Error("La ocurrencia se completa al aprobar la ejecución vinculada en el PDTP; no se completa a mano.")
  }
}

/**
 * Estado de una ocurrencia enlazada según el estado de su ejecución en el
 * libro (D19: sólo cuenta lo aprobado). Aprobada → cumplida; enviada →
 * enviada; borrador o rechazada → vuelve a trabajo abierto (en curso si
 * alguien la había iniciado).
 */
export function pdtpScheduledInstanceStatusForExecution(input: {
  executionStatus: string
  startedAt: string | null
}): "completed" | "submitted" | "in_progress" | "pending" {
  if (input.executionStatus === "approved") return "completed"
  if (input.executionStatus === "submitted") return "submitted"
  return input.startedAt ? "in_progress" : "pending"
}

/** Mes (año y número) de la celda que ocupa una ocurrencia, por su fecha civil. */
function scheduledPeriod(scheduledFor: string): { year: number; month: number } {
  return { year: Number(scheduledFor.slice(0, 4)), month: Number(scheduledFor.slice(5, 7)) }
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
  const { instance: updated, created } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpScheduledInstances} WHERE ${pdtpScheduledInstances.id} = ${candidate.instance.id} FOR UPDATE`)
    const [current] = await tx.select().from(pdtpScheduledInstances)
      .where(eq(pdtpScheduledInstances.id, candidate.instance.id)).limit(1)
    if (!current) throw new Error("Instancia programada no encontrada.")
    if (["completed", "not_applicable", "cancelled"].includes(current.status)) return { instance: current, created: false }
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
    // `created` se decide aquí, con la fila bloqueada: comparar el
    // `startedAt` devuelto con `now` nunca coincidía, porque la base devuelve
    // el timestamp en su propio formato de texto y no en ISO (PREV-M08).
    return { instance: row ?? current, created: Boolean(row) && !current.startedAt }
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
    created,
  }
}

/**
 * Resultado manual de una ocurrencia: enviar, "no aplica" o cancelar
 * (PREV-I08-c, D19). No recibe metadatos del cliente —antes la acción los
 * pasaba y el servicio completaba confiando en `sourceApproved`— ni completa:
 * el cumplimiento sólo lo deriva `syncPdtpScheduledInstanceFromExecution`
 * desde la ejecución aprobada.
 *
 * Las tres acciones cambian lo que el indicador dice del mes de la ocurrencia
 * (no aplica y cancelar la sacan del denominador), así que todas pasan por
 * `assertPdtpPeriodOpen` dentro de la transacción, después del bloqueo.
 */
export async function recordPdtpScheduledInstanceOutcome(input: {
  instanceId: string
  action: PdtpScheduledInstanceAction
  userId?: string | null
  evidenceRef?: string | null
  reason?: string | null
  /**
   * Alcance de faenas de quien registra. Decide si una evidencia ya vinculada
   * a otra faena puede reutilizarse; sin alcance, sólo la propia faena.
   */
  scope?: WorksiteScope
}, client: ScheduledExecutionClient = db) {
  assertPdtpScheduledInstanceManualAction(input.action)
  const now = new Date().toISOString()
  const execute = async (tx: ScheduledExecutionClient) => {
    await tx.execute(sql`SELECT id FROM ${pdtpScheduledInstances} WHERE ${pdtpScheduledInstances.id} = ${input.instanceId} FOR UPDATE`)
    const [row] = await tx.select().from(pdtpScheduledInstances)
      .where(eq(pdtpScheduledInstances.id, input.instanceId))
      .limit(1)
    if (!row) throw new Error("Instancia programada no encontrada.")

    const nextStatus = assertPdtpScheduledInstanceTransition(row.status, input.action)
    if (nextStatus === row.status) return row
    const period = scheduledPeriod(row.scheduledFor)
    await assertPdtpPeriodOpen(row.programId, row.worksiteId, period.year, period.month, tx)
    const reason = assertPdtpScheduledOutcomeReason(nextStatus, input.reason)
    if (nextStatus === "cancelled" && (!reason || reason.length < 3)) {
      throw new Error("Indica el motivo de cancelación.")
    }
    if (input.evidenceRef) {
      const evidenceFile = resolvePdtpEvidenceFile(input.evidenceRef)
      if (!evidenceFile || !existsSync(evidenceFile)) {
        throw new Error("La evidencia adjunta no existe en el almacenamiento autorizado.")
      }
      await assertPdtpEvidenceLinkable(tx, { paths: [input.evidenceRef], worksiteId: row.worksiteId, scope: input.scope ?? [] })
    }
    const metadata = {
      ...sourceMetadata(row.sourceMetadataJson),
      ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
      ...(reason ? { outcomeReason: reason } : {}),
      outcomeRecordedAt: now,
      ...(input.userId ? { outcomeRecordedByUserId: input.userId } : {}),
    }
    const [updated] = await tx.update(pdtpScheduledInstances).set({
      status: nextStatus,
      notApplicableReason: nextStatus === "not_applicable" ? reason : row.notApplicableReason,
      cancelledAt: nextStatus === "cancelled" ? now : row.cancelledAt,
      cancelledByUserId: nextStatus === "cancelled" ? (input.userId ?? null) : row.cancelledByUserId,
      cancellationReason: nextStatus === "cancelled" ? reason : row.cancellationReason,
      sourceMetadataJson: metadata,
      updatedAt: now,
    }).where(and(
      eq(pdtpScheduledInstances.id, input.instanceId),
      eq(pdtpScheduledInstances.status, row.status),
    )).returning()
    if (!updated) throw new Error("La instancia programada cambió antes de registrar el resultado.")
    return updated
  }
  return isTransactionHost(client) ? client.transaction((tx) => execute(tx)) : execute(client)
}

export type PdtpScheduledInstanceSyncTrigger = "source" | "approval" | "rejection" | "revocation"

/** Claves que describen el enlace con una ejecución: se limpian al reabrir. */
const LINK_RESULT_KEYS: readonly string[] = [
  "executionId", "sourceRecordId", "sourceType", "sourceApproved", "approvalStatus", "approvedAt",
  "evidenceRef", "executionStatus", "rejectionReason", "syncedAt", "syncTrigger",
]

/**
 * Sincroniza una ocurrencia programada con la ejecución del libro que la
 * cumple (PREV-I08-c/e/b). Es la **única** vía que escribe "cumplida" y la
 * única que reabre un estado terminal (`revocation`), por fuera de
 * `assertPdtpScheduledInstanceTransition`. No se expone en ninguna acción.
 *
 * **Orden de bloqueo: ejecución → ocurrencia.** Aprobar, rechazar y revocar ya
 * bloquean primero la ejecución; si esta función bloqueara primero la
 * ocurrencia, una reacreditación concurrente con una aprobación de la misma
 * ejecución podía quedar en deadlock.
 *
 * - `attachToInstanceId`: enlaza la ejecución a esa ocurrencia (misma
 *   actividad y faena, no cumplida). Si la ocurrencia tenía enlazada una
 *   ejecución rechazada o en borrador, ésa se desenlaza: el hecho nuevo toma
 *   su lugar (el índice único admite una sola por ocurrencia).
 * - El estado sale de `pdtpScheduledInstanceStatusForExecution` (D19). Los
 *   metadatos se derivan del libro; nada de lo que manda el conector se copia.
 * - `approval` cambia el indicador del mes de la ocurrencia y exige ese mes
 *   abierto. `source` no se llama sobre un mes cerrado (el enlace descarta esas
 *   candidatas). `rejection` no mueve el indicador: lo enviado no cuenta.
 * - Una ocurrencia en "no aplica" o cancelada no cambia.
 * - `revocation` reabre (pendiente, o en curso si alguien la había iniciado),
 *   limpia el resultado, deja traza y desenlaza la ejecución, para que un hecho
 *   nuevo pueda tomarla sin chocar con el índice único.
 */
export async function syncPdtpScheduledInstanceFromExecution(client: Tx, input: {
  executionId: string
  attachToInstanceId?: string
  trigger: PdtpScheduledInstanceSyncTrigger
  userId?: string | null
  reason?: string | null
}): Promise<typeof pdtpScheduledInstances.$inferSelect | null> {
  await client.execute(sql`SELECT id FROM ${pdtpExecutions} WHERE ${pdtpExecutions.id} = ${input.executionId} FOR UPDATE`)
  const [execution] = await client.select().from(pdtpExecutions).where(eq(pdtpExecutions.id, input.executionId)).limit(1)
  if (!execution) throw new Error("Ejecución PDTP no encontrada.")
  const instanceId = input.attachToInstanceId ?? execution.scheduledInstanceId
  if (!instanceId) return null
  if (input.attachToInstanceId && execution.scheduledInstanceId && execution.scheduledInstanceId !== input.attachToInstanceId) {
    throw new Error("La ejecución fuente ya está enlazada a otra instancia.")
  }

  await client.execute(sql`SELECT id FROM ${pdtpScheduledInstances} WHERE ${pdtpScheduledInstances.id} = ${instanceId} FOR UPDATE`)
  const [instance] = await client.select().from(pdtpScheduledInstances).where(eq(pdtpScheduledInstances.id, instanceId)).limit(1)
  if (!instance) return null
  if (instance.activityId !== execution.activityId || instance.worksiteId !== execution.worksiteId) {
    throw new Error("La ejecución fuente no corresponde a la instancia programada.")
  }
  if (instance.status === "not_applicable" || instance.status === "cancelled") return instance

  const now = new Date().toISOString()
  const previous = sourceMetadata(instance.sourceMetadataJson)
  const executionMetadata = sourceMetadata(execution.sourceMetadataJson)
  const detachExecution = async (target: { id: string; sourceMetadataJson: unknown }) => {
    await client.update(pdtpExecutions).set({
      scheduledInstanceId: null,
      sourceMetadataJson: { ...sourceMetadata(target.sourceMetadataJson), scheduledInstanceId: null, detachedScheduledInstanceId: instance.id },
      updatedAt: now,
    }).where(eq(pdtpExecutions.id, target.id))
  }

  if (input.trigger === "revocation") {
    const cleaned = Object.fromEntries(Object.entries(previous).filter(([key]) => !LINK_RESULT_KEYS.includes(key)))
    const [reopened] = await client.update(pdtpScheduledInstances).set({
      status: instance.startedAt ? "in_progress" : "pending",
      completedAt: null,
      completedByUserId: null,
      sourceMetadataJson: {
        ...cleaned,
        reopenedAt: now,
        reopenReason: input.reason ?? "Registro de origen anulado.",
        reopenedFrom: { executionId: execution.id, status: instance.status },
      },
      updatedAt: now,
    }).where(eq(pdtpScheduledInstances.id, instance.id)).returning()
    if (execution.scheduledInstanceId === instance.id) await detachExecution(execution)
    return reopened ?? instance
  }

  if (input.attachToInstanceId && execution.scheduledInstanceId !== instance.id) {
    if (instance.status === "completed") throw new Error("La instancia programada ya tiene un resultado terminal.")
    const [occupant] = await client.select({ id: pdtpExecutions.id, status: pdtpExecutions.status, sourceMetadataJson: pdtpExecutions.sourceMetadataJson })
      .from(pdtpExecutions).where(eq(pdtpExecutions.scheduledInstanceId, instance.id)).limit(1)
    if (occupant) {
      if (occupant.status !== "rejected" && occupant.status !== "draft") {
        throw new Error("La instancia programada ya tiene otra ejecución vinculada.")
      }
      await detachExecution(occupant)
    }
    await client.update(pdtpExecutions).set({
      scheduledInstanceId: instance.id,
      sourceMetadataJson: { ...executionMetadata, scheduledInstanceId: instance.id },
      updatedAt: now,
    }).where(eq(pdtpExecutions.id, execution.id))
  }

  const nextStatus = pdtpScheduledInstanceStatusForExecution({ executionStatus: execution.status, startedAt: instance.startedAt })
  // Sólo la revocación reabre algo cumplido: una aprobación no se deshace por otra vía.
  if (instance.status === "completed" && nextStatus !== "completed") return instance
  if (nextStatus === "completed" && instance.status !== "completed" && input.trigger === "approval") {
    const period = scheduledPeriod(instance.scheduledFor)
    await assertPdtpPeriodOpen(instance.programId, instance.worksiteId, period.year, period.month, client)
  }
  const occurredAt = typeof executionMetadata.occurredAt === "string" && executionMetadata.occurredAt.trim()
    ? executionMetadata.occurredAt
    : execution.executedAt ?? now
  const completed = nextStatus === "completed"
  const [updated] = await client.update(pdtpScheduledInstances).set({
    status: nextStatus,
    completedAt: completed ? (instance.completedAt ?? occurredAt) : null,
    completedByUserId: completed ? (instance.completedByUserId ?? input.userId ?? execution.approvedByUserId ?? null) : null,
    sourceMetadataJson: {
      ...previous,
      executionId: execution.id,
      sourceRecordId: execution.sourceId ?? execution.id,
      sourceType: execution.sourceType ?? execution.origin,
      executionStatus: execution.status,
      syncedAt: now,
      syncTrigger: input.trigger,
      ...(input.trigger === "rejection" && input.reason ? { rejectionReason: input.reason } : {}),
    },
    updatedAt: now,
  }).where(eq(pdtpScheduledInstances.id, instance.id)).returning()
  return updated ?? instance
}
