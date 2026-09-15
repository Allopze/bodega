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
 * Los conectores generales siguen siendo tolerantes a fallos post-commit. El
 * conector de inspecciones acepta además la transacción fuente: cierre/reapertura
 * y cumplimiento se confirman entonces como una sola operación atómica.
 */

import { and, eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { pdtpProgramWorksites, worksites } from "@/db/schema"
import {
  accreditPdtpFromEvent,
  PdtpNoActiveProgramError,
  revokePdtpAccreditationWithClient,
  type AccreditationInput,
} from "@/lib/services/pdtp/accreditation"
import { recordPdtpFulfillmentEvent, recordPendingPdtpFulfillmentEvent, recordPdtpFulfillmentRevocation } from "@/lib/services/pdtp/fulfillment"
import { PDTP_CPHS_ACTIVITY_NUMBERS } from "@/lib/services/pdtp/worksites"

/** N°9: "Reunión revisión gestión preventiva SG-SST". */
const PDTP_MANAGEMENT_REVIEW_ACTIVITY_NUMBER = 9
/** N°1: "Aprobar el Programa de Prevención de Riesgos". */
const PDTP_PROGRAM_APPROVAL_ACTIVITY_NUMBER = 1
/** N°35: "Mantener y actualizar inventario de riesgos MIPER". */
const PDTP_MIPER_ACTIVITY_NUMBER = 35
/** N°83: "Plan emergencia por cada amenaza". */
const PDTP_EMERGENCY_PLAN_ACTIVITY_NUMBER = 83
/** N°7: "Envío de estadística de cada faena (indicadores de seguridad)". */
const PDTP_INDICATORS_ACTIVITY_NUMBER = 7
/** N°79: "Constitución Comité de Gestión de Riesgos de desastres (CGRD)". */
const PDTP_GRD_COMMITTEE_ACTIVITY_NUMBER = 79
/** N°80: "Implementación de matriz GRD". */
const PDTP_GRD_MATRIX_ACTIVITY_NUMBER = 80
/** N°81: "Actas de reunión CGRD". */
const PDTP_GRD_MEETING_ACTIVITY_NUMBER = 81

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Ejecuta la acreditación y absorbe errores no críticos (log sin throw).
 * El caller controla si quiere propagar el error; normalmente no lo hace
 * porque el evento ya fue persistido en su propia transacción.
 */
async function safeAccredit(input: AccreditationInput): Promise<void> {
  await recordPdtpFulfillmentEvent(input)
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
  completedByUserId: string
  activityNumbers: number[]
}, client?: Tx): Promise<void> {
  if (input.activityNumbers.length === 0) return

  // Cantidad 1 porque el modelo es una inspección por sujeto: el run declara su
  // `subjectResourceId`/`subjectVehicleId`, y la cobertura del PDTP sale de
  // sumar ejecuciones contra el `expectedSubjectCount` de la faena
  // (`lib/services/pdtp/compliance.ts`). Antes había aquí dos parámetros
  // —`coveredSubjectCount`/`expectedSubjectCount`— para una regla de
  // todo-o-nada que ningún llamador alimentó nunca: se retiraron porque una
  // regla que no corre leída en el código se confunde con una que sí.
  const executedQuantity = 1

  const accreditation: AccreditationInput = {
    sourceType: "inspeccion",
    sourceId: input.runId,
    worksiteId: input.worksiteId,
    activityNumbers: input.activityNumbers,
    occurredAt: input.completedAt,
    executedQuantity,
    evidenceRef: `Inspección completada: ${input.runId}`,
    autoApproveByUserId: input.completedByUserId,
  }
  if (client) {
    /* Comparte la transacción con el cierre del run: nunca puede quedar el run
     * completado sin su cumplimiento ni una ejecución PDTP sin la inspección
     * que la respalda.
     *
     * La excepción es "todavía no hay programa activo", y no es una
     * inconsistencia: es el estado de la plataforma durante todo el período en
     * que el programa anual se redacta y se firma. Dejarlo propagar revertía la
     * transacción entera, así que aprobar una plantilla antes de activar el
     * programa —un orden perfectamente posible, porque activar es una decisión
     * y aprobar plantillas es un trámite— impedía **cerrar la inspección**, con
     * un mensaje sobre el PDTP que a quien está en terreno no le dice nada.
     *
     * En ese caso el hecho queda anotado como `pending` **en la misma
     * transacción** y el run se cierra. `reconcilePdtpFulfillmentEvents` lo
     * acredita al activar el programa. Va en la transacción y no por la
     * conexión global a propósito: si el cierre se revierte, el evento se
     * revierte con él. */
    try {
      const result = await accreditPdtpFromEvent(accreditation, client)
      if (result.skippedNotFound.length > 0) {
        throw new Error(
          `La plantilla de inspección referencia actividades PDTP inexistentes: ${result.skippedNotFound.join(", ")}.`,
        )
      }
      if (result.skippedOutOfPeriod) {
        throw new Error(
          `La inspección ocurrió en ${result.skippedOutOfPeriod.occurredYear}, fuera del programa PDTP ${result.skippedOutOfPeriod.programYear}.`,
        )
      }
    } catch (err) {
      // Sólo ese caso. Un número inexistente o una faena fuera del programa
      // siguen tumbando el cierre: ésos sí hay que corregirlos antes de firmar.
      if (!(err instanceof PdtpNoActiveProgramError)) throw err
      await recordPendingPdtpFulfillmentEvent(accreditation, client)
    }
  } else {
    await safeAccredit(accreditation)
  }
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
}, client?: Tx): Promise<void> {
  const revocation = {
    sourceType: "inspeccion" as const,
    sourceId: input.runId,
    worksiteId: input.worksiteId,
    revokedBy: input.revokedBy,
    reason: input.reason,
  }
  if (client) {
    await revokePdtpAccreditationWithClient(revocation, client)
    return
  }
  await recordPdtpFulfillmentRevocation(revocation)
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
  await recordPdtpFulfillmentRevocation({
    sourceType: "capacitacion",
    sourceId: input.sessionId,
    worksiteId: input.worksiteId,
    revokedBy: input.cancelledBy,
    reason: "Sesión de capacitación cancelada.",
  })
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
  evidenceRef?: string
}): Promise<void> {
  if (input.activityNumbers.length === 0) return

  await safeAccredit({
    sourceType: "epp",
    sourceId: input.deliveryId,
    worksiteId: input.worksiteId,
    activityNumbers: input.activityNumbers,
    occurredAt: input.deliveredAt,
    executedQuantity: Math.max(1, input.workerCount),
    evidenceRef: input.evidenceRef ?? `Entrega EPP: ${input.deliveryId}`,
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
  /** EMG-001: la ruta del acta, si el cierre la adjuntó. */
  evidencePath?: string | null
}): Promise<void> {
  if (input.activityNumbers.length === 0) return

  await safeAccredit({
    sourceType: "emergencia",
    sourceId: input.drillId,
    worksiteId: input.worksiteId,
    activityNumbers: input.activityNumbers,
    occurredAt: input.executedAt,
    executedQuantity: Math.max(1, input.participantCount),
    /*
     * EMG-001 (auditoría 2026-09-14): esto era siempre el rótulo sintético
     * «Simulacro completado: <id>» —una cadena que se ve como evidencia y no lo
     * es—. Ahora, si el cierre adjuntó el acta, se referencia el archivo real;
     * el rótulo queda sólo para los simulacros que no llevan acta, y ahí dice
     * lo que hay: el registro de participantes.
     */
    evidenceRef: input.evidencePath ?? `Simulacro completado: ${input.drillId}`,
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

// ── Conector: MIPER ───────────────────────────────────────────────────────────

/**
 * Llama desde `transitionRiskMatrix` cuando la matriz pasa a `published`,
 * después del commit.
 *
 * Publicar es el hecho que la N°35 mide ("mantener y actualizar el inventario de
 * riesgos"), y no aprobar: la matriz aprobada todavía no rige. La publicación
 * además sella un hash del contenido y jubila la anterior, así que es un evento
 * confirmado en sentido estricto.
 *
 * `sourceId` lleva la matriz publicada, que es una por revisión: republicar la
 * misma no vuelve a sumar, y la revisión siguiente es otra fila.
 */
export async function onRiskMatrixPublished(input: {
  matrixId: string
  worksiteId: string
  matrixVersion: number
  publishedAt: string
  entryCount: number
}): Promise<void> {
  await safeAccredit({
    sourceType: "miper",
    sourceId: `miper:${input.matrixId}`,
    worksiteId: input.worksiteId,
    activityNumbers: [PDTP_MIPER_ACTIVITY_NUMBER],
    occurredAt: input.publishedAt,
    executedQuantity: 1,
    evidenceRef: `MIPER v${input.matrixVersion} publicada: ${input.matrixId}`,
    metadata: { matrixVersion: input.matrixVersion, entryCount: input.entryCount },
  })
}

// ── Conector: Documentación SST ───────────────────────────────────────────────

/**
 * Llama desde `publishDocumentVersion` cuando la versión queda vigente.
 *
 * @param activityNumbers - Los que declara el **tipo** del documento
 *   (`sst_document_types.pdtp_activity_numbers`). Vacío es no-op: la enorme
 *   mayoría de los documentos no acredita nada del programa.
 */
export async function onDocumentVersionPublished(input: {
  documentId: string
  versionId: string
  worksiteId: string
  publishedAt: string
  activityNumbers: number[]
}): Promise<void> {
  if (input.activityNumbers.length === 0) return

  await safeAccredit({
    sourceType: "documento",
    sourceId: `documento:${input.versionId}`,
    worksiteId: input.worksiteId,
    activityNumbers: input.activityNumbers,
    occurredAt: input.publishedAt,
    executedQuantity: 1,
    evidenceRef: `Versión de documento publicada: ${input.versionId}`,
    metadata: { documentId: input.documentId },
  })
}

/**
 * Llama desde `acknowledgeDocumentVersion` cuando una persona acusa recibo.
 *
 * La difusión se mide por cobertura: una acreditación por acuse, y el padrón son
 * los destinatarios. Por eso el `sourceId` lleva al destinatario y no a la
 * versión — si llevara la versión, el segundo acuse sería un reintento
 * idempotente del primero y la cobertura nunca pasaría de uno.
 */
export async function onDocumentAcknowledged(input: {
  versionId: string
  targetId: string
  worksiteId: string
  acknowledgedAt: string
  activityNumbers: number[]
}): Promise<void> {
  if (input.activityNumbers.length === 0) return

  await safeAccredit({
    sourceType: "documento",
    sourceId: `acuse:${input.versionId}:${input.targetId}`,
    worksiteId: input.worksiteId,
    activityNumbers: input.activityNumbers,
    occurredAt: input.acknowledgedAt,
    executedQuantity: 1,
    evidenceRef: `Acuse de recibo registrado: ${input.targetId}`,
    metadata: { versionId: input.versionId },
  })
}

// ── Conector: plan de emergencia publicado ────────────────────────────────────

/**
 * Llama desde `approveEmergencyPlan`, después del commit. Acredita la N°83
 * ("Plan emergencia por cada amenaza").
 *
 * Es un conector aparte de `onEmergencyDrillCompleted` a propósito: hasta ahora
 * lo único que acreditaba en el módulo era completar un simulacro, así que la
 * N°83 quedaba huérfana —declarar su número en el plan sólo la habría acreditado
 * al correr un simulacro, que es la N°84 y es otra cosa—.
 *
 * La cantidad son los **escenarios**, no el plan: el programa la planifica por
 * amenaza (decisión D13), y la aprobación ya exige que el plan tenga al menos un
 * escenario, así que el número nunca es cero.
 */
export async function onEmergencyPlanApproved(input: {
  planId: string
  worksiteId: string
  planCode: string
  approvedAt: string
  scenarioCount: number
}): Promise<void> {
  await safeAccredit({
    sourceType: "emergencia",
    sourceId: `plan:${input.planId}`,
    worksiteId: input.worksiteId,
    activityNumbers: [PDTP_EMERGENCY_PLAN_ACTIVITY_NUMBER],
    occurredAt: input.approvedAt,
    executedQuantity: Math.max(1, input.scenarioCount),
    evidenceRef: `Plan de emergencia aprobado: ${input.planCode}`,
    metadata: { planCode: input.planCode, scenarioCount: input.scenarioCount },
  })
}

// ── Conector: cierre del período de indicadores ───────────────────────────────

/**
 * Llama desde `closeSafetyIndicatorPeriod`, después del commit. Acredita la
 * N°7 ("Envío de estadística de cada faena"): el hecho que la actividad mide
 * es el cierre del mes, no el simple ingreso de cifras —`upsertSafetyIndicatorMonth`
 * es un teclado sin estado y `upsertSafetyIndicatorDenominator` deja el mes en
 * `draft`/`pending_review`, ninguno de los dos es un cumplimiento—.
 *
 * `sourceId` lleva el snapshot, no el período: un re-cierre (`closeReason`
 * corregido) genera un snapshot nuevo y por tanto una fila propia, coherente
 * con que cada snapshot es la versión vigente de ese mes.
 *
 * `occurredAt` es el `closedAt`, no el mes que se cierra: un diciembre cerrado
 * en enero cae fuera del año del programa si se sellara con el mes, y el
 * motor no acreditaría nada. El cierre real ocurrió cuando se pulsó "cerrar".
 */
export async function onSafetyIndicatorPeriodClosed(input: {
  worksiteId: string
  snapshotId: string
  year: number
  month: number
  closedAt: string
}): Promise<void> {
  await safeAccredit({
    sourceType: "indicadores",
    sourceId: `indicadores:${input.snapshotId}`,
    worksiteId: input.worksiteId,
    activityNumbers: [PDTP_INDICATORS_ACTIVITY_NUMBER],
    occurredAt: input.closedAt,
    executedQuantity: 1,
    evidenceRef: `Período de indicadores ${input.year}-${String(input.month).padStart(2, "0")} cerrado.`,
    metadata: { year: input.year, month: input.month },
  })
}

/**
 * Revierte la N°7 cuando un período cerrado se reabre.
 *
 * **El `snapshotId` es obligatorio y no es un detalle.** La revocación busca la
 * ejecución por `sourceType` y `sourceId` exactos, y el cierre la selló con
 * `indicadores:${snapshotId}`. Esta función estuvo escrita —y sin cablear—
 * usando el `worksiteId` en su lugar: conectada así habría revocado **cero**
 * ejecuciones y habría dejado un evento `revoked` en el libro afirmando algo
 * que no ocurrió. Un par acreditar/revertir que no comparte clave no es un par.
 *
 * Se dispara después del commit, con el patrón acumulador: `reopenClosedPeriod`
 * devuelve qué hay que revocar y no revoca nada por su cuenta, porque corre
 * dentro de la transacción de quien la llama y esta función abre la suya.
 */
export async function onSafetyIndicatorPeriodReopened(input: {
  worksiteId: string
  snapshotId: string
  year: number
  month: number
  reason: string
}): Promise<void> {
  await recordPdtpFulfillmentRevocation({
    sourceType: "indicadores",
    sourceId: `indicadores:${input.snapshotId}`,
    worksiteId: input.worksiteId,
    reason: input.reason,
  })
}

// ── Conector: CGRD del DS 44 (G15) ────────────────────────────────────────────

/**
 * Llama desde `constituteGrdCommittee` o desde `designateGrdCoordinator`: la
 * N°79 se cumple con **el órgano que corresponda a la dotación** —hasta 25
 * personas, coordinador; desde 26, comité— y las dos vías acreditan la misma
 * actividad.
 *
 * `kind` no es cosmético: entra en el `sourceId` (para que un comité y un
 * coordinador de la misma faena no compartan clave idempotente) y decide el
 * texto de la evidencia. Antes la vía del coordinador reusaba el conector del
 * comité pasándole `committeeId: "coordinator:<id>"`, así que la ejecución
 * quedaba con una referencia que afirmaba un comité constituido donde sólo
 * hubo una designación — falso ante quien audite el expediente.
 */
export async function onGrdStructureEstablished(input: {
  kind: "committee" | "coordinator"
  id: string
  worksiteId: string
  establishedOn: string
  evidenceUrl: string
}): Promise<void> {
  await safeAccredit({
    sourceType: "cgrd",
    sourceId: `cgrd-${input.kind}:${input.id}`,
    worksiteId: input.worksiteId,
    activityNumbers: [PDTP_GRD_COMMITTEE_ACTIVITY_NUMBER],
    occurredAt: input.establishedOn,
    executedQuantity: 1,
    evidenceRef: input.evidenceUrl,
    metadata: { kind: input.kind },
  })
}

/** Llama desde `publishGrdMatrix` cuando la matriz GRD queda `published`. */
export async function onGrdMatrixPublished(input: {
  matrixId: string
  worksiteId: string
  matrixVersion: number
  publishedAt: string
  threatCount: number
  evidenceUrl: string
}): Promise<void> {
  await safeAccredit({
    sourceType: "cgrd",
    sourceId: `cgrd-matrix:${input.matrixId}`,
    worksiteId: input.worksiteId,
    activityNumbers: [PDTP_GRD_MATRIX_ACTIVITY_NUMBER],
    occurredAt: input.publishedAt,
    executedQuantity: 1,
    evidenceRef: input.evidenceUrl,
    metadata: { matrixVersion: input.matrixVersion, threatCount: input.threatCount },
  })
}

/**
 * Llama desde `recordGrdMeeting` cuando el acta queda registrada. A diferencia
 * del CPHS —que no acredita su reunión mensual porque esa actividad salió
 * del PDTP (D5)— la N°81 sí es una actividad propia del programa.
 */
export async function onGrdMeetingClosed(input: {
  meetingId: string
  worksiteId: string
  closedAt: string
  evidenceUrl: string
}): Promise<void> {
  await safeAccredit({
    sourceType: "cgrd",
    sourceId: `cgrd-meeting:${input.meetingId}`,
    worksiteId: input.worksiteId,
    activityNumbers: [PDTP_GRD_MEETING_ACTIVITY_NUMBER],
    occurredAt: input.closedAt,
    executedQuantity: 1,
    evidenceRef: input.evidenceUrl,
  })
}
