import type { StatusValue, ComplianceResult, EfficacyResult, ResultadoEficacia, ResultadoFinal } from './types'

/**
 * Positive statuses that count as "cumplidos"
 */
const POSITIVE_STATUSES: StatusValue[] = ['cumple', 'entregado', 'apto', 'si']

/**
 * Negative statuses that count as "no cumplidos"
 */
const NEGATIVE_STATUSES: StatusValue[] = ['no_cumple', 'no_entregado', 'no_apto', 'no']

// Statuses 'na' and null are excluded from compliance (not counted in denominator)

/**
 * Calculate compliance percentage from a set of responses.
 * Formula: cumplidos / (cumplidos + no_cumplidos) — excludes N/A items.
 */
export function calculateCompliance(respuestas: { estado: StatusValue }[]): ComplianceResult {
  let cumplidos = 0
  let noCumplidos = 0
  let na = 0

  for (const r of respuestas) {
    if (POSITIVE_STATUSES.includes(r.estado)) {
      cumplidos++
    } else if (NEGATIVE_STATUSES.includes(r.estado)) {
      noCumplidos++
    } else if (r.estado === 'na') {
      na++
    }
  }

  const total = cumplidos + noCumplidos
  const percentage = total > 0 ? (cumplidos / total) * 100 : 0

  return {
    cumplidos,
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
    no_cumple: 'No cumple',
    na: 'N/A',
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
