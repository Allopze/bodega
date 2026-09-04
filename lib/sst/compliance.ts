import type { StatusValue, ComplianceResult, EfficacyResult, ResultadoEficacia, ResultadoFinal } from './types'

/**
 * Positive statuses that count as "cumplidos"
 */
const POSITIVE_STATUSES: StatusValue[] = ['cumple', 'entregado', 'apto', 'si']

/**
 * Estados intermedios: puntúan medio punto.
 *
 * Regla de puntaje de las escalas B/R/M (Bueno / Regular / Malo) de los anexos
 * de inspección: cumple = +1, regular = +0.5, no cumple = 0. `regular` sí entra
 * al denominador — es una respuesta dada, no un N/A.
 */
const PARTIAL_STATUSES: StatusValue[] = ['regular']

/** Peso de un estado intermedio en el numerador. */
export const PARTIAL_STATUS_WEIGHT = 0.5

/**
 * Negative statuses that count as "no cumplidos"
 */
const NEGATIVE_STATUSES: StatusValue[] = ['no_cumple', 'no_entregado', 'no_apto', 'no']

/**
 * Estados que salen del denominador: el ítem no se evaluó.
 * 'na' = no aplica al sujeto · 'no_tiene' = el sujeto no posee el componente
 * (NT del Anexo 14). Distintos en el papel, idénticos para el puntaje.
 */
export const EXCLUDED_STATUSES: StatusValue[] = ['na', 'no_tiene']

export function isExcludedStatus(status: StatusValue): boolean {
  return EXCLUDED_STATUSES.includes(status)
}

// 'na', 'no_tiene' y null quedan fuera del cálculo (no cuentan en el denominador)

/**
 * Calculate compliance percentage from a set of responses.
 * Formula: (cumplidos + 0.5·regulares) / (cumplidos + regulares + no_cumplidos)
 * — excludes N/A items.
 *
 * `cumplidos` cuenta cabezas (ítems plenamente conformes), no puntaje: el medio
 * punto de los `regulares` vive sólo en `percentage`, para que los contadores
 * sigan sumando `cumplidos + regulares + noCumplidos === total`.
 */
export function calculateCompliance(respuestas: { estado: StatusValue }[]): ComplianceResult {
  let cumplidos = 0
  let regulares = 0
  let noCumplidos = 0
  let na = 0

  for (const r of respuestas) {
    if (POSITIVE_STATUSES.includes(r.estado)) {
      cumplidos++
    } else if (PARTIAL_STATUSES.includes(r.estado)) {
      regulares++
    } else if (NEGATIVE_STATUSES.includes(r.estado)) {
      noCumplidos++
    } else if (isExcludedStatus(r.estado)) {
      na++
    }
  }

  const total = cumplidos + regulares + noCumplidos
  const puntaje = cumplidos + regulares * PARTIAL_STATUS_WEIGHT
  const percentage = total > 0 ? (puntaje / total) * 100 : 0

  return {
    cumplidos,
    regulares,
    noCumplidos,
    na,
    total,
    percentage
  }
}

/**
 * Classify efficacy based on compliance percentage and critical conditions.
 *
 * Rules from DS N°44 / document:
 * - Eficaz: ≥90% compliance AND no critical deviations AND no reincidence
 * - Parcialmente eficaz: 70–89%
 * - No eficaz: <70% OR critical deviation OR reincidence
 */
export function classifyEfficacy(
  percentage: number,
  hasCriticalDeviation: boolean = false,
  hasReincidence: boolean = false,
  hasBlocker: boolean = false
): EfficacyResult {
  let classification: ResultadoEficacia

  if (hasCriticalDeviation || hasReincidence || hasBlocker || percentage < 70) {
    classification = 'no_eficaz'
  } else if (percentage >= 90) {
    classification = 'eficaz'
  } else {
    classification = 'parcialmente_eficaz'
  }

  return {
    percentage,
    classification,
    hasCriticalDeviation,
    hasReincidence
  }
}

/**
 * Get the display label for an efficacy classification
 */
export function getEfficacyLabel(classification: ResultadoEficacia): string {
  const labels: Record<string, string> = {
    eficaz: 'Eficaz',
    parcialmente_eficaz: 'Parcialmente eficaz',
    no_eficaz: 'No eficaz'
  }
  return classification ? labels[classification] || '' : ''
}

/**
 * Get the CSS color class for an efficacy classification
 */
export function getEfficacyColor(classification: ResultadoEficacia): string {
  switch (classification) {
    case 'eficaz':
      return 'text-emerald-400'
    case 'parcialmente_eficaz':
      return 'text-amber-400'
    case 'no_eficaz':
      return 'text-rose-400'
    default:
      return 'text-slate-400'
  }
}

/**
 * Get a human-readable label for a status value
 */
