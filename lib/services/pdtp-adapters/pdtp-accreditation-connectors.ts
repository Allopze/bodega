/**
 * lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts
 *
 * Conectores thin entre los servicios de dominio de prevención y el motor de
 * auto-acreditación PDTP (`accreditPdtpFromEvent`). Cada conector se llama
 * desde el servicio de dominio correspondiente justo después de que el evento
 * quedó confirmado/cerrado (nunca en borrador).
 *
 * Mapeos de actividad PDTP:
 * - Inspecciones → según el `pdtpActivityNumbers` de la plantilla del run
 *   (campo `pdtpActivityNumbers` en `preventionInspectionTemplates`). Si la
 *   plantilla no declara actividades, el conector es no-op.
 * - Capacitación → números declarados en el `courseVersionId` del curso, o
 *   pasados explícitamente por el caller.
 * - EPP (entrega de equipo) → actividades declaradas en el tipo de EPP o
 *   pasadas explícitamente.
 * - CPHS → actividades 11, 12, 13, 14 (constante PDTP_CPHS_ACTIVITY_NUMBERS).
 * - Emergencia/Simulacro → actividades pasadas explícitamente o configuradas
 *   en el plan de emergencia.
 *
 * Todos los conectores son fire-and-forget en el contexto del caller: si la
 * acreditación falla (sin programa activo, actividad excluida, etc.) loggeamos
 * pero no revertimos la transacción del evento fuente. La acreditación puede
 * reintentarse; el evento real ya ocurrió.
 */

import { logger } from "@/lib/logger"
import {
  accreditPdtpFromEvent,
  revokePdtpAccreditation,
  type AccreditationInput,
} from "@/lib/services/pdtp/accreditation"
import { PDTP_CPHS_ACTIVITY_NUMBERS } from "@/lib/services/pdtp/worksites"

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Ejecuta la acreditación y absorbe errores no críticos (log sin throw).
 * El caller controla si quiere propagar el error; normalmente no lo hace
 * porque el evento ya fue persistido en su propia transacción.
 */
async function safeAccredit(input: AccreditationInput): Promise<void> {
  try {
    const result = await accreditPdtpFromEvent(input)
    if (result.skippedNotFound.length > 0) {
      logger.warn(
        { sourceType: input.sourceType, sourceId: input.sourceId, skippedNotFound: result.skippedNotFound },
        "[pdtp-connector] Actividades no encontradas en el programa activo.",
      )
    }
  } catch (err) {
    logger.error(
      { err, sourceType: input.sourceType, sourceId: input.sourceId, worksiteId: input.worksiteId },
      "[pdtp-connector] Error en auto-acreditación PDTP (no crítico para el evento fuente).",
    )
  }
}

// ── Conector: Inspecciones ────────────────────────────────────────────────────

/**
 * Llama desde `completeInspectionRun` o `reviewInspectionRun` cuando la
 * inspección queda en estado `completed` o `reviewed`.
 *
 * @param activityNumbers - Números de actividad PDTP que esta inspección cubre.
 *   Viene de la plantilla de la inspección (`pdtpActivityNumbers`). Si el array
 *   está vacío, es un no-op (inspección no vinculada al PDTP).
 */
export async function onInspectionCompleted(input: {
  runId: string
  worksiteId: string
  completedAt: string
  activityNumbers: number[]
  coveredSubjectCount?: number  // Para futura implementación de R1 (todo-o-nada)
  expectedSubjectCount?: number // ídem
}): Promise<void> {
  if (input.activityNumbers.length === 0) return

  // R1 (todo-o-nada): si hay padrón definido y no se cubrió el 100%, ejecutedQuantity=0
  // Nota: con Q=0 no acreditamos (la actividad necesita Q>0 para contar). Por ahora
  // si expectedSubjectCount no está definido, asumimos Q=1 (acredita).
  const executedQuantity = 1
  if (
    input.expectedSubjectCount != null &&
    input.coveredSubjectCount != null &&
    input.coveredSubjectCount < input.expectedSubjectCount
  ) {
    // Todo-o-nada: inspección incompleta no acredita
    logger.info(
      { runId: input.runId, covered: input.coveredSubjectCount, expected: input.expectedSubjectCount },
      "[pdtp-connector] Inspección no cubre todos los sujetos esperados (R1): no se acredita.",
    )
    return
  }

  await safeAccredit({
    sourceType: "inspeccion",
    sourceId: input.runId,
    worksiteId: input.worksiteId,
    activityNumbers: input.activityNumbers,
    occurredAt: input.completedAt,
    executedQuantity,
    evidenceRef: `Inspección completada: ${input.runId}`,
  })
}

// ── Conector: Capacitación ────────────────────────────────────────────────────

/**
 * Llama desde `closeTrainingSession` cuando la sesión queda `completed`.
 *
 * @param attendedCount - Cantidad de asistentes con resultado aprobado/no_required.
 * @param activityNumbers - Números de actividad PDTP del curso.
 */
