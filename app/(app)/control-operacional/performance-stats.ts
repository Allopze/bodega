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
  stateCoveragePercent: number | null
  mtbfHours: number | null
  mttrHours: number | null
  preventiveCompliancePercent: number | null
  downtimeHours: number
  backlog: number
  maintenanceCost: number | null
  maintenanceCostApproved: number | null
  planAdherencePercent: number | null
  overdueSla: number
  unassignedOpen: number
}

export interface PerformancePermissions {
  canViewFleet: boolean
  canViewMaintenance: boolean
  canViewCosts: boolean
  canViewFuel?: boolean
}

export function formatKpi(value: number | null, suffix = "", precision = 1): string {
  if (value == null) return "Sin datos"
  return `${value.toLocaleString("es-CL", { maximumFractionDigits: precision })}${suffix}`
}

/**
 * Umbrales de alerta: bajo `danger` es crítico (rojo) y bajo `warning`, en
 * observación (naranja). El umbral cruzado también va escrito en el `hint`: el
 * color solo no puede ser la única señal. `toneWhenZero` porque aquí lo malo es
 * que la cifra sea baja: 0 % es el caso más grave y no puede quedar atenuado
 * como un «0» de conteo.
 */
function belowThreshold(value: number | null, thresholds: { danger: number; warning: number }) {
  if (value == null) return {}
  if (value < thresholds.danger) return { tone: "danger" as const, toneWhenZero: true, hint: `Bajo ${thresholds.danger}%` }
  if (value < thresholds.warning) return { tone: "signal" as const, toneWhenZero: true, hint: `Bajo ${thresholds.warning}%` }
  return {}
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
    const hasCoverage = metrics.stateCoveragePercent != null
    stats.push({
      key: "state-coverage",
      label: "Cobertura de estado",
      value: formatKpi(metrics.stateCoveragePercent, "%"),
      valueKind: hasCoverage ? "number" : "text",
      secondary: hasCoverage
        ? "Horas con historial / horas calendario de equipos activos"
        : "Sin equipos activos o sin historial",
    })
  }

  if (canViewMaintenance) {
    stats.push(
      {
        key: "mtbf",
        label: "Tiempo entre fallas (MTBF)",
        value: formatKpi(metrics.mtbfHours, " h", 0),
        valueKind: metrics.mtbfHours == null ? "text" : "number",
        secondary: "Flota: horas operativas / correctivas completadas",
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
        key: "plan-adherence",
        label: "Adherencia al plan",
        value: formatKpi(metrics.planAdherencePercent, "%"),
        valueKind: metrics.planAdherencePercent == null ? "text" : "number",
        secondary: "Planes con OT / planes del período",
      },
      {
        key: "downtime",
        label: "Horas de detención",
        value: formatKpi(metrics.downtimeHours, " h", 0),
        secondary: "Por mantenciones del período",
      },
      {
        key: "overdue-sla",
        label: "OT fuera de SLA",
        value: metrics.overdueSla.toLocaleString("es-CL"),
        secondary: "Programadas o en curso con SLA vencido",
      },
      {
        key: "unassigned",
        label: "OT sin responsable",
        value: metrics.unassignedOpen.toLocaleString("es-CL"),
        secondary: "Programadas o en curso sin asignar",
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
        label: "Costo aprobado",
        value: formatCLP(metrics.maintenanceCostApproved ?? 0),
        secondary: `Comprometido: ${formatCLP(metrics.maintenanceCost ?? 0)}`,
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
export function buildPerformanceGlossary(permissions: {
  canViewFleet: boolean
  canViewMaintenance: boolean
  canViewInspections?: boolean
  canViewCapa?: boolean
  canViewFuel?: boolean
  canViewCosts?: boolean
}): GlossaryEntry[] {
  const entries: GlossaryEntry[] = []
  if (permissions.canViewFleet) {
    entries.push(
      {
        key: "availability",
        term: "Disponibilidad",
        definition:
          "Porcentaje de horas del período en que los vehículos se mantuvieron operativos, sobre las horas cubiertas por el historial de estado del equipo. Sin vehículos activos o sin intervalos registrados, el indicador devuelve 'Sin datos' en lugar de 0%.",
      },
      {
        key: "state-coverage",
        term: "Cobertura de estado",
        definition:
          "Parte del calendario de los equipos activos que cubre el historial de estado. Una disponibilidad alta sobre una cobertura baja no representa al período completo; por eso se muestran las dos cifras.",
      },
    )
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
      {
        key: "plan-adherence",
        term: "Adherencia al plan",
        definition:
          "Planes preventivos activos que vencen en el período y que tienen al menos una OT no cancelada, sobre el total de planes que vencen. Mide el plan, no sólo las OT que ya existen.",
      },
      {
        key: "overdue-sla",
        term: "OT fuera de SLA",
        definition:
          "OT programadas o en curso cuya fecha límite de atención ya pasó. No incluye las completadas ni las canceladas.",
      },
      {
        key: "unassigned",
        term: "OT sin responsable",
        definition:
          "OT programadas o en curso que todavía no tienen una persona asignada. Una OT sin responsable no tiene a quién escalar.",
      },
    )
  }
  if (permissions.canViewMaintenance && permissions.canViewCosts) {
    entries.push({
      key: "maintenance-cost",
      term: "Costo aprobado y comprometido",
      definition:
        "El costo aprobado suma las OT completadas con costo aprobado o que no requerían aprobación. El comprometido suma todas las OT no canceladas, incluidas las programadas y las pendientes de aprobación; no son la misma cifra.",
    })
  }
  if (permissions.canViewInspections) {
    entries.push(
      {
        key: "inspection-compliance",
        term: "Cumplimiento de inspecciones",
        definition:
          "Promedio del cumplimiento de las inspecciones no canceladas programadas en el período. Una inspección sin porcentaje calculado no entra al promedio; esta cifra no mide los hallazgos que siguen abiertos.",
      },
      {
        key: "open-findings",
        term: "Hallazgos abiertos",
        definition:
          "Hallazgos de inspección en estado abierto o vinculados a CAPA, de inspecciones no canceladas. Es trabajo vigente: no se recorta al período. El número entre paréntesis cuenta los críticos.",
      },
    )
  }
  if (permissions.canViewInspections && permissions.canViewCapa) {
    entries.push({
      key: "overdue-capa",
      term: "CAPA vencidas",
      definition:
        "Acciones correctivas vinculadas a hallazgos de inspección que no están cerradas ni canceladas y cuya fecha objetivo ya pasó. Se cuentan aunque el hallazgo de origen ya esté cerrado: la acción sigue pendiente.",
    })
  }
  if (permissions.canViewFuel) {
    entries.push(
      {
        key: "fuel-liters",
        term: "Litros operacionales",
        definition:
          "Litros de las cargas que cuentan en el período: sin anuladas, duplicadas ni rechazadas. Es la serie operacional de Control de combustible; no es el total facturado del período.",
      },
      {
        key: "fuel-performance",
        term: "Rendimiento promedio",
        definition:
          "Promedio de las cargas válidas del período, en km/L para equipos con odómetro o L/h para equipos con horómetro. Es el mismo criterio de la ficha del equipo; no es una eficiencia ponderada por litros. Las cargas marcadas, rechazadas y anuladas no entran.",
      },
      {
        key: "fuel-idle",
        term: "Motor en vacío",
        definition:
          "Horas con el motor encendido sin trabajar sobre las horas de funcionamiento de la telemetría del período (Σ vacío ÷ Σ funcionamiento). Se informa junto con los litros consumidos en vacío; sin telemetría se muestra «—», no se estima.",
      },
      {
        key: "fuel-gps-mismatch",
        term: "Discrepancia GPS",
        definition:
          "La lectura de la última carga y la telemetría del mismo medidor difieren más de 2 horas (horómetro) o 5 kilómetros (odómetro), con lecturas a menos de 7 días. Es una señal para revisar la lectura, no un error confirmado.",
      },
    )
    if (permissions.canViewCosts) {
      entries.push({
        key: "fuel-cost",
        term: "Costo facturado",
        definition:
          "Suma de las cargas facturadas del período, con su estado contable. Puede no coincidir con los litros operacionales porque son series distintas: una mide consumo y la otra documento tributario.",
      })
    }
  }
  return entries
}
