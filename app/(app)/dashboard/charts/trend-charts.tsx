"use client"

import * as React from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
import {
  ChartTooltipCard,
  seriesOpacity,
  useActiveIndex,
  useChartMotion,
  useSpotlight,
  useTooltipProps,
  ChartActiveSync,
  GlowFilter,
} from "@/components/ui/chart-interactions"
import { Delta } from "@/components/ui/delta"
import { formatQty } from "@/lib/utils"
import { CHART_COLORS } from "@/lib/chart-palette"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "./chart-frame"
import {
  COUNT_DOMAIN,
  InteractiveLegend,
  SERIES_FADE_CLASS,
  activeDotFor,
  emphasizedTick,
  lastPointDot,
  monthFullName,
  monthTitle,
  useChartUid,
  useSeriesFocus,
  type LegendEntry,
} from "./chart-parts"

type TrendKey = "requests" | "orders" | "receipts"

interface TrendSeries {
  key: TrendKey
  label: string
  /** Cómo se nombra la cifra en una frase ("35 recepciones", "14 solicitudes"). */
  noun: string
  color: string
}

const REQUESTS_SERIES: TrendSeries = { key: "requests", label: "Solicitudes", noun: "solicitudes", color: CHART_COLORS.brand }

/** En orden de prioridad para ser la serie protagonista y el de la leyenda. */
const TREND_SERIES: readonly TrendSeries[] = [
  REQUESTS_SERIES,
  { key: "orders", label: "OC emitidas", noun: "OC emitidas", color: CHART_COLORS.blue },
  { key: "receipts", label: "Recepciones", noun: "recepciones", color: CHART_COLORS.neutral },
]

const trendChartConfig = {
  requests: { label: "Solicitudes", color: CHART_COLORS.brand },
  orders: { label: "OC emitidas", color: CHART_COLORS.blue },
  receipts: { label: "Recepciones", color: CHART_COLORS.neutral },
} satisfies ChartConfig

// ── 1. Tendencia operativa ───────────────────────────────────────────────────

/**
 * Contenido del tooltip de la tendencia. recharts sólo aplica `tooltipType="none"`
 * e `itemSorter` en su contenido por defecto; con uno propio la fila del `<Area>`
 * de relleno llega igual (y `ChartTooltipCard` la pintaría como una serie más, "requests 0")
 * y las filas llegan en el orden en que se dibujaron las series, con la protagonista
 * al final. Acá se quita la fila del relleno y se ordenan como la leyenda.
 */
function TrendTooltip(props: React.ComponentProps<typeof ChartTooltipCard>) {
  const order = TREND_SERIES.map((series) => String(series.key))
  const payload = props.payload
    ?.filter((item) => (item as { type?: string }).type !== "none")
    .sort((left, right) => order.indexOf(String(left.dataKey)) - order.indexOf(String(right.dataKey)))
  return <ChartTooltipCard {...props} payload={payload} />
}

type TrendPoint = { month: string; requests: number; orders: number; receipts: number }

/**
 * Solicitudes, órdenes y recepciones de los últimos meses.
 *
 * Una serie protagonista (por defecto Solicitudes: trazo grueso, brillo y área
 * bajo la curva con foco de luz) y dos de apoyo más delgadas. La cifra grande de
 * la cabecera y los valores de la leyenda siguen al mes apuntado y, en reposo,
 * muestran el último.
 *
 * Si el rol no ve el volumen de solicitudes esa serie llega toda en 0; entonces
 * la protagonista pasa a la primera serie con datos, para que la cabecera no diga
 * "0 solicitudes" de algo que simplemente no puede ver.
 */
