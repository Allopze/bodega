"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { CHART_COLORS } from "@/lib/chart-palette"
import { formatQty } from "@/lib/utils"
import { AXIS_TICK, compactNumber } from "./chart-shared"

export interface RankingItem {
  name: string
  liters: number
}

const ROW_HEIGHT = 30

function truncate(label: string, max = 22) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

/** G-05: faenas ordenadas por litros (barras horizontales). Los datos llegan ya ordenados desde SQL. */
export function OverviewRankingChart({ items, unitLabel }: { items: RankingItem[]; unitLabel: string }) {
  if (items.length === 0) {
    return <ChartEmpty label={`Sin cargas de equipos en ${unitLabel} para estos filtros.`} className="h-40" />
  }
  const data = items.map((item) => ({ ...item, short: truncate(item.name) }))
  const config: ChartConfig = { liters: { label: "Litros", color: CHART_COLORS.brand } }
  return (
    <ChartErrorBoundary chartName={`Faenas por litros (${unitLabel})`}>
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height: Math.max(120, data.length * ROW_HEIGHT + 32) }}
        role="img"
        aria-label={`Faenas con más litros en equipos de ${unitLabel}; la tabla de abajo trae las cifras exactas`}
      >
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} strokeDasharray="2 5" />
          <XAxis type="number" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={compactNumber} />
          <YAxis type="category" dataKey="short" tickLine={false} axisLine={false} tick={AXIS_TICK} width={130} interval={0} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideIndicator
                labelFormatter={(_, payload) => String(payload[0]?.payload?.name ?? "")}
                formatter={(value) => <span className="font-mono tabular-nums">{`${formatQty(Number(value), undefined, { maximumFractionDigits: 0 })} L`}</span>}
              />
            }
          />
          <Bar dataKey="liters" fill={CHART_COLORS.brand} radius={[0, 2, 2, 0]} barSize={16} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </ChartErrorBoundary>
  )
}
