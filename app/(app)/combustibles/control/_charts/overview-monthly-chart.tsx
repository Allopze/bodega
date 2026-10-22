"use client"

import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { formatQty } from "@/lib/utils"
import type { MonthlyMediumChartData } from "@/lib/combustibles/control/view-helpers"
import { AXIS_TICK, MEDIUM_COLORS, NO_MEDIUM_COLOR, compactNumber } from "./chart-shared"

/**
 * G-02: litros por mes, apilados por medio de suministro. Recibe los datos ya
 * agregados en SQL y pivotados (`pivotMonthlyByMedium`).
 */
export function OverviewMonthlyChart({ data }: { data: MonthlyMediumChartData }) {
  if (data.points.length === 0) {
    return <ChartEmpty label="Sin cargas en el período elegido." hint="Amplía el período o quita la faena para ver los litros por mes." className="h-64" />
  }
  const colorOf = (label: string, index: number) => (label === "Sin medio informado" ? NO_MEDIUM_COLOR : MEDIUM_COLORS[index % MEDIUM_COLORS.length]!)
  const config: ChartConfig = Object.fromEntries(data.series.map((item, index) => [item.key, { label: item.label, color: colorOf(item.label, index) }]))
  const total = data.points.reduce((sum, point) => sum + point.total, 0)

  return (
    <ChartErrorBoundary chartName="Litros por mes y medio de suministro">
      <ChartContainer
        config={config}
        className="aspect-auto h-72 w-full"
        role="img"
        aria-label={`Litros por mes y medio de suministro: ${formatQty(total, undefined, { maximumFractionDigits: 0 })} litros en ${data.points.length} meses`}
      >
        <BarChart data={data.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="2 5" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={12} />
          <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={52} tickFormatter={compactNumber} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => String(payload[0]?.payload?.fullLabel ?? "")}
                formatter={(value, name, item) => (
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[var(--color-text-muted)]">
                      <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: item.fill ?? item.color }} />
                      {String(config[String(item.dataKey)]?.label ?? name)}
                    </span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">{`${formatQty(Number(value), undefined, { maximumFractionDigits: 0 })} L`}</span>
                  </div>
                )}
              />
            }
          />
          <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} formatter={(value) => config[String(value)]?.label ?? String(value)} />
          {data.series.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              stackId="liters"
              fill={colorOf(item.label, index)}
              radius={index === data.series.length - 1 ? [2, 2, 0, 0] : 0}
              maxBarSize={48}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </ChartErrorBoundary>
  )
}