export function OperationalTrendChart({ data }: { data: TrendPoint[] }) {
  const uid = useChartUid()
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const spot = useSpotlight(360)
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  const hasData = data.some((row) => row.requests + row.orders + row.receipts > 0)
  const emphasized = TREND_SERIES.find((series) => data.some((row) => row[series.key] > 0)) ?? REQUESTS_SERIES

  /** El máximo de todas las series juntas, para anotarlo sobre la curva que lo alcanza. */
  const peak = React.useMemo(() => {
    let best: { series: TrendSeries; index: number; value: number } | undefined
    for (const series of TREND_SERIES) {
      for (let index = 0; index < data.length; index++) {
        const value = data[index]?.[series.key] ?? 0
        if (value > (best?.value ?? 0)) best = { series, index, value }
      }
    }
    return best
  }, [data])

  // Sin datos no hay línea que leer: una rejilla vacía con la conclusión "el mes
  // de mayor actividad es Mar: 0" es peor que nada (I-03). Los hooks ya corrieron.
  if (!hasData) return null

  const lastIndex = data.length - 1
  const at = Math.min(active.activeIndex ?? lastIndex, lastIndex)
  const current = data[at]
  if (!current) return null
  const previous = at > 0 ? data[at - 1] : undefined

  const gradientId = `trend-fill-${uid}`
  const glowId = `trend-glow-${uid}`
  const hovering = active.activeIndex !== null
  // La protagonista se dibuja al final para quedar sobre las otras.
  const drawOrder = [...TREND_SERIES.filter((series) => series.key !== emphasized.key), emphasized]

  const legend: LegendEntry[] = TREND_SERIES.map((series) => ({
    key: series.key,
    label: series.label,
    color: series.color,
    value: formatQty(current[series.key]),
  }))

  return (
    <ChartFrame
      title="Tendencia operativa"
      description="Solicitudes, órdenes y recepciones (últimos 6 meses)"
      headline={
        <>
          <ChartHeadlineValue>{formatQty(current[emphasized.key])}</ChartHeadlineValue>
          <ChartHeadlineCaption>{emphasized.noun} en {monthFullName(current.month)}</ChartHeadlineCaption>
          {previous && (
            <Delta
              value={current[emphasized.key] - previous[emphasized.key]}
              polarity="neutral"
              comparisonLabel={`vs. ${previous.month.toLowerCase()}`}
            />
          )}
        </>
      }
    >
      <ChartContainer config={trendChartConfig} className={`h-56 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="lines">
        <ComposedChart
          accessibilityLayer
          aria-label="Tendencia operativa"
          data={data}
          margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={emphasized.color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={emphasized.color} stopOpacity={0} />
            </linearGradient>
            {spot.defs}
            <GlowFilter id={glowId} />
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tick={emphasizedTick(current.month)} />
          <ChartActiveSync labels={data.map((row) => row.month)} onIndex={active.setActiveIndex} onX={spot.setX} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} fontSize={11} domain={COUNT_DOMAIN} tickCount={5} allowDecimals={false} />
          <ChartTooltip
            {...tooltip}
            content={<TrendTooltip valueFormat="count" labelFormatter={(label) => monthTitle(String(label))} />}
          />
          {/* Sólo el relleno: el trazo lo pone la <Line> de abajo para poder darle brillo. */}
          <Area
            dataKey={emphasized.key}
            type="monotone"
            stroke="none"
            fill={`url(#${gradientId})`}
            fillOpacity={seriesOpacity(emphasized.key, focus.focusedKey)}
            mask={spot.mask}
            tooltipType="none"
            legendType="none"
            activeDot={false}
            {...motion}
          />
          {drawOrder.map((series) => {
            const isEmphasized = series.key === emphasized.key
            return (
              <Line
                key={series.key}
                dataKey={series.key}
                name={series.label}
                type="monotone"
                stroke={series.color}
                strokeWidth={isEmphasized ? 2.5 : 1.7}
                strokeLinecap="round"
                strokeOpacity={seriesOpacity(series.key, focus.focusedKey)}
                filter={isEmphasized ? `url(#${glowId})` : undefined}
                dot={lastPointDot(series.color, lastIndex, hovering, isEmphasized ? 4 : 3)}
                activeDot={activeDotFor(series.color, isEmphasized ? 5.5 : 4)}
                {...motion}
              />
            )
          })}
          {/* La anotación se esconde al apuntar: chocaría con la guía y el tooltip. */}
          {peak && !hovering && data[peak.index] && (
            <ReferenceDot
              x={data[peak.index]?.month}
              y={peak.value}
              r={3.5}
              fill={peak.series.color}
              stroke="none"
              ifOverflow="extendDomain"
              label={{
                value: `Máx. ${formatQty(peak.value)} ${peak.series.noun} · ${(data[peak.index]?.month ?? "").toLowerCase()}`,
                position: peak.index > lastIndex / 2 ? "left" : "right",
                offset: 10,
                fill: "var(--color-text)",
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de la tendencia operativa" />
    </ChartFrame>
  )
}
