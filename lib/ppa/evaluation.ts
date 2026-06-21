/**
 * lib/ppa/evaluation.ts
 * Lógica PURA de evaluación del PPA. Decide si el trabajo debe detenerse y por
 * qué. Sin DB ni efectos secundarios — 100% testeable.
 */

import {
  type PpaAnswers,
  type PpaStopReason,
  type PpaResultado,
  PPA_REQUIRED_CONTROLS,
  PPA_MIN_ANSWER_LEN,
  isTareaCritica,
} from "./types"

export interface PpaEvaluationResult {
  stop: boolean
  resultado: PpaResultado
  reasons: PpaStopReason[]
  esCritica: boolean
}

/** Sin contenido alguno (vacío o solo espacios). */
function isEmpty(v: string | undefined | null): boolean {
  return !v || v.trim().length === 0
}

/** Vacío o demasiado corto para considerarse una respuesta útil. */
function isBlank(v: string | undefined | null): boolean {
  return !v || v.trim().length < PPA_MIN_ANSWER_LEN
}

/**
 * Evalúa las respuestas del PPA y determina si el trabajo debe detenerse.
 * Implementa las "Reglas para detener el trabajo" del módulo.
 */
export function evaluatePpa(answers: PpaAnswers): PpaEvaluationResult {
  const reasons = new Set<PpaStopReason>()
  const esCritica = isTareaCritica(answers.tipoTrabajo)

  // 1. No es seguro comenzar.
  if (answers.seguroComenzar === "no") {
    reasons.add("no_seguro")
  }

  // 2. Peligro no controlado declarado.
  if (answers.peligroNoControlado === "si") {
    reasons.add("peligro_no_controlado")
    // Si declara peligro pero no lo describe → respuesta insuficiente.
    if (isBlank(answers.peligroDescripcion)) {
      reasons.add("respuesta_insuficiente")
    }
  }

  // 3. Cambio respecto a lo planificado sin describir.
  if (answers.cambioPlanificado === "si" && isBlank(answers.cambioDescripcion)) {
    reasons.add("cambio_sin_descripcion")
  }

  // 4. Faltan controles relevantes para la tarea.
  const controles = new Set(answers.controles ?? [])
  const faltanControles = PPA_REQUIRED_CONTROLS.some((c) => !controles.has(c))
  if (faltanControles) {
    reasons.add("faltan_controles")
  }

  // 5. Tareas críticas: las preguntas complementarias son obligatorias y deben
  //    tener contenido suficiente.
  if (esCritica) {
    const comp = answers.complementarias ?? {}

    // 5a. La pregunta clave es identificar el peligro crítico. Si no lo hace
    //     (vacío o insuficiente) → no identifica el peligro en una tarea crítica.
    if (isBlank(comp.peligroCritico)) {
      reasons.add("sin_peligro_en_tarea_critica")
    }

    // 5b. Resto de complementarias obligatorias. Distinguimos "no respondió"
    //     (vacía) de "respondió insuficiente" (no vacía pero demasiado corta).
    const otrasObligatorias: Array<keyof typeof comp> = [
      "queCambio",
      "revisionEquipo",
      "condicionClima",
    ]
    if (otrasObligatorias.some((k) => isEmpty(comp[k]))) {
      reasons.add("pregunta_critica_sin_responder")
    }
    if (otrasObligatorias.some((k) => !isEmpty(comp[k]) && isBlank(comp[k]))) {
      reasons.add("respuesta_insuficiente")
    }
  }

  const stop = reasons.size > 0
  return {
    stop,
    resultado: stop ? "detenido" : "autorizado_auto",
    reasons: [...reasons],
    esCritica,
  }
}
