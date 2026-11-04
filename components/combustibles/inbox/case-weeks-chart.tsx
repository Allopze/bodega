"use client"

import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, Rectangle, ReferenceLine, XAxis, YAxis, type BarShapeProps } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig, type ChartTooltipItem } from "@/components/ui/chart"
import { CHART_COLORS } from "@/lib/chart-palette"
import { ANOMALY_SEVERITY_COLORS, ANOMALY_SEVERITY_LABELS } from "@/lib/combustibles/anomaly-labels"
import { anomalyWeekRangeLabel, ruleChangesByWeek, ruleChangesText, visibleSeverities, type AnomalyRuleChange, type AnomalyWeek } from "@/lib/combustibles/inbox/case-weeks"
import { useChartMotion } from "@/components/ui/chart-interactions"

/**
 * Casos de anomalía detectados por semana, apilados por gravedad (CHART-023b).
 *
 * El dibujo va dentro de un `ChartSection` (figura con nombre, frase que responde y
 * «Ver datos»): él es la alternativa en datos, así que aquí no hay texto aparte.
 * La semana en curso todavía no termina, así que su columna se dibuja tenue y
 * punteada —el mismo gesto del mes parcial del tablero— y no se lee como una caída.
 *
 * Las semanas en que una regla de detección se creó o se modificó llevan una línea
 * vertical punteada (P-6): un salto de casos justo ahí puede ser el instrumento y no un
 * problema real. La línea es sólo la pista visual: el detalle, con el nombre de la regla
 * y el día, va en el tooltip y en la columna «Cambios de reglas» de «Ver datos».
 */

const WEEK_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 }
const PARTIAL_FILL_OPACITY = 0.4
const PARTIAL_DASH = "4 3"

/** Columna de una semana: la parcial va tenue, con contorno punteado del color de su capa. */
function WeekBar(props: BarShapeProps) {
  const partial = (props.payload as AnomalyWeek | undefined)?.partial === true
  return <Rectangle {...props} {...(partial ? { fillOpacity: PARTIAL_FILL_OPACITY, stroke: props.fill, strokeWidth: 1.5, strokeDasharray: PARTIAL_DASH } : {})} />
}

const NO_CHANGES: AnomalyRuleChange[] = []

/**
 * Encabezado del tooltip: «Semana del 26 oct al 1 nov», y «· en curso» si todavía no termina.
 * Si esa semana cambió una regla, lo dice debajo.
 */
function weekTooltipTitle(changes: Map<string, AnomalyRuleChange[]>) {
  return function WeekTooltipTitle(_label: unknown, payload: ChartTooltipItem[]) {
    const week = payload[0]?.payload as AnomalyWeek | undefined
    if (!week) return null
    const title = `Semana del ${anomalyWeekRangeLabel(week.weekStart)}${week.partial ? " · en curso" : ""}`
    const changed = changes.get(week.weekStart)
    if (!changed?.length) return title
    return (
      <>
        {title}
        <span className="mt-0.5 block max-w-56 font-normal text-[var(--color-text-muted)]">Cambio de reglas: {ruleChangesText(changed)}</span>
      </>
    )
  }
}

export function CaseWeeksChart({ weeks, ruleChanges = NO_CHANGES }: { weeks: AnomalyWeek[]; ruleChanges?: AnomalyRuleChange[] }) {
  const motion = useChartMotion()
  const severities = visibleSeverities(weeks)
  const changesByWeek = useMemo(() => ruleChangesByWeek(ruleChanges), [ruleChanges])
  const markedWeeks = weeks.filter((week) => changesByWeek.has(week.weekStart))
  const config = Object.fromEntries(severities.map((severity) => [severity, { label: ANOMALY_SEVERITY_LABELS[severity] }])) satisfies ChartConfig
  const hasPartial = weeks.some((week) => week.partial)
  return (
    <div>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <BarChart aria-label="Casos de anomalía por semana, apilados por gravedad" data={weeks} margin={WEEK_MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={{ fontSize: 11 }} />
          {markedWeeks.map((week) => (
            <ReferenceLine key={week.weekStart} x={week.label} stroke={CHART_COLORS.neutral} strokeWidth={1.5} strokeDasharray="4 3" />
          ))}
          <ChartTooltip content={<ChartTooltipContent indicator="dot" labelFormatter={weekTooltipTitle(changesByWeek)} />} />
          <ChartLegend content={<ChartLegendContent />} />
          {severities.map((severity) => (
            <Bar key={severity} dataKey={severity} stackId="semana" fill={ANOMALY_SEVERITY_COLORS[severity]} shape={WeekBar} {...motion} />
          ))}
        </BarChart>
      </ChartContainer>
      {hasPartial ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">La última columna, punteada, es la semana en curso: todavía no termina.</p> : null}
      {markedWeeks.length > 0 ? (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Las líneas verticales punteadas marcan las semanas en que se creó o se modificó una regla de detección: un salto de casos ahí puede venir del cambio y no de un problema real. El detalle está en «Ver datos».
        </p>
      ) : null}
    </div>
  )
}
