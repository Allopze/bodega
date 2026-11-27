"use client"

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useChartMotion } from "@/components/ui/chart-interactions"
import { useCrossFilter } from "@/components/mantencion/panel/looker/use-cross-filter"
import { CHART_COLORS } from "@/lib/chart-palette"
import { plural } from "@/lib/mantencion/format"
import { monthAction } from "@/lib/services/mantencion/looker/filter-hrefs"
import { cn } from "@/lib/utils"

export interface MonthlyWorkPoint {
  /** `YYYY-MM`: es el valor de `x_mes`. */
  key: string
  label: string
  count: number
  /** El mes en curso: su columna se ve tenue y con contorno punteado, y el rótulo lo dice. */
  partial?: boolean
}

export interface MonthlyWorkChartProps {
  data: MonthlyWorkPoint[]
  ariaLabel: string
  /** Mes elegido con un clic; el gráfico lo resalta y atenúa los demás, pero no se filtra a sí mismo. */
  selectedKey?: string | null
  height?: number
}

/** «1 trabajo» / «3 trabajos». */
export function workText(count: number): string {
  return plural(count, "trabajo", "trabajos")
}

/**
 * Trabajos correctivos por mes, en columnas. El clic en una columna o en su botón de la leyenda emite `x_mes`; la
 * consulta que alimenta este gráfico ignora ese filtro, así todos los meses siguen visibles y los demás se
 * atenúan. El dibujo es una imagen (`role="img"`) y el camino por teclado y por lector de pantalla son los botones
 * de debajo, uno por mes y con su cifra (DESIGN › Drill-down: nunca un control dentro de `role="img"`).
 */
export function MonthlyWorkChart({ data, ariaLabel, selectedKey, height = 240 }: MonthlyWorkChartProps) {
  const motion = useChartMotion()
  const { toggle, isActive } = useCrossFilter()
  if (data.length === 0) return null
  const config: ChartConfig = { count: { label: "Trabajos correctivos", color: CHART_COLORS.brand } }
  const activate = (key: string) => toggle(monthAction(key, isActive({ x_mes: key })))

  return (
    <div className="min-w-0">
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }} role="img" aria-label={`${ariaLabel}. Columnas: trabajos por mes.`}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="2 5" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={data.length > 12 ? "preserveStartEnd" : 0} tick={{ fontSize: 11 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={36} allowDecimals={false} />
          <ChartTooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={(
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const point = payload[0]?.payload as MonthlyWorkPoint | undefined
                  return point ? `${point.label}${point.partial ? " (parcial)" : ""}` : ""
                }}
                formatter={(value) => <span className="tabular-nums">{workText(Number(value))}</span>}
              />
            )}
          />
          <Bar
            dataKey="count"
            name="count"
            fill={CHART_COLORS.brand}
            radius={[3, 3, 0, 0]}
            maxBarSize={36}
            cursor="pointer"
            onClick={(entry: { payload?: MonthlyWorkPoint }) => {
              if (entry.payload?.key) activate(entry.payload.key)
            }}
            {...motion}
          >
            {data.map((point) => (
              <Cell
                key={point.key}
                fill={CHART_COLORS.brand}
                fillOpacity={selectedKey && selectedKey !== point.key ? 0.25 : point.partial ? 0.4 : 1}
                stroke={point.partial ? CHART_COLORS.brand : "none"}
                strokeWidth={1.5}
                strokeDasharray={point.partial ? "4 3" : undefined}
              />
            ))}
          </Bar>
        </BarChart>
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
                "inline-flex min-h-11 items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs sm:min-h-8",
                "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
                active
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] font-semibold text-[var(--color-primary-ink)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
              )}
            >
              {point.label}
              <span className="font-mono tabular-nums">{point.count}</span>
              {point.partial && <span className="text-[var(--color-text-subtle)]">parcial</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
