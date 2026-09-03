/**
 * lib/services/pdtp-adapters/incident-accreditation-connector.ts
 *
 * Conector RE-20 entre las etapas de investigación de incidentes/accidentes
 * y el programa PDTP.
 *
 * Doce de las trece actividades del RE-20 (N°66-78, salvo la N°76) se miden
 * por `closed_on_time` (Fase 3, 2026-09-02): el caso abre una **obligación**
 * con el plazo que declara `pdtp_activities.due_days`/`due_hours` —sembrado
 * por `apply-pdtp-2026-demand-slas.ts`— al reportarse el incidente, y cada
 * hito posterior la **reporta**. Antes acreditaban directo con
 * `accreditPdtpFromEvent`, lo que las hacía invisibles al indicador de plazo:
 * `pdtp_executions` no distingue una investigación cerrada a tiempo de una
 * cerrada tarde, sólo que se cerró.
 *
 * La N°66 y la N°67 ("informar inmediatamente…") se crean y se reportan en el
 * mismo instante: el propio reporte del incidente es el hecho que cumplen, no
 * hay un hito posterior que las cierre.
 *
 * La N°76 ("seguimiento quincenal") queda fuera de este cableado y sigue
 * acreditando directo: puede repetirse un número no acotado de veces por
 * incidente (un seguimiento por quincena), y el modelo de obligación es un
 * caso con un solo plazo y un solo reporte — no una serie. Convertirla
 * exigiría un caso por seguimiento, con su propio disparador de creación por
 * anticipado, que este conector no tiene (sólo se entera del seguimiento
 * cuando ya ocurrió). Queda documentado como límite conocido en
 * `tasks/TODO_PDTP_ACREDITACION_2026-09-01.md`.
 *
 * Todos los métodos son tolerantes a fallos (no revierten la transacción del
 * caso): un error acá queda en el log, nunca tumba el registro del incidente.
 */

import { logger } from "@/lib/logger"
import { resolvePdtpActivityIdsForNumbers } from "@/lib/services/pdtp/accreditation"
import { recordPdtpFulfillmentEvent } from "@/lib/services/pdtp/fulfillment"
import { createPdtpObligation, findPdtpObligationByIdempotencyKey, reportPdtpObligation } from "@/lib/services/pdtp/obligations"

/** Las doce actividades del RE-20 que pasan por obligación. La N°76 no está. */
const RE20_OBLIGATION_ACTIVITY_NUMBERS = [66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 77, 78]

function incidentObligationIdempotencyKey(activityId: string, worksiteId: string, incidentId: string): string {
  return `pdtp-obligation:${activityId}:${worksiteId}:incident:${incidentId}`
}

/**
 * Crea la obligación de una actividad del RE-20 para este incidente, y —si
 * `immediateEvidence` viene— la reporta de inmediato en el mismo llamado: es
 * el caso de la N°66/67, cuyo cumplimiento es el propio reporte del
 * incidente, sin un hito posterior que lo cierre.
 */
async function ensureIncidentObligation(input: {
  activityId: string
  worksiteId: string
  incidentId: string
  occurredAt: string
  userId: string
  immediateEvidence?: string
}): Promise<void> {
  try {
    const { obligation } = await createPdtpObligation({
      activityId: input.activityId,
      worksiteId: input.worksiteId,
      origin: "integration",
      sourceType: "incident",
      sourceId: input.incidentId,
      sourceOccurredAt: input.occurredAt,
      userId: input.userId,
      scope: "all",
    })
    if (input.immediateEvidence) {
      await reportPdtpObligation({
        obligationId: obligation.id,
        executedQuantity: 1,
        evidenceText: input.immediateEvidence,
        reportedAt: input.occurredAt,
        userId: input.userId,
        scope: "all",
      })
    }
  } catch (err) {
    logger.error(
      { err, activityId: input.activityId, incidentId: input.incidentId, worksiteId: input.worksiteId },
      "[incident-pdtp-connector] No se pudo crear/reportar la obligación del RE-20.",
    )
  }
}

/**
 * Reporta la obligación ya creada para una actividad del RE-20. Tolerante a
 * que la obligación no exista (el programa no estaba activo cuando se abrió
 * el caso, por ejemplo): queda en el log, no tumba el hito del incidente.
 */
async function reportIncidentObligation(input: {
  n: number
  worksiteId: string
  incidentId: string
  occurredAt: string
  userId: string
  evidenceText: string
}): Promise<void> {
  try {
    const resolved = await resolvePdtpActivityIdsForNumbers({
      worksiteId: input.worksiteId, occurredAt: input.occurredAt,
      activityNumbers: [input.n], sourceType: "incident", sourceId: input.incidentId,
    })
    if (!resolved) return // fuera del año del programa: ya se logueó al resolver.
    const activityId = resolved.activityIdByN.get(input.n)
    if (!activityId) return // actividad no encontrada en el programa: ya se logueó.

    const key = incidentObligationIdempotencyKey(activityId, input.worksiteId, input.incidentId)
    const obligation = await findPdtpObligationByIdempotencyKey(key)
    if (!obligation) {
      logger.warn(
        { n: input.n, incidentId: input.incidentId, worksiteId: input.worksiteId },
        "[incident-pdtp-connector] No hay obligación creada para este hito del RE-20; no se reporta.",
      )
      return
    }
    await reportPdtpObligation({
      obligationId: obligation.id,
      executedQuantity: 1,
      evidenceText: input.evidenceText,
      reportedAt: input.occurredAt,
      userId: input.userId,
      scope: "all",
    })
  } catch (err) {
    logger.error(
      { err, n: input.n, incidentId: input.incidentId, worksiteId: input.worksiteId },
      "[incident-pdtp-connector] Error al reportar una obligación del RE-20.",
    )
  }
}

