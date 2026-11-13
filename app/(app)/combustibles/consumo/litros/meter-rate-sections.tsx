import type { ChartDataExcel } from "@/components/charts/chart-data-table"
import { ChartSection } from "@/components/charts/chart-section"
import { PERFORMANCE_UNIT_LABELS, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { describeMeterRate, type MeterRateSeries } from "@/lib/combustibles/meter-rate-series"
import { meterRateNotes, meterRateTable } from "@/lib/combustibles/meter-rate-view"
import { MeterRateChart } from "../_components/charts/overview-charts-lazy"

const TITLES: Record<PerformanceUnit, string> = {
  km_per_liter: "Equipos con odómetro · km/L",
  liters_per_hour: "Equipos con horómetro · L/h",
}

/**
 * CHART-016: el rendimiento de cada mes, una unidad por gráfico (km/L de los equipos
 * con odómetro, L/h de los de horómetro). Sale de las lecturas de medidor del
 * detalle de Copec, no de las cargas en terreno: en producción esas son 0 y las
 * lecturas son miles (fase 0b.5).
 *
 * Sólo se dibuja la unidad que tiene lecturas; si no hay de ninguna, un solo estado
 * vacío con el camino para llenarlo (A4) en vez de dos gráficos vacíos.
 */
export function MeterRateSections({ series, sourcesHref, excel }: { series: Record<PerformanceUnit, MeterRateSeries>; sourcesHref: string; excel?: ChartDataExcel }) {
  const units = (["km_per_liter", "liters_per_hour"] as const).filter((unit) => series[unit].status !== "empty")

  if (units.length === 0) {
    return (
      <ChartSection
        headingLevel={3}
        title="Rendimiento mensual de los equipos"
        empty={{
          label: "Todavía no hay lecturas de odómetro ni de horómetro de Copec",
          hint: "El rendimiento sale de la lectura del medidor que trae cada carga con tarjeta Copec, en el detalle de la integración. Aparece cuando la integración trae cargas de equipos con lectura.",
          ctaLabel: "Ver el estado de las fuentes",
          ctaHref: sourcesHref,
        }}
      />
    )
  }

  return (
    <div className={units.length > 1 ? "grid gap-8 xl:grid-cols-2" : "grid gap-8"}>
      {units.map((unit) => {
        const data = series[unit]
        const table = meterRateTable(data)
        return (
          <ChartSection
            key={unit}
            headingLevel={3}
            title={TITLES[unit]}
            summary={describeMeterRate(data)}
            data={{ caption: `Rendimiento mensual en ${PERFORMANCE_UNIT_LABELS[unit]}`, headers: table.headers, rows: table.rows, excel }}
          >
            <MeterRateChart series={data} />
            <ul className="mt-2 grid gap-0.5 text-xs text-[var(--color-text-muted)]">
              {meterRateNotes(data).map((note) => <li key={note}>{note}</li>)}
            </ul>
          </ChartSection>
        )
      })}
    </div>
  )
}
