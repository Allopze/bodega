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
 * - CPHS → constituir el comité acredita la N°11 (PDTP_CPHS_ACTIVITY_NUMBERS).
 * - Revisión por la dirección → N°9.
 * - Aprobación del programa → N°1, en todas las faenas del programa.
 * - Emergencia/Simulacro → actividades pasadas explícitamente o configuradas
 *   en el plan de emergencia.
 *
 * Todos los conectores son fire-and-forget en el contexto del caller: si la
 * acreditación falla (sin programa activo, actividad excluida, etc.) loggeamos
 * pero no revertimos la transacción del evento fuente. La acreditación puede
 * reintentarse; el evento real ya ocurrió.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpProgramWorksites, worksites } from "@/db/schema"
import { logger } from "@/lib/logger"
import {
  accreditPdtpFromEvent,
  revokePdtpAccreditation,
  type AccreditationInput,
} from "@/lib/services/pdtp/accreditation"
import { PDTP_CPHS_ACTIVITY_NUMBERS } from "@/lib/services/pdtp/worksites"

/** N°9: "Reunión revisión gestión preventiva SG-SST". */
const PDTP_MANAGEMENT_REVIEW_ACTIVITY_NUMBER = 9
/** N°1: "Aprobar el Programa de Prevención de Riesgos". */
const PDTP_PROGRAM_APPROVAL_ACTIVITY_NUMBER = 1

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
}): Promise<void> {
  if (input.activityNumbers.length === 0) return

  // Cantidad 1 porque el modelo es una inspección por sujeto: el run declara su
  // `subjectResourceId`/`subjectVehicleId`, y la cobertura del PDTP sale de
  // sumar ejecuciones contra el `expectedSubjectCount` de la faena
  // (`lib/services/pdtp/compliance.ts`). Antes había aquí dos parámetros
  // —`coveredSubjectCount`/`expectedSubjectCount`— para una regla de
  // todo-o-nada que ningún llamador alimentó nunca: se retiraron porque una
  // regla que no corre leída en el código se confunde con una que sí.
  const executedQuantity = 1

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

/**
 * Revierte la acreditación cuando la inspección deja de sostenerla: se cancela,
 * o se reabre para rectificar.
 *
 * Sin esto el programa anual seguía contando una inspección que el propio
 * motor había anulado —`transitionInspectionRun` borra `compliancePercent`,
 * `executedAt` y `reviewedAt` al reabrir— y con la acreditación de la revisión
 * el desfase era doble: quedaba viva la firma de un run sin firmante.
 *
 * Las ejecuciones ya aprobadas por una persona NO se tocan: eso lo decide
 * `revokePdtpAccreditation`, que las reporta en `skippedApproved`. Deshacer una
 * aprobación humana es una decisión humana.
 */
export async function onInspectionReverted(input: {
  runId: string
  worksiteId: string
  reason: string
  revokedBy?: string
}): Promise<void> {
  try {
    await revokePdtpAccreditation({
      sourceType: "inspeccion",
      sourceId: input.runId,
      worksiteId: input.worksiteId,
      revokedBy: input.revokedBy,
      reason: input.reason,
    })
  } catch (err) {
    logger.error(
      { err, runId: input.runId, worksiteId: input.worksiteId },
      "[pdtp-connector] Error al revertir la acreditación de una inspección anulada o reabierta.",
    )
  }
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
 * Llama desde `constituteCommittee`: la N°11 del PDTP ("constituir el o los
 * Comités Paritarios cuando proceda") se cumple al crear el comité en la faena.
 *
 * Antes esto colgaba del cierre de un acta (`closeCommitteeMeeting`), que es
 * otra cosa: un acta cerrada prueba que el comité sesionó, no que exista. La
 * reunión mensual además ya no es actividad del PDTP — pasó al programa propio
 * del comité (D5 del diseño 2026-08-12).
 */
export async function onCphsCommitteeConstituted(input: {
  committeeId: string
  worksiteId: string
  constitutedOn: string
}): Promise<void> {
  await safeAccredit({
    sourceType: "cphs",
    sourceId: input.committeeId,
    worksiteId: input.worksiteId,
    activityNumbers: [...PDTP_CPHS_ACTIVITY_NUMBERS],
    occurredAt: input.constitutedOn,
    executedQuantity: 1,
    evidenceRef: `Comité paritario constituido: ${input.committeeId}`,
  })
}

/**
 * Llama desde `closeManagementReview` cuando la revisión por la dirección
 * queda registrada. Acredita la N°9 ("Reunión revisión gestión preventiva
 * SG-SST", responsable Gerencia Legal y RRHH + JDPR + PRF).
 *
 * Apuntaba a la N°14, que es el plan de trabajo del comité paritario y salió
 * del PDTP al programa propio del CPHS (D5). La reunión de revisión de la
 * gestión que registra este módulo es la N°9, no la 14.
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
    activityNumbers: [PDTP_MANAGEMENT_REVIEW_ACTIVITY_NUMBER],
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

// ── Conector: aprobación del propio programa ──────────────────────────────────

/**
 * Llama desde `recordPdtpApprovalDecision` cuando el paso `legal` queda
 * aprobado. La N°1 del programa —"Aprobar el Programa de Prevención de
 * Riesgos"— es autorreferente: se cumple con la firma de Legal y RRHH sobre
 * este mismo programa, así que nadie tiene que marcarla a mano.
 *
 * Acredita en **todas** las faenas del programa, no en una sola: la planilla y
 * el % de cumplimiento son por faena, y un programa aprobado lo está para
 * todas. Sin membresía declarada aplica a todas las faenas activas, misma
 * regla que `resolveProgramWorksiteIds`.
 *
 * Idempotente por construcción: la clave del motor incluye `sourceId`, que acá
 * es el id del programa.
 */
export async function onPdtpProgramLegallyApproved(input: {
  programId: string
  approvedAt: string
}): Promise<void> {
  const members = await db.select({ worksiteId: pdtpProgramWorksites.worksiteId })
    .from(pdtpProgramWorksites)
    .where(and(
      eq(pdtpProgramWorksites.programId, input.programId),
      eq(pdtpProgramWorksites.isActive, true),
    ))

  const worksiteIds = members.length > 0
    ? members.map((row) => row.worksiteId)
    : (await db.select({ id: worksites.id }).from(worksites).where(eq(worksites.isActive, true))).map((row) => row.id)

  for (const worksiteId of worksiteIds) {
    await safeAccredit({
      sourceType: "aprobacion_programa",
      sourceId: input.programId,
      worksiteId,
      programId: input.programId,
      activityNumbers: [PDTP_PROGRAM_APPROVAL_ACTIVITY_NUMBER],
      occurredAt: input.approvedAt,
      executedQuantity: 1,
      evidenceRef: `Programa aprobado por Legal y RRHH: ${input.programId}`,
    })
  }
}
