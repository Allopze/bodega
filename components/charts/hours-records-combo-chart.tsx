"use client"

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useChartMotion } from "@/components/ui/chart-interactions"
import { CHART_COLORS } from "@/lib/chart-palette"
import { cn, formatQty } from "@/lib/utils"
import { equipmentAction } from "@/lib/services/mantencion/looker/filters"
import { useCrossFilter } from "@/components/mantencion/panel/looker/use-cross-filter"

export interface HoursRecordsPoint {
  key: string
  label: string
  hours: number
  records: number
}

export interface HoursRecordsComboChartProps {
  data: HoursRecordsPoint[]
  ariaLabel: string
  /** Equipo elegido con un clic; el gráfico lo resalta pero no se filtra a sí mismo. */
  selectedKey?: string | null
  height?: number
}

/**
 * Horas trabajadas (barras) y n.º de registros (línea) por equipo. Dos magnitudes de escala
 * distinta comparten el gráfico con ejes separados (A5b): las horas a la izquierda y los
 * registros a la derecha. El clic en una barra o en la leyenda emite `x_equipo`; la consulta
 * que alimenta este gráfico ignora ese filtro, así que todas las barras siguen visibles.
 */
export function HoursRecordsComboChart({
  data,
  ariaLabel,
  selectedKey,
  height = 280,
}: HoursRecordsComboChartProps) {
  const motion = useChartMotion()
  const { toggle, isActive } = useCrossFilter()
  if (data.length === 0) return null
  const config: ChartConfig = {
    hours: { label: "Horas trabajadas", color: CHART_COLORS.brand },
    records: { label: "N.º de registros", color: CHART_COLORS.blue },
  }

  function activate(key: string) {
    toggle(equipmentAction(key, isActive({ x_equipo: key })))
  }

  return (
    <div className="min-w-0">
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height }}
        role="img"
        aria-label={`${ariaLabel}. Barras: horas trabajadas; línea: número de registros.`}
      >
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="2 5" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11 }} />
          <YAxis yAxisId="hours" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={44} />
          <YAxis yAxisId="records" orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={28} allowDecimals={false} />
          <ChartTooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={(
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const point = payload[0]?.payload as HoursRecordsPoint | undefined
                  return point?.label ?? ""
                }}
                formatter={(value, name) => (
                  <span className="tabular-nums">
                    {name === "hours"
                      ? `${formatQty(Number(value), undefined, { maximumFractionDigits: 1 })} h`
                      : `${formatQty(Number(value))} registros`}
                  </span>
                )}
              />
            )}
          />
          <Bar
            yAxisId="hours"
            dataKey="hours"
            name="hours"
            fill={CHART_COLORS.brand}
            radius={[3, 3, 0, 0]}
            barSize={20}
            cursor="pointer"
            onClick={(entry: { payload?: HoursRecordsPoint }) => {
              if (entry.payload?.key) activate(entry.payload.key)
            }}
            {...motion}
          />
          <Line
            yAxisId="records"
            dataKey="records"
            name="records"
            type="monotone"
            stroke={CHART_COLORS.blue}
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            {...motion}
          />
        </ComposedChart>
      </ChartContainer>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {data.map((point) => {
          const active = selectedKey === point.key
          return (
            <button
              key={point.key}
              type="button"
              aria-pressed={active}
              onClick={() => activate(point.key)}
              className={cn(
                "inline-flex min-h-8 items-center gap-1 rounded-full border px-2 py-0.5 text-2xs",
                "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
                active
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] font-semibold text-[var(--color-primary-ink)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
              )}
            >
              <span aria-hidden className="size-1.5 rounded-full" style={{ background: active ? CHART_COLORS.brand : CHART_COLORS.neutral }} />
              {point.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
