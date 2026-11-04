"use client"

import { CartesianGrid, ComposedChart, Line, ReferenceArea, XAxis, YAxis, LabelList } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { CHART_COLORS } from "@/lib/chart-palette"
import { PERFORMANCE_UNIT_LABELS, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import type { EquipmentNormalRange, EquipmentSeriesPoint } from "@/lib/combustibles/equipment/types"
import { formatDate, formatQty } from "@/lib/utils"
import { useChartMotion } from "@/components/ui/chart-interactions"

const AXIS_TICK = { fill: "var(--color-text-muted)", fontSize: 11 } as const
const fmt = (value: unknown, digits = 1) => (typeof value === "number" ? formatQty(value, undefined, { maximumFractionDigits: digits }) : "—")

/**
 * «Rendimiento carga a carga»: las últimas cargas del equipo con su rendimiento
 * calculado, la franja verde de su rango normal (su promedio ± k desviaciones,
 * el mismo criterio con que el control marca una carga atípica) y los puntos que
 * caen fuera de ese rango en la dirección mala en rojo —con el valor escrito al
 * lado: el color no es lo único que lo dice—. Una sola unidad y un solo eje
 * (km/L o L/h no se mezclan).
 */
export function EquipmentPerformanceChart({ unit, points, range, vehicleLabel }: { unit: PerformanceUnit; points: EquipmentSeriesPoint[]; range: EquipmentNormalRange | null; vehicleLabel: string }) {
  const motion = useChartMotion()
  const unitLabel = PERFORMANCE_UNIT_LABELS[unit]
  if (points.length === 0) {
    return <ChartEmpty label="Aún no hay cargas con rendimiento calculado" hint="Aparecen cuando el equipo tiene cargas consecutivas con lectura del medidor y sin decisión pendiente." className="h-56" />
  }
  const data = points.map((point) => ({ ...point, label: formatDate(point.occurredAt).slice(0, 5) }))
  const values = data.map((point) => point.value)
  const low = Math.min(...values, range?.low ?? Infinity)
  const high = Math.max(...values, range?.high ?? -Infinity)
  const pad = (high - low) * 0.15 || 1
  const config: ChartConfig = { value: { label: `Rendimiento (${unitLabel})`, color: CHART_COLORS.brand } }

  return (
    <ChartErrorBoundary chartName="Rendimiento carga a carga">
      <ChartContainer
        config={config}
        className="aspect-auto h-60 w-full"
        role="img"
        aria-label={`Rendimiento de las últimas ${points.length} cargas de ${vehicleLabel}, entre ${fmt(Math.min(...values))} y ${fmt(Math.max(...values))} ${unitLabel}${range ? `; su rango normal va de ${fmt(range.low)} a ${fmt(range.high)} ${unitLabel}` : ""}`}
      >
        <ComposedChart data={data} margin={{ top: 22, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="2 5" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={14} />
          <YAxis domain={[Math.max(0, low - pad), high + pad]} tickLine={false} axisLine={false} tick={AXIS_TICK} width={40} tickFormatter={(value) => fmt(value)} />
          {range ? <ReferenceArea y1={range.low} y2={range.high} fill={CHART_COLORS.brand} fillOpacity={0.09} stroke="none" ifOverflow="extendDomain" /> : null}
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideIndicator
                labelFormatter={(_, payload) => formatDate(String(payload[0]?.payload?.occurredAt ?? ""))}
                formatter={(value, _name, item) => (
                  <span className="font-mono tabular-nums">
                    {fmt(value, 2)} {unitLabel}
                    {item.payload?.outOfRange ? <span className="ml-2 font-sans text-[var(--color-danger-ink)]">fuera de su rango</span> : null}
                  </span>
                )}
              />
            }
          />
          <Line
            dataKey="value"
            type="monotone"
            stroke={CHART_COLORS.brand}
            strokeWidth={2}
            dot={(props: { cx?: number; cy?: number; payload?: { outOfRange?: boolean } }) => {
              const { cx, cy, payload } = props
              if (cx === undefined || cy === undefined) return <g />
              const bad = payload?.outOfRange
              return <circle cx={cx} cy={cy} r={4} fill={bad ? CHART_COLORS.danger : "var(--color-surface)"} stroke={bad ? CHART_COLORS.danger : CHART_COLORS.brand} strokeWidth={2} />
            }}
            {...motion}
          >
            <LabelList dataKey="value" position="top" offset={8} formatter={(value: unknown) => fmt(value)} className="fill-[var(--color-text)] text-[10px]" />
          </Line>
        </ComposedChart>
      </ChartContainer>
    </ChartErrorBoundary>
  )
}