export function getStatusLabel(status: StatusValue): string {
  const labels: Record<string, string> = {
    cumple: 'Cumple',
    regular: 'Regular',
    no_cumple: 'No cumple',
    na: 'N/A',
    no_tiene: 'No tiene',
    entregado: 'Entregado',
    no_entregado: 'No entregado',
    apto: 'Apto',
    no_apto: 'No apto',
    si: 'Sí',
    no: 'No'
  }
  return status ? labels[status] || '' : '—'
}

/**
 * Check if a status is positive (compliant)
 */
export function isPositiveStatus(status: StatusValue): boolean {
  return POSITIVE_STATUSES.includes(status)
}

/**
 * Check if a status is negative (non-compliant)
 */
export function isNegativeStatus(status: StatusValue): boolean {
  return NEGATIVE_STATUSES.includes(status)
}

/**
 * Un ítem que no resultó plenamente conforme exige justificarse por escrito:
 * 'regular' y cualquier estado negativo ('no_cumple'/"Malo", 'no_entregado',
 * 'no_apto', 'no') obligan a dejar observación.
 *
 * Sin esto un checklist puede cerrarse con ítems en Regular o Malo y ninguna
 * traza de por qué, que es justamente lo que un auditor pide primero. 'na' no
 * entra: no es un incumplimiento, sólo sale del denominador.
 */
export function requiresObservation(status: StatusValue): boolean {
  return PARTIAL_STATUSES.includes(status) || NEGATIVE_STATUSES.includes(status)
}

/**
 * Automatically calculates the final outcome (ResultadoFinal) of an evaluation
 * based on the checklist code, compliance percentage, responses, and critical conditions.
 *
 * Rules:
 * - 1.1 y 1.2 tanto trabajador nuevo como antiguo el hecho de no cumplir con alguno
 *   dará como resultado no habilitado (a excepcion de protocolo minsal que no será bloqueante).
 *   - Para trabajador_nuevo: Secciones 'documentacion_requisitos' (1.1), 'induccion_capacitacion' (1.2)
 *     y 'competencias_operacionales' (2).
 *   - Para trabajador_antiguo: Secciones 4 'procedimientos_criticos'
 *     y 5 'control_ampliroll' / 'control_batea' / 'control_maquinaria'.
 * - Si hay algún bloqueo -> 'no_habilitado'.
 * - Si es trabajador_nuevo:
 *   - >= 90% -> 'habilitado_autonomo' (CUMPLE)
 *   - < 90% -> 'no_habilitado' (NO CUMPLE)
 * - Si es trabajador_antiguo:
 *   - Si hasCriticalDeviation OR hasReincidence OR percentage < 70 -> 'no_habilitado'
 *   - Else if percentage >= 90 -> 'habilitado_autonomo'
 *   - Else (70% - 89%) -> 'habilitado_restricciones'
 */
export function getAutomaticResultadoFinal(
  code: string,
  percentage: number,
  respuestas: { seccionId: string; itemId: string; estado: StatusValue }[],
  hasCriticalDeviation: boolean = false,
  hasReincidence: boolean = false
): ResultadoFinal {
  const isNuevo = code === 'trabajador_nuevo'

  // El RE-28 no habilita ni deshabilita a nadie para operar: registra una
  // condición y qué se hizo con ella. Su resultado NO puede salir del
  // porcentaje —el instrumento no puntúa nada, así que el porcentaje es
  // siempre 0— sino de lo que el propio formulario preguntó: si el puesto
  // exige reubicar, ajustar o limitar tareas, o si hay exposición relevante
  // para la condición declarada, el registro se cierra con restricciones.
  if (code === 'identificacion_sensibles') {
    const conRestriccion = respuestas.some((r) =>
      (r.itemId === 'requiere_ajuste' || r.itemId === 'exposicion_agentes') && r.estado === 'si')
    return conRestriccion ? 'habilitado_restricciones' : 'habilitado_autonomo'
  }

  // Blocker section check
  const isBlockerSection = (seccionId: string) => {
    if (isNuevo) {
      return [
        'documentacion_requisitos',   // Sección 1.1
        'induccion_capacitacion',     // Sección 1.2
        'competencias_operacionales', // Sección 2
      ].includes(seccionId)
    } else {
        return [
          'procedimientos_criticos',   // Sección 4
          'control_ampliroll',         // Sección 5.1
          'control_batea',             // Sección 5.2
          'control_maquinaria',        // Sección 5.3
        ].includes(seccionId)
    }
  }

  const hasBlocker = respuestas.some((r) => {
    if (r.itemId === 'protocolos_minsal') return false
    if (!isBlockerSection(r.seccionId)) return false
    return NEGATIVE_STATUSES.includes(r.estado)
  })

  if (hasBlocker) {
    return 'no_habilitado'
  }

  if (isNuevo) {
    return percentage >= 90 ? 'habilitado_autonomo' : 'no_habilitado'
  } else {
    if (hasCriticalDeviation || hasReincidence || percentage < 70) {
      return 'no_habilitado'
    } else if (percentage >= 90) {
      return 'habilitado_autonomo'
    } else {
      return 'habilitado_restricciones'
    }
  }
}
