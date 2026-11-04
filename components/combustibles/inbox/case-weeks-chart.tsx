"use client"

import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig, type ChartTooltipItem } from "@/components/ui/chart"
import { ANOMALY_SEVERITY_COLORS, ANOMALY_SEVERITY_LABELS } from "@/lib/combustibles/anomaly-labels"
import { anomalyWeekRangeLabel, visibleSeverities, type AnomalyWeek } from "@/lib/combustibles/inbox/case-weeks"
import { useChartMotion } from "@/components/ui/chart-interactions"

/**
 * Casos de anomalía detectados por semana, apilados por gravedad (CHART-023b).
 *
 * El dibujo va dentro de un `ChartSection` (figura con nombre, frase que responde y
 * «Ver datos»): él es la alternativa en datos, así que aquí no hay texto aparte.
 * La semana en curso todavía no termina, así que su columna se dibuja tenue y
 * punteada —el mismo gesto del mes parcial del tablero— y no se lee como una caída.
 */

const WEEK_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 }
const PARTIAL_FILL_OPACITY = 0.4
const PARTIAL_DASH = "4 3"

/** Columna de una semana: la parcial va tenue, con contorno punteado del color de su capa. */
function WeekBar(props: BarShapeProps) {
  const partial = (props.payload as AnomalyWeek | undefined)?.partial === true
  return <Rectangle {...props} {...(partial ? { fillOpacity: PARTIAL_FILL_OPACITY, stroke: props.fill, strokeWidth: 1.5, strokeDasharray: PARTIAL_DASH } : {})} />
}

/** Encabezado del tooltip: «Semana del 26 oct al 1 nov», y «· en curso» si todavía no termina. */
function weekTooltipTitle(_label: unknown, payload: ChartTooltipItem[]) {
  const week = payload[0]?.payload as AnomalyWeek | undefined
  if (!week) return null
  return `Semana del ${anomalyWeekRangeLabel(week.weekStart)}${week.partial ? " · en curso" : ""}`
}

export function CaseWeeksChart({ weeks }: { weeks: AnomalyWeek[] }) {
  const motion = useChartMotion()
  const severities = visibleSeverities(weeks)
  const config = Object.fromEntries(severities.map((severity) => [severity, { label: ANOMALY_SEVERITY_LABELS[severity] }])) satisfies ChartConfig
  const hasPartial = weeks.some((week) => week.partial)
  return (
    <div>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <BarChart aria-label="Casos de anomalía por semana, apilados por gravedad" data={weeks} margin={WEEK_MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={{ fontSize: 11 }} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" labelFormatter={weekTooltipTitle} />} />
          <ChartLegend content={<ChartLegendContent />} />
          {severities.map((severity) => (
            <Bar key={severity} dataKey={severity} stackId="semana" fill={ANOMALY_SEVERITY_COLORS[severity]} shape={WeekBar} {...motion} />
          ))}
        </BarChart>
      </ChartContainer>
      {hasPartial ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">La última columna, punteada, es la semana en curso: todavía no termina.</p> : null}
    </div>
  )
}
