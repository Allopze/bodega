/**
 * lib/services/pdtp-adapters/worker-onboarding-connector.ts
 *
 * Conector entre el acta de trabajador nuevo (`sst_evaluations` con
 * `definicion_code = 'trabajador_nuevo'`) y el motor de auto-acreditación PDTP.
 *
 * El instrumento ya existía completo: `TRABAJADOR_NUEVO` en
 * `lib/sst/definitions/`, revisión 01 del 2026-02-25, extraída de un documento
 * real del cliente, con rutas, servicio, respuestas por ítem y un Acta de Cierre
 * "Habilitación Operacional" firmada por supervisor y prevencionista. Lo que
 * faltaba era el cable: el módulo SST no tenía una sola referencia al motor.
 *
 * El acta cerrada es **inmutable por DS 44/2024**, así que es un evento
 * confirmado en el sentido estricto que el motor pide y **no necesita camino de
 * reversión**, a diferencia de los controles de vigilancia o las inspecciones.
 *
 * Cada ítem acredita su actividad sólo si quedó conforme: un RIOHS marcado
 * "no cumple" prueba que no se entregó, así que no puede cerrar la N°18.
 */

import type { AccreditationInput } from "@/lib/services/pdtp/accreditation"
import { recordPdtpFulfillmentEvent } from "@/lib/services/pdtp/fulfillment"

/**
 * Ítem del acta → actividad del PDTP que cierra.
 *
 * Sólo lo que el texto respalda sin interpretar. Quedan deliberadamente fuera:
 *
 * - **N°17** (identificación de personas especialmente sensibles, RE-28). El
 *   acta tiene "Declaración de salud", que no es el mismo instrumento: el RE-28
 *   es un formulario propio con su propio criterio. Decisión D06.
 * - **N°16** (prueba de evaluación IRL). Su fuente es la nota de asistencia a
 *   capacitación, otro módulo.
 */
const ITEM_ACTIVITIES: Array<{ seccionId: string; itemId: string; n: number; label: string }> = [
  { seccionId: "induccion_capacitacion", itemId: "induccion_irl", n: 15, label: "Inducción IRL" },
  { seccionId: "induccion_capacitacion", itemId: "riohs", n: 18, label: "Entrega del RIOHS" },
  // D05: el ítem dice "Capacitación: gestión de los elementos de protección
  // personal" y la N°63 "uso correcto, reposición y eliminación de EPP".
  { seccionId: "induccion_capacitacion", itemId: "capacitacion_epp", n: 63, label: "Capacitación de EPP" },
]

/**
 * La N°23 es la entrega **inicial** de EPP según el cargo, distinta de la N°62
 * que es el registro general de entregas. La cierra la sección completa de EPP
 * del acta: entregar cinco de siete prendas no es haber equipado a la persona.
 * Los ítems no aplicables al cargo no cuentan en contra.
 */
const EPP_SECTION_ID = "epp"
const EPP_ACTIVITY_NUMBER = 23

/**
 * N°19 ("mantener actualizada la carpeta de… entrega EPP, IRL, RIOHS con
 * cartas de SEREMI e inspección") es `planned_vs_completed`, mensual (1
 * unidad planificada por mes), no `coverage`: no mide qué fracción de la
 * dotación tiene carpeta completa, mide si la carpeta se mantuvo ese mes. La
 * carpeta de un trabajador se considera al día con los mismos tres
 * componentes que ya cierran la N°15, la N°18 y la N°23 —es el mismo hecho,
 * archivado—, así que cierra junto con ellas y no necesita su propio ítem del
 * acta. Las cartas del SEREMI quedan como evidencia de respaldo del
 * expediente, sin entrar al cómputo: no hay un ítem del acta que las registre.
 */
const STARTER_FOLDER_ACTIVITY_NUMBER = 19

/**
 * N°52, la inducción completa. Es la actividad **compuesta** del programa: se
 * cierra cuando sus componentes están, y el acta ya expresa exactamente eso en
 * su resultado final. Sólo la habilitación plena cuenta — una habilitación con
 * restricciones es una inducción a medias.
 */
const ONBOARDING_ACTIVITY_NUMBER = 52
const ONBOARDING_PASSING_RESULT = "habilitado_autonomo"

