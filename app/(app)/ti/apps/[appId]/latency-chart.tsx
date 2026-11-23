"use client"

import * as React from "react"
import { CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import {
  ChartActiveSync,
  ChartTooltipCard,
  seriesOpacity,
  useActiveIndex,
  useChartMotion,
  useTooltipProps,
} from "@/components/ui/chart-interactions"
import {
  InteractiveLegend,
  SERIES_FADE_CLASS,
  SURFACE,
  activeDotFor,
  useSeriesFocus,
  type LegendEntry,
} from "@/components/charts/chart-parts"
import { CHART_COLORS } from "@/lib/chart-palette"
import { formatDate } from "@/lib/utils"
import type { LatencyWeek } from "@/lib/services/field-apps/types"
import { formatMinutes } from "../status"

export interface LatencyChartProps {
  data: LatencyWeek[]
  /** Nombre accesible del trazado (qué mide, en una frase corta). */
  ariaLabel: string
  className?: string
}

const P50 = "p50Minutes"
const P90 = "p90Minutes"
const NAMES = { [P50]: "Mediana (min)", [P90]: "Percentil 90 (min)" }

/** «17-11» a partir del lunes `YYYY-MM-DD` de la semana. */
function weekTick(weekStart: string): string {
  const [, month, day] = weekStart.split("-")
  return `${day}-${month}`
}

/**
 * Demora de llegada: mediana y percentil 90, en minutos, por semana. Las dos series
 * comparten unidad, así que comparten eje (A5b); el porcentaje de envíos sin señal
 * viaja en el titular y en «Ver datos», no en un segundo eje. Una semana sin envíos
 * deja la línea cortada: sin dato no es cero.
 */
export function LatencyChart({ data, ariaLabel, className = "h-64" }: LatencyChartProps) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  const rows = React.useMemo(
    () => data.map((week) => ({
      period: weekTick(week.weekStart),
      weekStart: week.weekStart,
      [P50]: week.p50Minutes,
      [P90]: week.p90Minutes,
    })),
    [data],
  )
  const config = React.useMemo<ChartConfig>(() => ({
    [P50]: { label: NAMES[P50], color: CHART_COLORS.brand },
    [P90]: { label: NAMES[P90], color: CHART_COLORS.signal },
  }), [])

  if (rows.length === 0) return null

  const focusedRow = active.activeIndex !== null ? rows[Math.min(active.activeIndex, rows.length - 1)] : undefined
  const legend: LegendEntry[] = [
    { key: P50, label: NAMES[P50], color: CHART_COLORS.brand, swatch: "line", value: focusedRow ? formatMinutes(focusedRow[P50] ?? null) : undefined },
    { key: P90, label: NAMES[P90], color: CHART_COLORS.signal, swatch: "line", value: focusedRow ? formatMinutes(focusedRow[P90] ?? null) : undefined },
  ]

  return (
    <>
      <ChartContainer config={config} className={`${className} w-full ${SERIES_FADE_CLASS}`} data-chart-kind="latency-weeks">
        <ComposedChart accessibilityLayer aria-label={ariaLabel} data={rows} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval="preserveStartEnd" />
          <ChartActiveSync labels={rows.map((row) => row.period)} onIndex={active.setActiveIndex} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            fontSize={11}
            domain={[0, "auto"]}
            tickCount={5}
            tickFormatter={(value: number) => formatMinutes(value)}
          />
          <ChartTooltip
            {...tooltip}
            content={
              <ChartTooltipCard
                valueFormat="count"
                names={NAMES}
                labelFormatter={(label) => {
                  const row = rows.find((candidate) => candidate.period === label)
                  return row ? `Semana del ${formatDate(row.weekStart)}` : String(label)
                }}
              />
            }
          />
          <Line
            dataKey={P50}
            name={NAMES[P50]}
            type="linear"
            stroke={CHART_COLORS.brand}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeOpacity={seriesOpacity(P50, focus.focusedKey)}
            connectNulls={false}
            dot={{ r: 3.5, fill: SURFACE, stroke: CHART_COLORS.brand, strokeWidth: 2 }}
            activeDot={activeDotFor(CHART_COLORS.brand)}
            {...motion}
          />
          <Line
            dataKey={P90}
            name={NAMES[P90]}
            type="linear"
            stroke={CHART_COLORS.signal}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeOpacity={seriesOpacity(P90, focus.focusedKey)}
            connectNulls={false}
            dot={{ r: 3.5, fill: SURFACE, stroke: CHART_COLORS.signal, strokeWidth: 2 }}
            activeDot={activeDotFor(CHART_COLORS.signal)}
            {...motion}
          />
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label={`Series de ${ariaLabel.toLowerCase()}`} />
    </>
  )
}
