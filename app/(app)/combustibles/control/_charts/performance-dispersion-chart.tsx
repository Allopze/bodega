"use client"

import { Bar, CartesianGrid, ComposedChart, Legend, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { CHART_COLORS } from "@/lib/chart-palette"
import { PERFORMANCE_UNIT_LABELS, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { AXIS_TICK } from "./chart-shared"

export interface DispersionPoint {
  name: string
  n: number
  mean: number | null
  sd: number | null
}

function truncate(label: string, max = 14) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

const fmt = (value: unknown, digits = 2) => (typeof value === "number" ? value.toLocaleString("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—")

/**
 * R-04: promedio (barras, eje izquierdo) contra desviación estándar muestral
 * (línea, eje derecho) por faena, de una sola unidad. Una faena con una carga
 * válida no tiene σ: su punto de línea queda sin dibujar, no en cero.
 */
export function PerformanceDispersionChart({ unit, points }: { unit: PerformanceUnit; points: DispersionPoint[] }) {
  const unitLabel = PERFORMANCE_UNIT_LABELS[unit]
  if (points.length === 0) {
    return <ChartEmpty label={`Sin cargas con rendimiento calculado en ${unitLabel}.`} className="h-64" />
  }
  const data = points.map((point) => ({ ...point, short: truncate(point.name) }))
  const config: ChartConfig = {
    mean: { label: `Promedio (${unitLabel})`, color: CHART_COLORS.brand },
    sd: { label: `Desviación estándar (${unitLabel})`, color: CHART_COLORS.blue },
  }
  return (
    <ChartErrorBoundary chartName={`Promedio y desviación por faena (${unitLabel})`}>
      <ChartContainer config={config} className="aspect-auto h-72 w-full" role="img" aria-label={`Promedio y desviación estándar en ${unitLabel} por faena, con doble eje; la tabla trae las cifras exactas`}>
        <ComposedChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="2 5" />
          <XAxis dataKey="short" tickLine={false} axisLine={false} tick={AXIS_TICK} interval={0} angle={data.length > 5 ? -25 : 0} textAnchor={data.length > 5 ? "end" : "middle"} height={data.length > 5 ? 56 : 30} />
          <YAxis yAxisId="mean" tickLine={false} axisLine={false} tick={AXIS_TICK} width={44} tickFormatter={(value) => fmt(value, 1)} />
          <YAxis yAxisId="sd" orientation="right" tickLine={false} axisLine={false} tick={AXIS_TICK} width={44} tickFormatter={(value) => fmt(value, 1)} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const point = payload[0]?.payload as { name?: string; n?: number } | undefined
                  return `${point?.name ?? ""} · ${point?.n ?? 0} cargas`
                }}
                formatter={(value, _name, item) => (
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[var(--color-text-muted)]">
                      <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: item.color ?? item.fill }} />
                      {String(config[String(item.dataKey)]?.label)}
                    </span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">{fmt(value)}</span>
                  </div>
                )}
              />
            }
          />
          <Legend iconSize={9} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} formatter={(value) => config[String(value)]?.label ?? String(value)} />
          <Bar yAxisId="mean" dataKey="mean" fill={CHART_COLORS.brand} radius={[2, 2, 0, 0]} maxBarSize={40} isAnimationActive={false} />
          <Line yAxisId="sd" dataKey="sd" type="monotone" stroke={CHART_COLORS.blue} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ChartContainer>
    </ChartErrorBoundary>
  )
}