/** Estados que cuentan como conforme, por tipo de escala del ítem. */
const CONFORMING = new Set(["cumple", "entregado", "apto", "si"])
/** Estados que sacan el ítem del denominador en vez de reprobarlo. */
const NOT_APPLICABLE = new Set(["na", "no_tiene", null])

export type OnboardingResponse = { seccionId: string; itemId: string; estado: string | null }

/**
 * Ancla la fecha civil del acta al mediodía UTC. `fecha_evaluacion` es
 * `YYYY-MM-DD`, no un timestamp, y el motor ubica el período contando el día en
 * `America/Santiago`: con `T00:00:00Z` un acta del día 1 se archivaría en el mes
 * anterior. Mismo criterio que el conector de higiene.
 */
function occurredAtFromChileDate(plainDate: string): string {
  return `${plainDate}T12:00:00.000Z`
}

async function safeAccredit(input: AccreditationInput): Promise<void> {
  await recordPdtpFulfillmentEvent(input)
}

/**
 * Qué actividades cierra un acta, según sus respuestas y su resultado final.
 *
 * Se expone aparte del disparo para poder probar el mapa sin base de datos, que
 * es donde vive el riesgo: un renombre de ítem en la definición del checklist
 * dejaría el mapa apuntando a una clave muerta y la actividad dejaría de
 * acreditarse sin que nada falle.
 */
export function onboardingActivityNumbers(input: {
  responses: OnboardingResponse[]
  resultadoFinal: string | null
}): number[] {
  const byKey = new Map(input.responses.map((r) => [`${r.seccionId}::${r.itemId}`, r.estado]))
  const numbers: number[] = []

  for (const item of ITEM_ACTIVITIES) {
    const estado = byKey.get(`${item.seccionId}::${item.itemId}`)
    if (estado !== undefined && estado !== null && CONFORMING.has(estado)) numbers.push(item.n)
  }

  const eppItems = input.responses.filter((r) => r.seccionId === EPP_SECTION_ID)
  const eppRequired = eppItems.filter((r) => !NOT_APPLICABLE.has(r.estado))
  if (eppRequired.length > 0 && eppRequired.every((r) => r.estado !== null && CONFORMING.has(r.estado))) {
    numbers.push(EPP_ACTIVITY_NUMBER)
  }

  if (input.resultadoFinal === ONBOARDING_PASSING_RESULT) numbers.push(ONBOARDING_ACTIVITY_NUMBER)

  // N°19: la carpeta del trabajador queda al día cuando los tres componentes
  // que la componen (inducción IRL, RIOHS, EPP inicial) ya cerraron.
  if (numbers.includes(15) && numbers.includes(18) && numbers.includes(EPP_ACTIVITY_NUMBER)) {
    numbers.push(STARTER_FOLDER_ACTIVITY_NUMBER)
  }

  return numbers.sort((a, b) => a - b)
}

/**
 * Llama desde `closeEvaluation` cuando un acta de trabajador nuevo queda
 * `cerrado`, después del commit. El acta es inmutable, así que no hay reversión.
 *
 * `sourceId` lleva el id del acta: hay una por trabajador y por habilitación, de
 * modo que la clave idempotente del motor ya separa los casos sin sufijo. Repetir
 * el cierre —el servicio devuelve la evaluación tal cual si ya estaba cerrada—
 * no vuelve a sumar.
 */
export async function onWorkerOnboardingClosed(input: {
  evaluationId: string
  worksiteId: string
  workerId: string
  fechaEvaluacion: string
  resultadoFinal: string | null
  responses: OnboardingResponse[]
}): Promise<void> {
  const activityNumbers = onboardingActivityNumbers(input)
  if (activityNumbers.length === 0) return

  await safeAccredit({
    sourceType: "evaluacion_sst",
    sourceId: `habilitacion:${input.evaluationId}`,
    worksiteId: input.worksiteId,
    activityNumbers,
    occurredAt: occurredAtFromChileDate(input.fechaEvaluacion),
    // Una persona habilitada. El padrón del mes son las actas cerradas, así que
    // numerador y denominador se cuentan en la misma unidad.
    executedQuantity: 1,
    evidenceRef: `Acta de trabajador nuevo cerrada: ${input.evaluationId}`,
    metadata: {
      workerId: input.workerId,
      resultadoFinal: input.resultadoFinal,
      fechaEvaluacion: input.fechaEvaluacion,
      accreditedItems: activityNumbers,
    },
  })
}
