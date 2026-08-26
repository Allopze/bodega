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