/** 66, 67: Aviso registrado en turno — se crea y se reporta de inmediato. */
export async function onIncidentReported(input: { incidentId: string; worksiteId: string; reportedAt: string; userId: string }) {
  const resolved = await resolvePdtpActivityIdsForNumbers({
    worksiteId: input.worksiteId, occurredAt: input.reportedAt,
    activityNumbers: RE20_OBLIGATION_ACTIVITY_NUMBERS, sourceType: "incident", sourceId: input.incidentId,
  }).catch((err: unknown) => {
    logger.error({ err, incidentId: input.incidentId, worksiteId: input.worksiteId }, "[incident-pdtp-connector] No se pudieron resolver las obligaciones del RE-20.")
    return null
  })
  if (!resolved) return

  for (const n of RE20_OBLIGATION_ACTIVITY_NUMBERS) {
    const activityId = resolved.activityIdByN.get(n)
    if (!activityId) continue
    const immediate = n === 66 || n === 67
    await ensureIncidentObligation({
      activityId, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.reportedAt,
      userId: input.userId,
      immediateEvidence: immediate ? `Aviso de incidente registrado: ${input.incidentId}` : undefined,
    })
  }
}

/** 68, 70: Informe preliminar enviado (≤3h) */
export async function onIncidentPreliminaryReported(input: { incidentId: string; worksiteId: string; reportedAt: string; userId: string }) {
  for (const n of [68, 70]) {
    await reportIncidentObligation({
      n, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.reportedAt, userId: input.userId,
      evidenceText: `Informe preliminar RE-20-02 enviado: ${input.incidentId}`,
    })
  }
}

/** 69: Declaración del involucrado / entrevista (≤24h) */
export async function onIncidentStatementRecorded(input: { incidentId: string; worksiteId: string; recordedAt: string; userId: string }) {
  await reportIncidentObligation({
    n: 69, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.recordedAt, userId: input.userId,
    evidenceText: `Declaración/Entrevista RE-20 firmada: ${input.incidentId}`,
  })
}

/** 72: DIAT emitida (≤24h) */
export async function onIncidentDiatIssued(input: { incidentId: string; worksiteId: string; issuedAt: string; userId: string }) {
  await reportIncidentObligation({
    n: 72, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.issuedAt, userId: input.userId,
    evidenceText: `DIAT RE-20-07 emitida: ${input.incidentId}`,
  })
}

/** 73, 74: Investigación definitiva completada / informe enviado (≤72h) */
export async function onIncidentInvestigationCompleted(input: { incidentId: string; worksiteId: string; completedAt: string; userId: string }) {
  for (const n of [73, 74]) {
    await reportIncidentObligation({
      n, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.completedAt, userId: input.userId,
      evidenceText: `Investigación definitiva RE-20-04 completada: ${input.incidentId}`,
    })
  }
}

/** 71: Difusión del evento en los turnos (≤8h, propuesto) */
export async function onIncidentShiftDiffused(input: { incidentId: string; worksiteId: string; diffusedAt: string; userId: string }) {
  await reportIncidentObligation({
    n: 71, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.diffusedAt, userId: input.userId,
    evidenceText: `Difusión en turnos confirmada: ${input.incidentId}`,
  })
}

/** 75: Difusión de las medidas correctivas (≤48h) */
export async function onIncidentMeasuresDiffused(input: { incidentId: string; worksiteId: string; diffusedAt: string; userId: string }) {
  await reportIncidentObligation({
    n: 75, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.diffusedAt, userId: input.userId,
    evidenceText: `Difusión de medidas correctivas confirmada: ${input.incidentId}`,
  })
}

/**
 * 76: Seguimiento quincenal de medidas — fuera del modelo de obligación (ver
 * el docblock del archivo). Sigue acreditando directo, con una fila por
 * seguimiento: cada `followupId` es su propio evento durable.
 */
export async function onIncidentFollowupRecorded(input: { incidentId: string; worksiteId: string; followupId: string; recordedAt: string }) {
  await recordPdtpFulfillmentEvent({
    sourceType: "incident",
    sourceId: `${input.incidentId}:seguimiento:${input.followupId}`,
    worksiteId: input.worksiteId,
    activityNumbers: [76],
    occurredAt: input.recordedAt,
    evidenceRef: `Seguimiento de medidas RE-20-08: ${input.followupId}`,
  })
}

/** 77: Expediente archivado/cerrado (propuesto, tras el cierre del caso) */
export async function onIncidentClosed(input: { incidentId: string; worksiteId: string; closedAt: string; userId: string }) {
  await reportIncidentObligation({
    n: 77, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.closedAt, userId: input.userId,
    evidenceText: `Expediente de incidente cerrado: ${input.incidentId}`,
  })
}

/** 78: ONE PAGE RE-20-06 difundido (≤24h) */
export async function onIncidentOnePageDiffused(input: { incidentId: string; worksiteId: string; diffusedAt: string; userId: string }) {
  await reportIncidentObligation({
    n: 78, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.diffusedAt, userId: input.userId,
    evidenceText: `ONE PAGE RE-20-06 difundido: ${input.incidentId}`,
  })
}
