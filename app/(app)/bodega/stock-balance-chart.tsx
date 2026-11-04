"use client"

import { Bar, CartesianGrid, ComposedChart, Line, Rectangle, XAxis, YAxis, type BarShapeProps } from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
  type ChartTooltipItem,
} from "@/components/ui/chart"
import { CHART_SERIES } from "@/lib/chart-palette"
import { balanceGranularityNote, balancePeriodLabel, type BalanceBucket, type BalanceSeries } from "@/lib/bodega/balance-series"
import { formatQty } from "@/lib/utils"
import { useChartMotion } from "@/components/ui/chart-interactions"

/**
 * Saldo de un producto en una faena (CHART-035b): línea escalonada del saldo y
 * barras de lo que ingresó y salió. Las tres series son cantidades del mismo
 * producto, así que comparten eje (A5b) y el eje parte de cero.
 *
 * Colores de categoría, no de estado: el saldo es el protagonista (esmeralda) y
 * entrar/salir son azul y ocre. El tramo en curso (por semana o por mes) va
 * tenue y punteado: todavía no termina y no debe leerse como una caída.
 */

const config = {
  balance: { label: "Saldo al cierre", color: CHART_SERIES[0] },
  ingress: { label: "Ingresos", color: CHART_SERIES[1] },
  egress: { label: "Egresos", color: CHART_SERIES[2] },
} satisfies ChartConfig

const MARGIN = { top: 8, right: 8, left: 0, bottom: 0 }
const PARTIAL_FILL_OPACITY = 0.4
const PARTIAL_DASH = "4 3"

function BucketBar(props: BarShapeProps) {
  const partial = (props.payload as BalanceBucket | undefined)?.partial === true
  return <Rectangle {...props} {...(partial ? { fillOpacity: PARTIAL_FILL_OPACITY, stroke: props.fill, strokeWidth: 1.5, strokeDasharray: PARTIAL_DASH } : {})} />
}

export function StockBalanceChart({ series }: { series: BalanceSeries }) {
  const motion = useChartMotion()
  const note = balanceGranularityNote(series)
  const title = (_label: unknown, payload: ChartTooltipItem[]) => {
    const bucket = payload[0]?.payload as BalanceBucket | undefined
    if (!bucket) return null
    return `${balancePeriodLabel(series.granularity, bucket)}${bucket.partial ? " · en curso" : ""}`
  }
  return (
    <div>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <ComposedChart aria-label="Saldo al cierre, ingresos y egresos del producto por período" data={series.buckets} margin={MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} minTickGap={28} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fontSize: 11 }}
            domain={[0, "auto"]}
            tickFormatter={(value: number) => formatQty(value, undefined, { maximumFractionDigits: 0 })}
          />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" labelFormatter={title} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="ingress" fill={CHART_SERIES[1]} maxBarSize={14} shape={BucketBar} {...motion} />
          <Bar dataKey="egress" fill={CHART_SERIES[2]} maxBarSize={14} shape={BucketBar} {...motion} />
          <Line dataKey="balance" type="stepAfter" stroke={CHART_SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} {...motion} />
        </ComposedChart>
      </ChartContainer>
      {note ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{note}</p> : null}
    </div>
  )
}
