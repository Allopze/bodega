export const AGENT_TYPE_LABELS: Record<string, string> = {
  chemical: "Químico",
  physical: "Físico",
  biological: "Biológico",
  ergonomic: "Ergonómico",
  psychosocial: "Psicosocial",
}

export const MEASUREMENT_OUTCOME_LABELS: Record<string, string> = {
  below_action: "Bajo el nivel de acción",
  above_action: "Sobre el nivel de acción",
  above_limit: "Sobre el límite permisible",
  not_comparable: "No comparable",
}

export const SURVEILLANCE_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  summoned: "Citado",
  attended: "Asistió",
  absent: "Ausente",
  exempt: "Exento",
}

/**
 * El texto exacto con el que la migración `0323_medical_shocker.sql` marcó
 * las exenciones de vigilancia previas a exigir motivo (CAPA-002/0284 es el
 * mismo precedente). Fuente única: la migración ya publicada no se edita
 * (regla de `db/migrations/README.md`), así que este es el lado que puede
 * seguir cambiando si hiciera falta, y `prevention-surveillance-exempt-migration.test.ts`
 * verifica que el literal SQL coincide con esta constante.
 *
 * `subject-registry.ts` la usa para excluir del descuento del padrón de
 * expuestos las exenciones legado que sólo tienen esta procedencia y no una
 * justificación clínica real: fueron una declaración humana de "no consta por
 * qué se eximió", no de "se eximió por esto". Contarlas como descuento infla
 * el cumplimiento sin evidencia (Rule Priority #1, integridad de datos).
 */
export const LEGACY_SURVEILLANCE_EXEMPT_REASON_PLACEHOLDER =
  "Exención registrada antes de exigir motivo: no consta por qué se eximió."

export const PROGRAM_STATUS_LABELS: Record<string, string> = {
  active: "Vigente",
  suspended: "Suspendido",
  closed: "Cerrado",
}

export function measurementOutcomeBadgeVariant(outcome: string): "success" | "warning" | "danger" | "outline" {
  if (outcome === "below_action") return "success"
  if (outcome === "above_action") return "warning"
  if (outcome === "above_limit") return "danger"
  return "outline"
}

export interface AgentLimit {
  permissibleLimit: number | null
  actionLevelFactor: number
}

export interface MeasurementAssessment {
  outcome: "below_action" | "above_action" | "above_limit" | "not_comparable"
  actionLevel: number | null
  /** `true` cuando el resultado obliga a incorporar el GES a vigilancia. */
  triggersSurveillance: boolean
}

/**
 * Compara una medición contra el límite permisible del agente y su nivel de
 * acción.
 *
 * Un agente sin límite declarado devuelve `not_comparable`, no «cumple»: no
 * poder comparar no es lo mismo que estar bajo el límite. Eso deja el vacío
 * visible en vez de producir un falso conforme.
 *
 * Superar el nivel de acción ya obliga a vigilancia; no se espera a superar el
 * límite permisible, que es el criterio del DS 594 y de los protocolos.
 */
export function assessMeasurement(value: number, agent: AgentLimit): MeasurementAssessment {
  if (agent.permissibleLimit === null || agent.permissibleLimit <= 0) {
    return { outcome: "not_comparable", actionLevel: null, triggersSurveillance: false }
  }
  const actionLevel = agent.permissibleLimit * agent.actionLevelFactor
  if (value > agent.permissibleLimit) {
    return { outcome: "above_limit", actionLevel, triggersSurveillance: true }
  }
  if (value >= actionLevel) {
    return { outcome: "above_action", actionLevel, triggersSurveillance: true }
  }
  return { outcome: "below_action", actionLevel, triggersSurveillance: false }
}

export interface MeasurementRow {
  measuredOn: string
  outcome: string
}

/**
 * Decide si el GES debe estar bajo vigilancia según su historial de
 * mediciones. Manda la medición más reciente: una campaña posterior bajo el
 * nivel de acción es la que refleja la condición actual, pero una lectura
 * antigua sobre el límite no se borra sola —queda en el fundamento— para que
 * la salida de vigilancia sea una decisión explícita y no un olvido.
 */
export function deriveSurveillanceObligation(measurements: MeasurementRow[]): {
  required: boolean
  basis: string
} {
  if (measurements.length === 0) {
    return { required: false, basis: "Sin mediciones registradas para el grupo." }
  }
  const sorted = [...measurements].sort((a, b) => b.measuredOn.localeCompare(a.measuredOn))
  const latest = sorted[0]!
  const everExceeded = sorted.some((item) => item.outcome === "above_limit" || item.outcome === "above_action")

  if (latest.outcome === "above_limit") {
    return { required: true, basis: `La medición del ${latest.measuredOn} superó el límite permisible.` }
  }
  if (latest.outcome === "above_action") {
    return { required: true, basis: `La medición del ${latest.measuredOn} superó el nivel de acción.` }
  }
  if (latest.outcome === "not_comparable") {
    return { required: everExceeded, basis: `La medición del ${latest.measuredOn} no es comparable: el agente no tiene límite declarado.` }
  }
  return {
    required: false,
    basis: everExceeded
      ? `La última medición (${latest.measuredOn}) está bajo el nivel de acción, pero hubo excedencias previas: la salida de vigilancia debe decidirse expresamente.`
      : `La última medición (${latest.measuredOn}) está bajo el nivel de acción.`,
  }
}

/** Meses entre exámenes según periodicidad del programa. */
export function nextSurveillanceDate(fromDate: string, periodicityMonths: number): string {
  const [year, month, day] = fromDate.split("-").map(Number)
  if (!year || !month || !day) throw new Error("Fecha inválida para calcular la próxima vigilancia.")
  const target = new Date(Date.UTC(year, month - 1 + periodicityMonths, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString().slice(0, 10)
}

/** Tamaño mínimo de grupo para publicar un agregado sin permitir reidentificar. */
export const MIN_ANONYMOUS_GROUP_SIZE = 5

export interface AnonymizedExposureSummary {
  groupId: string
  groupName: string
  agentName: string
  exposedCount: number
  latestOutcome: string | null
  /** `null` cuando el grupo es demasiado pequeño para publicar sin reidentificar. */
  attendanceRate: number | null
  suppressed: boolean
}

/**
 * Agrega el estado de vigilancia por GES sin exponer personas.
 *
 * Los grupos con menos de `MIN_ANONYMOUS_GROUP_SIZE` integrantes se suprimen,
 * igual que la desagregación por sexo de los indicadores DS 44: en un grupo de
 * dos, decir «50 % asistió» identifica a una persona concreta y su vínculo con
 * un programa de vigilancia, que es dato de salud.
 */
export function summarizeExposureAnonymized(groups: {
  groupId: string
  groupName: string
  agentName: string
  exposedCount: number
  attendedCount: number
  latestOutcome: string | null
}[]): AnonymizedExposureSummary[] {
  return groups.map((group) => {
    const suppressed = group.exposedCount < MIN_ANONYMOUS_GROUP_SIZE
    return {
      groupId: group.groupId,
      groupName: group.groupName,
      agentName: group.agentName,
      exposedCount: group.exposedCount,
      latestOutcome: group.latestOutcome,
      attendanceRate: suppressed || group.exposedCount === 0
        ? null
        : Math.round((group.attendedCount / group.exposedCount) * 100),
      suppressed,
    }
  })
}
