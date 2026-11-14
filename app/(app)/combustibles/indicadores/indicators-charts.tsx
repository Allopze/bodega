"use client"

import type { ReactNode } from "react"
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
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import {
  InteractiveLegend,
  SERIES_FADE_CLASS,
  SURFACE,
  activeDotFor,
  dimmedBarShape,
  emphasizedTick,
  monthFullName,
  monthTitle,
  partialTailLineShape,
  useSeriesFocus,
  type LegendEntry,
} from "@/components/charts/chart-parts"
import { CHART_COLORS } from "@/lib/chart-palette"
import type { CostPricePoint } from "@/lib/combustibles/indicators/view"
import { formatCLP, formatCompactCLP } from "@/lib/utils"

const config = {
  amount: { label: "Costo", color: CHART_COLORS.brand },
  price: { label: "Precio por litro", color: CHART_COLORS.teal },
} satisfies ChartConfig

/** El punto del precio: relleno de superficie para que se lea sobre las columnas. */
const PRICE_DOT = { r: 3, fill: SURFACE, strokeWidth: 2 } as const

/** Índice del primer mes parcial —los parciales son los últimos de la serie— o `-1` si no hay. */
const firstPartialIndex = (data: readonly CostPricePoint[]) => data.findIndex((point) => point.partial)

function tooltipTitle(label: unknown, data: readonly CostPricePoint[]): string {
  const month = String(label)
  const title = monthTitle(month)
  return data.find((point) => point.month === month)?.partial ? `${title} (parcial)` : title
}

const priceText = (price: number | null) => (price === null ? "—" : `${formatCLP(Math.round(price))}/L`)

/**
 * Costo del libro de Copec por mes (columna, eje izquierdo, CLP) y precio por litro (línea,
 * eje derecho, CLP/L). Los dos son pesos pero de escala muy distinta (millones contra
 * miles), así que no comparten eje (A5b). No muestra litros: los litros de la pantalla son
 * los de las cargas de equipos, y el libro del proveedor es otra fuente que, junto a ellos,
 * se leería como un segundo total del mismo mes; aquí sólo sirven para dividir el costo.
 *
 * La cifra grande es el precio medio por litro de la ventana (con cómo cambió el último
 * mes, ya redactado por `priceHeadline`) o el del mes apuntado. Sin `combustibles:view_costs`
 * la pantalla no lo dibuja.
 */
export function CostPriceChart({ data, windowLabel, headline, footer }: {
  data: CostPricePoint[]
  windowLabel: string
  /** Titular de la ventana: precio medio y su cambio. `null` si ningún mes tiene precio. */
  headline: { value: string; caption: string } | null
  footer?: ReactNode
}) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  if (!data.some((point) => (point.amount ?? 0) > 0)) return null

  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const partialFrom = firstPartialIndex(data)
  const legend: LegendEntry[] = [
    { key: "amount", label: "Costo", color: CHART_COLORS.brand, swatch: "box", value: at ? (at.amount == null ? "—" : formatCompactCLP(at.amount)) : undefined },
    { key: "price", label: "Precio por litro", color: CHART_COLORS.teal, value: at ? priceText(at.price) : undefined },
  ]

  return (
    <ChartFrame
      title="Costo del libro de Copec por mes"
      description={`${windowLabel} · costo y precio por litro del libro de Copec (tarjetas y estanques)${partialFrom >= 0 ? " · el último mes es parcial" : ""}`}
      headline={
        at ? (
          <>
            <ChartHeadlineValue>{priceText(at.price)}</ChartHeadlineValue>
            <ChartHeadlineCaption>{at.providerGap ? `sin datos del proveedor en ${monthFullName(at.month)}` : `precio por litro en ${monthFullName(at.month)}${at.partial ? " (parcial)" : ""}`}</ChartHeadlineCaption>
          </>
        ) : headline ? (
          <>
            <ChartHeadlineValue>{headline.value}</ChartHeadlineValue>
            <ChartHeadlineCaption>{headline.caption}</ChartHeadlineCaption>
          </>
        ) : undefined
      }
    >
      <ChartContainer config={config} className={`h-56 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="bars">
        <ComposedChart
          accessibilityLayer
          aria-label="Costo de combustible por mes y precio por litro"
          data={data}
          margin={{ top: 12, right: 0, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tick={emphasizedTick(at?.month)} />
          <ChartActiveSync labels={data.map((row) => row.month)} onIndex={active.setActiveIndex} />
          <YAxis yAxisId="amount" tickLine={false} axisLine={false} tickMargin={8} width={52} fontSize={11} tickFormatter={formatCompactCLP} />
          <YAxis yAxisId="price" orientation="right" tickLine={false} axisLine={false} tickMargin={4} width={56} fontSize={11} tickFormatter={(value: number) => formatCLP(Math.round(value))} />
          {/* `filterNull={false}`: recharts omite las series nulas, y un mes sin datos del proveedor se quedaría sin tooltip. */}
          <ChartTooltip
            {...tooltip}
            filterNull={false}
            cursor={<ColumnHoverCursor />}
            content={
              <ChartTooltipCard
                formats={{ amount: "clp", price: "clp" }}
                labelFormatter={(label) => tooltipTitle(label, data)}
                footer={(payload) => (payload[0]?.payload?.providerGap === true ? "Sin datos del proveedor este mes" : null)}
              />
            }
          />
          <Bar
            yAxisId="amount"
            dataKey="amount"
            name="Costo"
            fill={CHART_COLORS.brand}
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
            shape={dimmedBarShape("amount", active.activeIndex, focus.focusedKey, partialFrom)}
            {...motion}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="price"
            name="Precio por litro"
            stroke={CHART_COLORS.teal}
            strokeWidth={2}
            strokeLinecap="round"
            strokeOpacity={seriesOpacity("price", focus.focusedKey)}
            shape={partialTailLineShape(partialFrom)}
            dot={PRICE_DOT}
            activeDot={activeDotFor(CHART_COLORS.teal)}
            {...motion}
          />
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de costo y precio por litro" />
      {footer}
    </ChartFrame>
  )
}
