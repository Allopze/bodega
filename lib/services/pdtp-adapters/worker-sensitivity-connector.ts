/**
 * lib/services/pdtp-adapters/worker-sensitivity-connector.ts
 *
 * N°17 — "Identificación de personas trabajadoras especialmente sensibles"
 * (RE-28).
 *
 * Se acredita al **cerrar el acta** `identificacion_sensibles`, una por
 * persona. Es lo que hace medible su modo `coverage` sobre la dotación: el
 * numerador son las personas con su registro cerrado y el denominador la
 * dotación activa de la faena.
 *
 * Conector propio y no una rama del de trabajador nuevo, aunque los dos cuelguen
 * de `closeEvaluation`: la decisión D06 separó las dos actas a propósito —la
 * "declaración de salud" del acta de ingreso no es el RE-28— y mezclarlas acá
 * volvería a juntar lo que esa decisión separó.
 *
 * `sourceId` lleva el id del acta: hay una por persona y por barrido, así que la
 * clave idempotente del motor ya distingue los casos. Cerrar dos veces no suma
 * dos veces — el servicio devuelve el acta tal cual si ya estaba cerrada.
 */

import { recordPdtpFulfillmentEvent } from "@/lib/services/pdtp/fulfillment"

/** Fijo en el conector: es lo que la hace legítima en la lista blanca de la compuerta. */
const SENSITIVE_WORKERS_ACTIVITY_NUMBER = 17

/**
 * Mediodía de Chile en UTC, igual que el conector del acta de trabajador nuevo:
 * un acta del día 1 sellada a medianoche UTC caería en el mes anterior.
 */
function occurredAtFromChileDate(plainDate: string): string {
  return `${plainDate}T12:00:00.000Z`
}

export async function onSensitiveWorkerIdentificationClosed(input: {
  evaluationId: string
  worksiteId: string
  workerId: string
  fechaEvaluacion: string
  resultadoFinal: string | null
}): Promise<void> {
  await recordPdtpFulfillmentEvent({
    sourceType: "evaluacion_sst",
    sourceId: `sensibles:${input.evaluationId}`,
    worksiteId: input.worksiteId,
    activityNumbers: [SENSITIVE_WORKERS_ACTIVITY_NUMBER],
    occurredAt: occurredAtFromChileDate(input.fechaEvaluacion),
    // Una persona registrada. El padrón de la actividad es la dotación, así que
    // numerador y denominador se cuentan en la misma unidad.
    executedQuantity: 1,
    evidenceRef: `RE-28 cerrado: ${input.evaluationId}`,
    metadata: {
      workerId: input.workerId,
      resultadoFinal: input.resultadoFinal,
      fechaEvaluacion: input.fechaEvaluacion,
    },
  })
}
