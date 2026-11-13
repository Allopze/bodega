"use client"

import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from "recharts"
import { DenseChart } from "@/components/charts/dense-chart"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { RankedList } from "@/components/ui/ranked-list"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { formatQty } from "@/lib/utils"
import type { MonthlyMediumChartData } from "@/lib/combustibles/control/view-helpers"
import { AXIS_TICK, compactNumber, mediumColor } from "../../../_shared/chart-shared"
import { useChartMotion } from "@/components/ui/chart-interactions"

/** Más segmentos que esto en una columna apilada no caben bajo 360 px (ni se distinguen): pasan a lista. */
const MAX_STACK_SEGMENTS = 6

/**
 * G-02: litros por mes, apilados por medio de suministro. Recibe los datos ya
 * agregados en SQL y pivotados (`pivotMonthlyByMedium`).
 *
 * Con más de {@link MAX_STACK_SEGMENTS} medios y una pantalla de menos de 360 px, `DenseChart`
 * lo reemplaza por los litros de cada medio en el período (`RankedList`); con 6 o menos el
 * gráfico cabe y se queda.
 */
export function OverviewMonthlyChart({ data }: { data: MonthlyMediumChartData }) {
  const motion = useChartMotion()
  if (data.points.length === 0) {
    return <ChartEmpty label="Sin cargas en el período elegido." hint="Amplía el período o quita la faena para ver los litros por mes." className="h-64" />
  }
  const colorOf = mediumColor
  const config: ChartConfig = Object.fromEntries(data.series.map((item, index) => [item.key, { label: item.label, color: colorOf(item.label, index) }]))
  const total = data.points.reduce((sum, point) => sum + point.total, 0)
  const byMedium = data.series.map((item) => ({
    key: item.key,
    label: item.label,
    liters: data.points.reduce((sum, point) => sum + Number(point[item.key] ?? 0), 0),
  }))
  const ranking = (
    <RankedList
      ariaLabel="Litros por medio de suministro en el período"
      format="count"
      unit=" L"
      limit={byMedium.length}
      items={byMedium.map((item) => ({ key: item.key, label: item.label, value: item.liters }))}
    />
  )

  return (
    <ChartErrorBoundary chartName="Litros por mes y medio de suministro">
      <DenseChart when={data.series.length > MAX_STACK_SEGMENTS} fallback={ranking}>
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
                {...motion}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </DenseChart>
    </ChartErrorBoundary>
  )
}
