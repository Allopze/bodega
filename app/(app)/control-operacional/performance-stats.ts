import type { SummaryStat } from "@/components/ui/summary-bar"

/**
 * Desempeño del período del Panel operacional: la tira editorial bajo los
 * tiles de atención y el glosario que la explica. Datos puros; la página los
 * pinta con `SummaryBar`.
 *
 * Lo que sólo mide el período (disponibilidad y cobertura del historial de
 * estado) vive aquí. Lo que está pasando hoy vive en los tiles de «Requiere atención».
 */

export interface PerformanceMetrics {
  availabilityPercent: number | null
  stateCoveragePercent: number | null
  /** Horas en taller del período; `null` si no se pudo calcular. Sólo se pinta con `canViewWorkOrders`. */
  workshopHours?: number | null
  /** Horas en taller de las reparaciones cerradas ÷ cuántas son; `null` sin reparaciones cerradas. */
  mttrHours?: number | null
}

export interface PerformancePermissions {
  canViewFleet: boolean
  /** `mant:ot:view_*`: sin ella no se pintan las cifras de órdenes de trabajo. */
  canViewWorkOrders?: boolean
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

/** Disponibilidad y cobertura son indicadores de Flota: sin `flota:view` no se pintan. */
export function buildPerformanceStats(metrics: PerformanceMetrics, permissions: PerformancePermissions): SummaryStat[] {
  const stats: SummaryStat[] = []
  const { canViewFleet, canViewWorkOrders = false } = permissions

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

  if (canViewWorkOrders) {
    const workshopHours = metrics.workshopHours ?? null
    stats.push({
      key: "workshop-hours",
      label: "Horas en taller",
      value: formatKpi(workshopHours, " h", 0),
      valueKind: workshopHours == null ? "text" : "number",
      secondary: workshopHours == null ? "No se pudo calcular" : "Ingreso a salida de taller, dentro del período",
    })
    const mttrHours = metrics.mttrHours ?? null
    stats.push({
      key: "mttr",
      label: "Tiempo de reparación (MTTR)",
      value: formatKpi(mttrHours, " h", 1),
      valueKind: mttrHours == null ? "text" : "number",
      secondary: mttrHours == null ? "Sin reparaciones cerradas en el período" : "Horas en taller por reparación cerrada",
    })
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
  canViewInspections?: boolean
  canViewCapa?: boolean
  canViewFuel?: boolean
  canViewCosts?: boolean
  canViewWorkOrders?: boolean
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
  if (permissions.canViewWorkOrders) {
    entries.push(
      {
        key: "workshop-hours",
        term: "Horas en taller",
        definition:
          "Horas que los equipos pasaron en el taller dentro del período, desde el ingreso a taller de cada orden de trabajo hasta su salida (o hasta ahora, si siguen dentro). Una orden que cruza el límite del período cuenta sólo la parte que cae dentro. No incluye las anuladas.",
      },
      {
        key: "mttr",
        term: "MTTR · tiempo medio de reparación (Mean Time To Repair)",
        definition:
          "Promedio de horas en taller, del ingreso a la salida, de las órdenes de reparación cerradas (con conformidad de la faena) dentro del período. Sin ninguna reparación cerrada no hay qué promediar y se muestra «Sin datos». Una cifra alta sugiere repuestos, mano de obra o aprobaciones frenando el retorno del equipo.",
      },
    )
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
