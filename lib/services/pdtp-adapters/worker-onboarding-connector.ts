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
import { recordPdtpTriggerEvent } from "@/lib/services/pdtp/trigger-events"
import { logger } from "@/lib/logger"
import { reportSubjectObligation } from "./obligation-kit"
import { workerSubjectKey } from "./worker-lifecycle-connector"

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

/*
 * La N°19 ("mantener actualizada la carpeta de requisitos legales") se
 * acreditaba acá hasta el 2026-09-24, como la carpeta del trabajador: cerraba
 * junto con la 15, la 18 y la 23. Prevención decidió que la carpeta es la
 * documental de la faena —RIOHS vigente con sus cartas conductoras, registros
 * de IRL y de entrega de EPP— y ahora la acredita Documentación
 * (`legal-folder-connector.ts`). El acta ya no la toca.
 */

/**
 * N°52, la inducción completa. Es la actividad **compuesta** del programa: se
 * cierra cuando sus componentes están, y el acta ya expresa exactamente eso en
 * su resultado final. Sólo la habilitación plena cuenta — una habilitación con
 * restricciones es una inducción a medias.
 */
const ONBOARDING_ACTIVITY_NUMBER = 52
const ONBOARDING_PASSING_RESULT = "habilitado_autonomo"

/**
 * Las dos que se miden por plazo de cierre (`closed_on_time`) y por lo tanto
 * **cierran una obligación**, no una acreditación directa.
 *
 * No es una regresión que dejen de acreditar directo: para una actividad
 * `closed_on_time` el indicador ignora las ejecuciones y sólo mira obligaciones
 * vencidas y cerradas a tiempo (`lib/services/pdtp/compliance.ts`), así que la
 * fila directa no aportaba nada y sólo habría duplicado el registro en la
 * planilla. Si no hay obligación abierta, el kit deja un `warn`: ésa es la
 * señal de que la entrada del trabajador no abrió su compromiso.
 *
 * Las otras tres (18, 23, 63) siguen igual: no son a demanda y no tienen
 * obligación contra la cual reportarse.
 */
const OBLIGATION_ACTIVITY_NUMBERS = new Set([15, ONBOARDING_ACTIVITY_NUMBER])

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
  actorUserId: string
}): Promise<void> {
  // El cierre del acta es el productor durable del evento configurable
  // `worker.worker_created`. Se registra antes de resolver el mapa histórico
  // de actividades: aunque una revisión anual todavía no esté activa, el
  // reconciliador podrá consumirlo después sin perder el hecho operativo.
  // Este adaptador se invoca después del commit de SST; un fallo del libro de
  // eventos no debe revertir un acta ya cerrada.
  try {
    await recordPdtpTriggerEvent({
      connectorKey: "worker",
      eventKey: "worker_created",
      sourceType: "evaluacion_sst",
      sourceId: input.evaluationId,
      worksiteId: input.worksiteId,
      occurredAt: occurredAtFromChileDate(input.fechaEvaluacion),
      payload: {
        workerId: input.workerId,
        evaluationId: input.evaluationId,
        resultadoFinal: input.resultadoFinal,
      },
    })
  } catch (error) {
    // La acreditación histórica sigue siendo el contrato principal de esta
    // integración. El cron/reconciliador podrá registrar un error observable
    // sin tumbar el cierre del acta.
    logger.error({ err: error, evaluationId: input.evaluationId, worksiteId: input.worksiteId }, "[worker-onboarding-connector] No se pudo registrar el evento PDTP de ingreso.")
  }

  // El filtro va después del mapeador: el mapeador describe qué probó el acta,
  // y este paso decide por qué vía se acredita cada número.
  const activityNumbers = onboardingActivityNumbers(input)
  if (activityNumbers.length === 0) return

  const direct = activityNumbers.filter((n) => !OBLIGATION_ACTIVITY_NUMBERS.has(n))
  const byObligation = activityNumbers.filter((n) => OBLIGATION_ACTIVITY_NUMBERS.has(n))
  const occurredAt = occurredAtFromChileDate(input.fechaEvaluacion)

  if (direct.length > 0) {
    await safeAccredit({
      sourceType: "evaluacion_sst",
      sourceId: `habilitacion:${input.evaluationId}`,
      worksiteId: input.worksiteId,
      activityNumbers: direct,
      occurredAt,
      // Una persona habilitada. El padrón del mes son las actas cerradas, así que
      // numerador y denominador se cuentan en la misma unidad.
      executedQuantity: 1,
      evidenceRef: `Acta de trabajador nuevo cerrada: ${input.evaluationId}`,
      metadata: {
        workerId: input.workerId,
        resultadoFinal: input.resultadoFinal,
        fechaEvaluacion: input.fechaEvaluacion,
        accreditedItems: direct,
      },
    })
  }

  for (const activityNumber of byObligation) {
    await reportSubjectObligation({
      activityNumber,
      worksiteId: input.worksiteId,
      subjectKey: workerSubjectKey(input.workerId),
      occurredAt,
      evidenceText: `Acta de trabajador nuevo cerrada: ${input.evaluationId}`,
      userId: input.actorUserId,
    })
  }
}
