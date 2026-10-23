import type { SummaryStat } from "@/components/ui/summary-bar"
import { formatCLP } from "@/lib/utils"

/**
 * Desempeño del período del Panel operacional: la tira editorial bajo los
 * tiles de atención y el glosario que la explica. Datos puros; la página los
 * pinta con `SummaryBar`.
 *
 * Lo que sólo mide el período (disponibilidad, MTBF, MTTR, cumplimiento
 * preventivo, horas de detención, costo, OT abiertas con fecha en el rango) vive
 * aquí. Lo que está pasando hoy vive en los tiles de «Requiere atención».
 */

export interface PerformanceMetrics {
  availabilityPercent: number | null
  mtbfHours: number | null
  mttrHours: number | null
  preventiveCompliancePercent: number | null
  downtimeHours: number
  backlog: number
  maintenanceCost: number | null
}

export interface PerformancePermissions {
  canViewFleet: boolean
  canViewMaintenance: boolean
  canViewCosts: boolean
}

export function formatKpi(value: number | null, suffix = "", precision = 1): string {
  if (value == null) return "Sin datos"
  return `${value.toLocaleString("es-CL", { maximumFractionDigits: precision })}${suffix}`
}

/**
 * Umbrales de alerta: bajo `danger` es crítico y bajo `warning`, en observación.
 * `SummaryBar` sólo conoce el naranja «signal», así que ambos niveles lo usan y
 * el umbral cruzado se escribe en el `hint`: el color solo no puede ser la
 * única señal.
 */
function belowThreshold(value: number | null, thresholds: { danger: number; warning: number }) {
  if (value == null) return {}
  const crossed = value < thresholds.danger ? thresholds.danger : value < thresholds.warning ? thresholds.warning : null
  return crossed == null ? {} : { tone: "signal" as const, hint: `Bajo ${crossed}%` }
}

export const AVAILABILITY_THRESHOLDS = { danger: 80, warning: 90 }
export const PREVENTIVE_THRESHOLDS = { danger: 70, warning: 90 }

/** Cada cifra conserva su gating: disponibilidad es de Flota; el resto, de Mantenciones; el costo, además de costos. */
export function buildPerformanceStats(metrics: PerformanceMetrics, permissions: PerformancePermissions): SummaryStat[] {
  const stats: SummaryStat[] = []
  const { canViewFleet, canViewMaintenance, canViewCosts } = permissions

  if (canViewFleet) {
    const hasData = metrics.availabilityPercent != null
    stats.push({
      key: "availability",
      label: "Disponibilidad",
      value: formatKpi(metrics.availabilityPercent, "%"),
      valueKind: hasData ? "number" : "text",
      secondary: hasData ? "Horas operativas / horas con estado registrado" : "Sin datos en el período",
      ...belowThreshold(metrics.availabilityPercent, AVAILABILITY_THRESHOLDS),
    })
  }

  if (canViewMaintenance) {
    stats.push(
      {
        key: "mtbf",
        label: "Tiempo entre fallas (MTBF)",
        value: formatKpi(metrics.mtbfHours, " h", 0),
        valueKind: metrics.mtbfHours == null ? "text" : "number",
        secondary: "Promedio entre correctivas completadas",
      },
      {
        key: "mttr",
        label: "Tiempo de reparación (MTTR)",
        value: formatKpi(metrics.mttrHours, " h", 1),
        valueKind: metrics.mttrHours == null ? "text" : "number",
        secondary: "Detención promedio por correctiva",
      },
      {
        key: "preventive",
        label: "Cumplimiento preventivo",
        value: formatKpi(metrics.preventiveCompliancePercent, "%"),
        valueKind: metrics.preventiveCompliancePercent == null ? "text" : "number",
        secondary: "OT preventivas completadas / programadas",
        ...belowThreshold(metrics.preventiveCompliancePercent, PREVENTIVE_THRESHOLDS),
      },
      {
        key: "downtime",
        label: "Horas de detención",
        value: formatKpi(metrics.downtimeHours, " h", 0),
        secondary: "Por mantenciones del período",
      },
      {
        // B-04: sólo cuenta OT de vehículos (los instrumentos de servicio aún no
        // modelan OT) con fecha dentro del período. No es la cifra de «OT
        // abiertas» de los tiles, que cuenta todas las de hoy sin importar la fecha.
        key: "period-backlog",
        label: "OT abiertas del período",
        value: metrics.backlog.toLocaleString("es-CL"),
        secondary: "OT de vehículos con fecha en el período",
      },
    )
    if (canViewCosts) {
      stats.push({
        key: "cost",
        label: "Costo de mantenciones",
        value: formatCLP(metrics.maintenanceCost ?? 0),
        secondary: "OT no canceladas del período",
      })
    }
  }

  return stats
}

export interface GlossaryEntry {
  key: string
  term: string
  definition: string
}

/**
 * Las definiciones que antes viajaban en el tooltip de cada tile. `SummaryBar`
 * no tiene tooltip y un tooltip no se lee en pantallas táctiles, así que quedan
 * a la vista bajo «Cómo se calculan estas cifras».
 */
export function buildPerformanceGlossary(permissions: Pick<PerformancePermissions, "canViewFleet" | "canViewMaintenance">): GlossaryEntry[] {
  const entries: GlossaryEntry[] = []
  if (permissions.canViewFleet) {
    entries.push({
      key: "availability",
      term: "Disponibilidad",
      definition:
        "Porcentaje de horas del período en que los vehículos se mantuvieron operativos, sobre las horas cubiertas por el historial de estado del equipo. Sin vehículos activos o sin intervalos registrados, el indicador devuelve 'Sin datos' en lugar de 0%.",
    })
  }
  if (permissions.canViewMaintenance) {
    entries.push(
      {
        key: "mtbf",
        term: "MTBF · tiempo medio entre fallas (Mean Time Between Failures)",
        definition:
          "Horas operativas promedio entre dos mantenciones correctivas completadas dentro del período. Útil para comparar con la cadencia objetivo por equipo.",
      },
      {
        key: "mttr",
        term: "MTTR · tiempo medio de reparación (Mean Time To Repair)",
        definition:
          "Horas promedio de detención por mantención correctiva completada en el período. Una cifra alta sugiere piezas, mano de obra o aprobaciones que están frenando el retorno a operación.",
      },
      {
        key: "preventive",
        term: "Cumplimiento preventivo",
        definition:
          "Porcentaje de mantenciones preventivas no canceladas que se cerraron como completadas dentro del período. Bajo 70% abre una alerta para revisar capacidad del equipo de planificación.",
      },
    )
  }
  return entries
}
