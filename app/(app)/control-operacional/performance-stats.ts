import type { SummaryStat } from "@/components/ui/summary-bar"

export interface PerformanceMetrics {
  availabilityPercent: number | null
}

export interface PerformancePermissions {
  canViewFleet: boolean
}

export function formatKpi(value: number | null, suffix = "", precision = 1): string {
  if (value == null) return "Sin datos"
  return `${value.toLocaleString("es-CL", { maximumFractionDigits: precision })}${suffix}`
}

function belowThreshold(value: number | null, thresholds: { danger: number; warning: number }) {
  if (value == null) return {}
  if (value < thresholds.danger) return { tone: "danger" as const, toneWhenZero: true, hint: `Bajo ${thresholds.danger}%` }
  if (value < thresholds.warning) return { tone: "signal" as const, toneWhenZero: true, hint: `Bajo ${thresholds.warning}%` }
  return {}
}

export const AVAILABILITY_THRESHOLDS = { danger: 80, warning: 90 }

export function buildPerformanceStats(metrics: PerformanceMetrics, permissions: PerformancePermissions): SummaryStat[] {
  if (!permissions.canViewFleet) return []
  const hasData = metrics.availabilityPercent != null
  return [{
    key: "availability",
    label: "Disponibilidad",
    value: formatKpi(metrics.availabilityPercent, "%"),
    valueKind: hasData ? "number" : "text",
    secondary: hasData ? "Horas operativas / horas con estado registrado" : "Sin datos en el período",
    ...belowThreshold(metrics.availabilityPercent, AVAILABILITY_THRESHOLDS),
  }]
}

export interface GlossaryEntry {
  key: string
  term: string
  definition: string
}

export function buildPerformanceGlossary(permissions: PerformancePermissions): GlossaryEntry[] {
  if (!permissions.canViewFleet) return []
  return [{
    key: "availability",
    term: "Disponibilidad",
    definition:
      "Porcentaje de horas del período en que los vehículos se mantuvieron operativos, sobre las horas cubiertas por el historial de estado del equipo. Sin vehículos activos o sin intervalos registrados, el indicador devuelve 'Sin datos' en lugar de 0%.",
  }]
}
