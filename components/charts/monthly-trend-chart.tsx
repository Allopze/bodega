"use client"

import * as React from "react"
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import {
  ChartActiveSync,
  ChartTooltipCard,
  ColumnHoverCursor,
  seriesOpacity,
  useActiveIndex,
  useChartMotion,
  useTooltipProps,
} from "@/components/ui/chart-interactions"
import { monthPeriodLabel, monthPeriodName } from "@/lib/prevention/monthly-series"
import {
  COUNT_DOMAIN,
  InteractiveLegend,
  SERIES_FADE_CLASS,
  SURFACE,
  activeDotFor,
  dimmedBarShape,
  emphasizedTick,
  partialTailLineShape,
  useSeriesFocus,
  type LegendEntry,
} from "./chart-parts"

/**
 * Serie mensual de Prevención: columnas apiladas de conteos (inspecciones,
 * controles, envíos de PPA) y, opcionalmente, una línea de porcentaje en un eje
 * propio a la derecha. La usan CHART-010 (inspecciones y alcotest) y CHART-011
 * (PPA) de `AUDITORIA_VISUALIZACIONES_CHOME.md`.
 *
 * Reglas que el componente sostiene por quien lo llama:
 *
 * - **Un eje por unidad (A5b).** Los conteos van a la izquierda y el porcentaje
 *   a la derecha, de 0 a 100. Compartir eje aplastaría la serie chica.
 * - **Sin dato no es cero.** Un mes con `rate: null` no dibuja punto ni une la
 *   línea con el siguiente: la línea se corta. El motivo («datos
 *   insuficientes · n = 3») viaja en `note` y sale en el tooltip.
 * - **El mes en curso es parcial.** Columna tenue con contorno punteado y último
 *   tramo de la línea punteado: sus pocos días no se leen como una caída.
 * - **El color no es el único portador.** La leyenda nombra cada serie, el
 *   tooltip da las cifras y `ChartSection` suma «Ver datos».
 * - **Radio sólo en el extremo libre**: el segmento de arriba de la pila.
 */
export interface MonthlyTrendPoint {
  /** Mes civil chileno, `YYYY-MM`. */
  month: string
  /** El mes en curso, que todavía no termina. */
  partial?: boolean
  /** Alto de cada segmento de columna, por la `key` de `bars`. */
  values: Record<string, number>
  /** Valor de la línea, 0–100. `null` = sin dato o datos insuficientes. */
  rate?: number | null
  /** Pie del tooltip: la base de la tasa y, si falta, por qué no hay tasa. */
  note?: string
}

export interface MonthlyTrendBar {
  key: string
  label: string
  color: string
}

export interface MonthlyTrendChartProps {
  data: MonthlyTrendPoint[]
  /** De abajo hacia arriba. Una sola entrada = columnas simples. */
  bars: MonthlyTrendBar[]
  /** Con ella aparece el eje derecho de porcentaje. */
  line?: { label: string; color: string }
  /** Nombre accesible del trazado (qué mide, en una frase corta). */
  ariaLabel: string
  /** Altura del trazado, en clases de Tailwind. */
  className?: string
}

const COUNT_AXIS = "count"
const RATE_AXIS = "rate"
const RATE_KEY = "rate"

