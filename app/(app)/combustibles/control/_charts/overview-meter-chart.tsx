"use client"

import { Bar, CartesianGrid, ComposedChart, Legend, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { CHART_COLORS } from "@/lib/chart-palette"
import { formatQty } from "@/lib/utils"
import type { PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { fillMonthKeys, monthFullLabel, monthShortLabel } from "@/lib/combustibles/control/view-helpers"
import { AXIS_TICK, compactNumber } from "./chart-shared"

export interface MeterChartPoint {
  month: string
  measure: number
  liters: number
}

const COPY: Record<PerformanceUnit, { measure: string; measureUnit: string; empty: string }> = {
  km_per_liter: { measure: "Kilómetros recorridos", measureUnit: "km", empty: "Sin tramos con rendimiento calculado en km/L." },
  liters_per_hour: { measure: "Horas de motor", measureUnit: "h", empty: "Sin tramos con rendimiento calculado en L/h." },
}

/**
 * G-06 / G-07: avance del medidor (km u horas) contra los litros de esos mismos
 * tramos, por mes. Dos magnitudes de escala distinta → doble eje (regla A5b):
 * barras para el medidor (izquierda), línea para los litros (derecha).
 */
export function OverviewMeterChart({ unit, points }: { unit: PerformanceUnit; points: MeterChartPoint[] }) {
  const copy = COPY[unit]
  if (points.length === 0) {
    return <ChartEmpty label={copy.empty} hint="Aparecen cuando hay cargas consecutivas con lectura del medidor y sin revisión pendiente." className="h-64" />
  }
  const byMonth = new Map(points.map((point) => [point.month, point]))
  const data = fillMonthKeys(points.map((point) => point.month)).map((month) => ({
    month,
    label: monthShortLabel(month),
    fullLabel: monthFullLabel(month),
    measure: byMonth.get(month)?.measure ?? 0,
    liters: byMonth.get(month)?.liters ?? 0,
  }))
  const config: ChartConfig = {
    measure: { label: `${copy.measure} (${copy.measureUnit})`, color: CHART_COLORS.brand },
    liters: { label: "Litros de esos tramos (L)", color: CHART_COLORS.blue },
  }

  return (
    <ChartErrorBoundary chartName={`${copy.measure} contra litros`}>
      <ChartContainer config={config} className="aspect-auto h-64 w-full" role="img" aria-label={`${copy.measure} y litros por mes, con doble eje`}>
        <ComposedChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="2 5" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={12} />
          <YAxis yAxisId="measure" tickLine={false} axisLine={false} tick={AXIS_TICK} width={48} tickFormatter={compactNumber} />
          <YAxis yAxisId="liters" orientation="right" tickLine={false} axisLine={false} tick={AXIS_TICK} width={48} tickFormatter={compactNumber} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => String(payload[0]?.payload?.fullLabel ?? "")}
                formatter={(value, _name, item) => (
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[var(--color-text-muted)]">
                      <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: item.color ?? item.fill }} />
                      {String(config[String(item.dataKey)]?.label)}
                    </span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">{formatQty(Number(value), undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                )}
              />
            }
          />
          <Legend iconSize={9} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} formatter={(value) => config[String(value)]?.label ?? String(value)} />
          <Bar yAxisId="measure" dataKey="measure" fill={CHART_COLORS.brand} radius={[2, 2, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          <Line yAxisId="liters" dataKey="liters" type="monotone" stroke={CHART_COLORS.blue} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </ComposedChart>
      </ChartContainer>
    </ChartErrorBoundary>
  )
}
