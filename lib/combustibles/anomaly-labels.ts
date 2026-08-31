/** Vocabulario y reglas de presentación de casos de anomalía.
 *
 * Este módulo no importa la base de datos: también lo consumen componentes
 * client-side que sólo necesitan labels, colores o variants.
 */
export type AnomalyCaseStatus = "open" | "in_review" | "resolved" | "dismissed" | "reopened"
export type AnomalySeverity = "low" | "medium" | "high" | "critical"

export const ANOMALY_STATUS_LABELS: Record<AnomalyCaseStatus, string> = {
  open: "Abierto",
  in_review: "En revisión",
  resolved: "Resuelto",
  dismissed: "Descartado",
  reopened: "Reabierto",
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

export const ANOMALY_STATUS_COLORS: Record<AnomalyCaseStatus, string> = {
  open: "var(--color-danger)",
  in_review: "var(--color-warning)",
  resolved: "var(--color-success)",
  dismissed: "var(--color-text-muted)",
  reopened: "var(--color-signal)",
}

/**
 * Reglas cuyo cierre aguas abajo significa "la serie del medidor se reinició
 * acá": Flota deja de usar la lectura anterior como inicio del período y
 * Mantenciones deja de comparar contra una mantención previa al corte.
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
