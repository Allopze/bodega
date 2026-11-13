import type { SummaryStat } from "@/components/ui/summary-bar"

/**
 * Desempeño del período del Panel operacional: una tira de texto compacta con
 * tres cifras (disponibilidad, horas en taller y tiempo de reparación) y el
 * glosario que la explica. Datos puros; la página los pinta con `SummaryBar compact`.
 *
 * Lo que sólo mide el período vive aquí. Lo que está pasando hoy vive en los
 * tiles de «Requiere atención», fuera de la zona que gobierna el selector de
 * período. Licencias y canales de combustible no se repiten aquí: tienen su
 * propia pantalla y, el segundo, su fila en «Cruces».
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

/** Bajo este porcentaje de cobertura del historial de estado, la disponibilidad lo avisa. */
const COVERAGE_WARNING = 80

/**
 * Disponibilidad (con su cobertura de historial al lado: una disponibilidad alta
 * sobre una cobertura baja no representa al período), horas en taller y tiempo
 * de reparación. La disponibilidad es de Flota: sin `flota:view` no se pinta.
 */
export function buildPerformanceStats(metrics: PerformanceMetrics, permissions: PerformancePermissions): SummaryStat[] {
  const stats: SummaryStat[] = []
  const { canViewFleet, canViewWorkOrders = false } = permissions

  if (canViewFleet) {
    const hasData = metrics.availabilityPercent != null
    const threshold = belowThreshold(metrics.availabilityPercent, AVAILABILITY_THRESHOLDS)
    // Una disponibilidad sobre un historial incompleto no representa al período:
    // sólo se avisa cuando la cobertura es baja; la definición completa vive en el glosario.
    const coverage = metrics.stateCoveragePercent != null && metrics.stateCoveragePercent < COVERAGE_WARNING
      ? `historial al ${formatKpi(metrics.stateCoveragePercent, "%", 0)}`
      : null
    const hint = [threshold.hint, hasData ? coverage : null].filter(Boolean).join(" · ")
    stats.push({
      key: "availability",
      label: "Disponibilidad",
      value: formatKpi(metrics.availabilityPercent, "%"),
      valueKind: hasData ? "number" : "text",
      secondary: hasData ? "Horas operativas / horas con estado registrado" : "Sin datos en el período",
      ...threshold,
      ...(hint ? { hint } : {}),
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
      label: "Tiempo de reparación",
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
  /** `purchasing:view`: abre la definición de las compras vinculadas y la del costo total. */
  canViewPurchaseCosts?: boolean
  /** `combustibles:tae_view`: define la fila «Combustible por canal» de «Cruces». */
  canViewTaeCoverage?: boolean
  /** Lecturas y pautas de mantención: habilita la definición de la estimación GPS. */
  canViewMaintenance?: boolean
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
          "Parte del calendario de los equipos activos que cubre el historial de estado. Una disponibilidad alta sobre una cobertura baja no representa al período completo; por eso la disponibilidad avisa cuando el historial cubre menos del 80 %.",
      },
      {
        key: "gps-providers",
        term: "Fuentes GPS",
        definition:
          "Si un equipo reporta por OnWay y por Wialon se muestra una sola fila: la posición sale del mensaje más reciente y los medidores, de un solo proveedor. La fuente y la hora acompañan al dato; nunca se suman medidores de proveedores distintos.",
      },
    )
    if (permissions.canViewFuel) {
      entries.push({
        key: "gps-performance",
        term: "Rendimiento GPS",
        definition:
          "Avance del medidor GPS del período dividido por los litros operacionales. Se usa la primera fuente que cubra el período completo (Wialon o OnWay); si ninguna lo cubre no hay cifra. No se mezcla con la lectura Copec.",
      })
    }
    if (permissions.canViewMaintenance) {
      entries.push({
        key: "gps-maintenance",
        term: "Estimación GPS de mantención",
        definition:
          "Aplica la misma regla de intervalos de Mantención a la última lectura GPS, sólo cuando es más nueva que la lectura registrada. Es una referencia para programar: no reemplaza la lectura oficial ni cambia el estado del equipo.",
      })
    }
  }
  if (permissions.canViewTaeCoverage) {
    entries.push({
      key: "tae-tct-coverage",
      term: "Combustible por canal",
      definition:
        "Equipos que, en el período, tienen litros por abastecimiento de estanques pero no por la tarjeta Copec de equipos (o al revés). «Con ambos» son los que se pueden cuadrar por los dos canales. El detalle está en Cuadratura.",
    })
  }
  if (permissions.canViewWorkOrders) {
    entries.push(
      {
        key: "ot-maintenance-cost",
        term: "Mano de obra / taller externo (OT)",
        definition:
          "Suma del costo cargado a mano en las OT cerradas del período: mano de obra o taller externo. Los repuestos y servicios comprados por OC van en su propia cifra. Es opcional: una OT cerrada sin costo cargado suma $0, y un equipo sin OT cerradas en el período marca $0.",
      },
      {
        key: "workshop-hours",
        term: "Horas en taller",
        definition:
          "Horas que los equipos pasaron en el taller dentro del período, desde el ingreso a taller de cada orden de trabajo hasta su salida (o hasta ahora, si siguen dentro). Una orden que cruza el límite del período cuenta sólo la parte que cae dentro. No incluye las anuladas.",
      },
      {
        key: "mttr",
        term: "Tiempo medio de reparación",
        definition:
          "Promedio de horas en taller, del ingreso a la salida, de las órdenes de reparación cerradas (con conformidad de la faena) dentro del período. Sin ninguna reparación cerrada no hay qué promediar y se muestra «Sin datos». Una cifra alta sugiere repuestos, mano de obra o aprobaciones frenando el retorno del equipo.",
      },
    )
  }
  if (permissions.canViewPurchaseCosts) {
    entries.push({
      key: "vehicle-purchases",
      term: "Repuestos y servicios (OC)",
      definition:
        "Líneas de OC emitidas en el período de solicitudes de repuestos o servicios vinculadas al equipo, sin IVA, excluyendo OC anuladas.",
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
      {
        key: "open-findings-work-order",
        term: "Hallazgos con OT",
        definition:
          "Del total de hallazgos abiertos, los que tienen una orden de trabajo vigente vinculada. Los «sin OT» son trabajo correctivo detectado que todavía no entró a Mantención.",
      },
    )
  }
  if (permissions.canViewWorkOrders && permissions.canViewCosts && permissions.canViewPurchaseCosts) {
    entries.push({
      key: "ot-total-cost",
      term: "Costo total",
      definition:
        "Combustible del proveedor, mano de obra de OT cerradas y compras vinculadas. Un equipo sin movimientos en una de ellas aporta $0; si una serie no se pudo consultar, se deja «—» en vez de sumar un cero.",
    })
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
          "Horas con el motor encendido sin trabajar sobre las horas de funcionamiento de la telemetría del período. Se informa junto con los litros consumidos en vacío; sin telemetría se muestra «—», no se estima.",
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
        term: "Costo de combustible",
        definition:
          "Suma de las transacciones del proveedor (tarjetas y estanques) del período, con su estado contable. Es la misma serie que usan Flota y el Tablero. Puede no coincidir con los litros operacionales porque son series distintas: una mide consumo y la otra documento tributario.",
      })
    }
  }
  return entries
}