export async function onTrainingSessionClosed(input: {
  sessionId: string
  worksiteId: string
  closedAt: string
  attendedCount: number
  activityNumbers: number[]
}): Promise<void> {
  if (input.activityNumbers.length === 0) return

  await safeAccredit({
    sourceType: "capacitacion",
    sourceId: input.sessionId,
    worksiteId: input.worksiteId,
    activityNumbers: input.activityNumbers,
    occurredAt: input.closedAt,
    // La cantidad ejecutada es el número de personas que completaron la sesión
    executedQuantity: Math.max(1, input.attendedCount),
    evidenceRef: `Sesión de capacitación cerrada: ${input.sessionId}`,
  })
}

/**
 * Revierte la acreditación cuando una sesión se cancela.
 */
export async function onTrainingSessionCancelled(input: {
  sessionId: string
  worksiteId: string
  cancelledBy?: string
}): Promise<void> {
  try {
    await revokePdtpAccreditation({
      sourceType: "capacitacion",
      sourceId: input.sessionId,
      worksiteId: input.worksiteId,
      revokedBy: input.cancelledBy,
      reason: "Sesión de capacitación cancelada.",
    })
  } catch (err) {
    logger.error(
      { err, sessionId: input.sessionId, worksiteId: input.worksiteId },
      "[pdtp-connector] Error al revertir acreditación de sesión cancelada.",
    )
  }
}

// ── Conector: EPP ─────────────────────────────────────────────────────────────

/**
 * Llama cuando se registra/aprueba una entrega de EPP a trabajadores.
 * La cantidad ejecutada es el número de personas que recibieron el EPP.
 *
 * @param activityNumbers - Números de actividad PDTP que cubre esta entrega.
 */
export async function onEppDeliveryCompleted(input: {
  deliveryId: string
  worksiteId: string
  deliveredAt: string
  workerCount: number
  activityNumbers: number[]
}): Promise<void> {
  if (input.activityNumbers.length === 0) return

  await safeAccredit({
    sourceType: "epp",
    sourceId: input.deliveryId,
    worksiteId: input.worksiteId,
    activityNumbers: input.activityNumbers,
    occurredAt: input.deliveredAt,
    executedQuantity: Math.max(1, input.workerCount),
    evidenceRef: `Entrega EPP: ${input.deliveryId}`,
  })
}

// ── Conector: CPHS ────────────────────────────────────────────────────────────

/**
 * Llama desde `closeCommitteeMeeting` cuando el acta queda `closed`.
 * Acredita todas las actividades CPHS (11, 12, 13, 14) que no estén
 * excluidas de la faena.
 */
export async function onCphsMeetingClosed(input: {
  meetingId: string
  worksiteId: string
  heldAt: string
}): Promise<void> {
  await safeAccredit({
    sourceType: "cphs",
    sourceId: input.meetingId,
    worksiteId: input.worksiteId,
    activityNumbers: [...PDTP_CPHS_ACTIVITY_NUMBERS],
    occurredAt: input.heldAt,
    executedQuantity: 1,
    evidenceRef: `Acta de comité CPHS cerrada: ${input.meetingId}`,
  })
}

/**
 * Llama desde `closeManagementReview` cuando la revisión por la dirección
 * queda registrada. Acredita actividad 14 (revisión por la dirección / CPHS).
 */
export async function onManagementReviewClosed(input: {
  reviewId: string
  worksiteId: string
  heldAt: string
}): Promise<void> {
  await safeAccredit({
    sourceType: "cphs",
    sourceId: input.reviewId,
    worksiteId: input.worksiteId,
    // La revisión por la dirección corresponde a la actividad 14
    activityNumbers: [14],
    occurredAt: input.heldAt,
    executedQuantity: 1,
    evidenceRef: `Revisión por la dirección cerrada: ${input.reviewId}`,
  })
}

// ── Conector: Emergencias ─────────────────────────────────────────────────────

/**
 * Llama desde `completeEmergencyDrill` cuando el simulacro queda `completed`.
 *
 * @param activityNumbers - Números de actividad PDTP del simulacro.
 *   Usualmente declarados en el plan de emergencia. Si vacío, es no-op.
 */
export async function onEmergencyDrillCompleted(input: {
  drillId: string
  worksiteId: string
  executedAt: string
  participantCount: number
  activityNumbers: number[]
}): Promise<void> {
  if (input.activityNumbers.length === 0) return

  await safeAccredit({
    sourceType: "emergencia",
    sourceId: input.drillId,
    worksiteId: input.worksiteId,
    activityNumbers: input.activityNumbers,
    occurredAt: input.executedAt,
    executedQuantity: Math.max(1, input.participantCount),
    evidenceRef: `Simulacro completado: ${input.drillId}`,
  })
}
