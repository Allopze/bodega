/**
 * lib/services/pdtp-adapters/incident-accreditation-connector.ts
 *
 * Conector RE-20 entre las etapas de investigación de incidentes/accidentes
 * y el motor de auto-acreditación PDTP (`accreditPdtpFromEvent`).
 *
 * Mapeo de actividades PDTP (RE-20, Actividades 66-78):
 * - 66, 67: Registro de aviso del evento en turno.
 * - 68, 70: Informe preliminar enviado (≤3h).
 * - 69: Declaración/Entrevista firmada (≤24h).
 * - 71: Difusión en turnos.
 * - 72: Emisión de DIAT (≤24h).
 * - 73: Investigación definitiva completada (≤72h).
 * - 74: Informe definitivo enviado a Jefatura.
 * - 75: Difusión de medidas correctivas (≤48h).
 * - 76: Seguimiento quincenal de medidas.
 * - 77: Expediente archivado/cerrado.
 * - 78: ONE PAGE RE-20-06 difundido (≤24h).
 *
 * Todos los métodos son fire-and-forget (safeAccredit) sin revertir la transacción del caso.
 */

import { logger } from "@/lib/logger"
import { accreditPdtpFromEvent } from "@/lib/services/pdtp/accreditation"

async function safeAccredit(input: {
  sourceId: string
  worksiteId: string
  activityNumbers: number[]
  occurredAt: string
  executedQuantity?: number
  evidenceRef?: string
}) {
  try {
    await accreditPdtpFromEvent({
      sourceType: "incident",
      sourceId: input.sourceId,
      worksiteId: input.worksiteId,
      activityNumbers: input.activityNumbers,
      occurredAt: input.occurredAt,
      executedQuantity: input.executedQuantity ?? 1,
      evidenceRef: input.evidenceRef,
    })
  } catch (err) {
    logger.error(
      { err, sourceId: input.sourceId, worksiteId: input.worksiteId },
      "[incident-pdtp-connector] Error en auto-acreditación PDTP del incidente (no crítico).",
    )
  }
}

/** 66, 67: Aviso registrado en turno */
export async function onIncidentReported(input: { incidentId: string; worksiteId: string; reportedAt: string }) {
  await safeAccredit({
    sourceId: `${input.incidentId}:aviso`,
    worksiteId: input.worksiteId,
    activityNumbers: [66, 67],
    occurredAt: input.reportedAt,
    evidenceRef: `Aviso de incidente registrado: ${input.incidentId}`,
  })
}

/** 68, 70: Informe preliminar enviado (≤3h) */
export async function onIncidentPreliminaryReported(input: { incidentId: string; worksiteId: string; reportedAt: string }) {
  await safeAccredit({
    sourceId: `${input.incidentId}:preliminar`,
    worksiteId: input.worksiteId,
    activityNumbers: [68, 70],
    occurredAt: input.reportedAt,
    evidenceRef: `Informe preliminar RE-20-02 enviado: ${input.incidentId}`,
  })
}

/** 69: Declaración del involucrado / entrevista (≤24h) */
export async function onIncidentStatementRecorded(input: { incidentId: string; worksiteId: string; recordedAt: string }) {
  await safeAccredit({
    sourceId: `${input.incidentId}:declaracion`,
    worksiteId: input.worksiteId,
    activityNumbers: [69],
    occurredAt: input.recordedAt,
    evidenceRef: `Declaración/Entrevista RE-20 firmada: ${input.incidentId}`,
  })
}

/** 72: DIAT emitida (≤24h) */
export async function onIncidentDiatIssued(input: { incidentId: string; worksiteId: string; issuedAt: string }) {
  await safeAccredit({
    sourceId: `${input.incidentId}:diat`,
    worksiteId: input.worksiteId,
    activityNumbers: [72],
    occurredAt: input.issuedAt,
    evidenceRef: `DIAT RE-20-07 emitida: ${input.incidentId}`,
  })
}

/** 73, 74: Investigación definitiva completada / informe enviado (≤72h) */
export async function onIncidentInvestigationCompleted(input: { incidentId: string; worksiteId: string; completedAt: string }) {
  await safeAccredit({
    sourceId: `${input.incidentId}:investigacion`,
    worksiteId: input.worksiteId,
    activityNumbers: [73, 74],
    occurredAt: input.completedAt,
    evidenceRef: `Investigación definitiva RE-20-04 completada: ${input.incidentId}`,
  })
}

/** 71: Difusión del evento en los turnos */
export async function onIncidentShiftDiffused(input: { incidentId: string; worksiteId: string; diffusedAt: string }) {
  await safeAccredit({
    sourceId: `${input.incidentId}:difusion-turnos`,
    worksiteId: input.worksiteId,
    activityNumbers: [71],
    occurredAt: input.diffusedAt,
    evidenceRef: `Difusión en turnos confirmada: ${input.incidentId}`,
  })
}

/** 75: Difusión de las medidas correctivas (≤48h) */
export async function onIncidentMeasuresDiffused(input: { incidentId: string; worksiteId: string; diffusedAt: string }) {
  await safeAccredit({
    sourceId: `${input.incidentId}:difusion-medidas`,
    worksiteId: input.worksiteId,
    activityNumbers: [75],
    occurredAt: input.diffusedAt,
    evidenceRef: `Difusión de medidas correctivas confirmada: ${input.incidentId}`,
  })
}

/** 76: Seguimiento quincenal de medidas */
export async function onIncidentFollowupRecorded(input: { incidentId: string; worksiteId: string; followupId: string; recordedAt: string }) {
  await safeAccredit({
    sourceId: `${input.incidentId}:seguimiento:${input.followupId}`,
    worksiteId: input.worksiteId,
    activityNumbers: [76],
    occurredAt: input.recordedAt,
    evidenceRef: `Seguimiento de medidas RE-20-08: ${input.followupId}`,
  })
}

/** 77: Expediente archivado/cerrado */
export async function onIncidentClosed(input: { incidentId: string; worksiteId: string; closedAt: string }) {
  await safeAccredit({
    sourceId: `${input.incidentId}:archivo`,
    worksiteId: input.worksiteId,
    activityNumbers: [77],
    occurredAt: input.closedAt,
    evidenceRef: `Expediente de incidente cerrado: ${input.incidentId}`,
  })
}

/** 78: ONE PAGE RE-20-06 difundido (≤24h) */
export async function onIncidentOnePageDiffused(input: { incidentId: string; worksiteId: string; diffusedAt: string }) {
  await safeAccredit({
    sourceId: `${input.incidentId}:one-page`,
    worksiteId: input.worksiteId,
    activityNumbers: [78],
    occurredAt: input.diffusedAt,
    evidenceRef: `ONE PAGE RE-20-06 difundido: ${input.incidentId}`,
  })
}
