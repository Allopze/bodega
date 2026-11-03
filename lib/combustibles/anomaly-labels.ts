/** Vocabulario y reglas de presentación de casos de anomalía.
 *
 * Este módulo no importa la base de datos: también lo consumen componentes
 * client-side que sólo necesitan labels, colores o variants.
 */
export type AnomalyCaseStatus = "open" | "in_review" | "resolved" | "dismissed" | "reopened"
export type AnomalySeverity = "low" | "medium" | "high" | "critical"

export const ANOMALY_STATUS_LABELS: Record<AnomalyCaseStatus, string> = {
  open: "Abierto",
  // «Tomada»: alguien es responsable. «En revisión» se confundía con las cargas por decidir.
  in_review: "Tomada",
  resolved: "Resuelto",
  dismissed: "Descartado",
  reopened: "Reabierto",
}

/**
 * Los estados de un caso que siguen pidiendo a una persona: los que lista «Por
 * revisar» y los que la ficha de una carga cuenta como «abiertos». `resolved` y
 * `dismissed` son los cerrados (viven en «Decididas»).
 */
export const OPEN_ANOMALY_CASE_STATUSES = ["open", "in_review", "reopened"] as const
export type OpenAnomalyCaseStatus = (typeof OPEN_ANOMALY_CASE_STATUSES)[number]

export function isOpenAnomalyCaseStatus(value: string | null | undefined): value is OpenAnomalyCaseStatus {
  return (OPEN_ANOMALY_CASE_STATUSES as readonly string[]).includes(value ?? "")
}

export const ANOMALY_SEVERITY_LABELS: Record<AnomalySeverity, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
}

export function anomalySeverityVariant(severity: AnomalySeverity): "danger" | "warning" | "info" {
  if (severity === "high" || severity === "critical") return "danger"
  if (severity === "medium") return "warning"
  return "info"
}

/**
 * Relleno de cada gravedad en los gráficos. Va de menos a más grave, en el mismo
 * sentido que las insignias (`anomalySeverityVariant`: baja → neutro, media →
 * ámbar, alta → rojo) y por luminancia creciente: «crítica» es el rojo más oscuro,
 * no un tono nuevo. Sólo tokens; el color no es lo único que lo dice (cada capa
 * tiene su rótulo y «Ver datos»).
 */
export const ANOMALY_SEVERITY_COLORS: Record<AnomalySeverity, string> = {
  low: "var(--color-chart-reference)",
  medium: "var(--color-warning)",
  high: "var(--color-danger)",
  critical: "var(--color-danger-ink)",
}

/**
 * Reglas cuyo cierre significa que la serie del medidor se reinició acá.
 */
export const METER_RESET_RULE_CODES = ["kilometraje_regresivo", "horometro_regresivo"] as const

/**
 * Por qué se cierra un caso de medidor. Es la diferencia entre "el número
 * estaba mal escrito" y "el medidor físico cambió", que hasta ahora el sistema
 * no distinguía: cerrar un error de tipeo cortaba la serie del equipo para
 * siempre e inflaba —o volvía negativo— el recorrido calculado.
 */
export const METER_RESOLUTION_KINDS = ["lectura_corregida", "reset_medidor"] as const
export type MeterResolutionKind = (typeof METER_RESOLUTION_KINDS)[number]

export const METER_RESOLUTION_KIND_LABELS: Record<MeterResolutionKind, string> = {
  lectura_corregida: "Error de lectura: el número estaba mal anotado",
  reset_medidor: "Medidor reemplazado o reiniciado: la serie parte de nuevo",
}

export function requiresMeterResolutionKind(ruleCode: string): boolean {
  return (METER_RESET_RULE_CODES as readonly string[]).includes(ruleCode)
}