export function MonthlyTrendChart({ data, bars, line, ariaLabel, className = "h-56" }: MonthlyTrendChartProps) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  const rows = React.useMemo(
    // Los valores de las columnas van primero: ninguna clave de serie puede pisar `period`, `month`, `partial` ni `note`.
    () => data.map((point) => ({
      ...point.values,
      period: monthPeriodLabel(point.month),
      month: point.month,
      partial: Boolean(point.partial),
      note: point.note ?? "",
      [RATE_KEY]: point.rate ?? null,
    })),
    [data],
  )
  const config = React.useMemo<ChartConfig>(() => ({
    ...Object.fromEntries(bars.map((bar) => [bar.key, { label: bar.label, color: bar.color }])),
    ...(line ? { [RATE_KEY]: { label: line.label, color: line.color } } : {}),
  }), [bars, line])

  if (rows.length === 0) return null

  const lastIndex = rows.length - 1
  const partialFrom = rows.findIndex((row) => row.partial)
  const hovering = active.activeIndex !== null
  const focusedRow = hovering ? rows[Math.min(active.activeIndex ?? 0, lastIndex)] : undefined
  const names = Object.fromEntries([
    ...bars.map((bar) => [bar.key, bar.label] as const),
    ...(line ? [[RATE_KEY, line.label] as const] : []),
  ])

  const legend: LegendEntry[] = [
    ...bars.map((bar) => ({
      key: bar.key,
      label: bar.label,
      color: bar.color,
      swatch: "box" as const,
      value: focusedRow ? String(focusedRow[bar.key as keyof typeof focusedRow] ?? 0) : undefined,
    })),
    ...(line ? [{ key: RATE_KEY, label: line.label, color: line.color, swatch: "line" as const }] : []),
  ]

  return (
    <>
      <ChartContainer config={config} className={`${className} w-full ${SERIES_FADE_CLASS}`} data-chart-kind="monthly-trend">
        <ComposedChart
          accessibilityLayer
          aria-label={ariaLabel}
          data={rows}
          margin={{ left: 0, right: line ? 4 : 12, top: 12, bottom: 0 }}
          barCategoryGap="28%"
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tick={emphasizedTick(focusedRow?.period ?? rows[lastIndex]?.period)} />
          <ChartActiveSync labels={rows.map((row) => row.period)} onIndex={active.setActiveIndex} />
          <YAxis yAxisId={COUNT_AXIS} tickLine={false} axisLine={false} width={36} fontSize={11} domain={COUNT_DOMAIN} tickCount={5} allowDecimals={false} />
          {line && (
            <YAxis
              yAxisId={RATE_AXIS}
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={44}
              fontSize={11}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(value: number) => `${value}%`}
            />
          )}
          <ChartTooltip
            {...tooltip}
            cursor={<ColumnHoverCursor />}
            content={
              <ChartTooltipCard
                valueFormat="count"
                formats={{ [RATE_KEY]: "percent" }}
                names={names}
                labelFormatter={(label) => {
                  const row = rows.find((candidate) => candidate.period === label)
                  const title = row ? monthPeriodName(row.month, true) : String(label)
                  const capitalized = title.charAt(0).toUpperCase() + title.slice(1)
                  return row?.partial ? `${capitalized} (en curso)` : capitalized
                }}
                footer={(payload) => {
                  const note = payload[0]?.payload?.note
                  return typeof note === "string" && note !== "" ? note : null
                }}
              />
            }
          />
          {bars.map((bar, index) => (
            <Bar
              key={bar.key}
              yAxisId={COUNT_AXIS}
              dataKey={bar.key}
              name={bar.label}
              stackId="count"
              fill={bar.color}
              radius={index === bars.length - 1 ? [4, 4, 0, 0] : 0}
              maxBarSize={44}
              shape={dimmedBarShape(bar.key, active.activeIndex, focus.focusedKey, partialFrom)}
              {...motion}
            />
          ))}
          {line && (
            <Line
              yAxisId={RATE_AXIS}
              dataKey={RATE_KEY}
              name={line.label}
              type="linear"
              stroke={line.color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeOpacity={seriesOpacity(RATE_KEY, focus.focusedKey)}
              connectNulls={false}
              dot={{ r: 3.5, fill: SURFACE, stroke: line.color, strokeWidth: 2 }}
              activeDot={activeDotFor(line.color)}
              {...(partialFrom >= 0 ? { shape: partialTailLineShape(partialFrom) } : {})}
              {...motion}
            />
          )}
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label={`Series de ${ariaLabel.toLowerCase()}`} />
    </>
  )
}
