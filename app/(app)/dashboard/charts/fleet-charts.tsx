"use client"

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { formatCompactCLP } from "@/lib/utils"
import { CHART_COLORS } from "@/lib/chart-palette"


/**
 * Formato compacto para ejes de dinero: `formatCLP` completo no cabe en un tick
 * de 52px y obliga a rotarlo. El valor exacto vive en el tooltip.
 */
const fuelChartConfig = {
  liters: {
    label: "Litros",
    color: CHART_COLORS.signal,
  },
  amount: {
    label: "Costo",
    color: CHART_COLORS.brand,
  },
  loads: {
    label: "Cargas",
    color: CHART_COLORS.teal,
  },
} satisfies ChartConfig

const maintenanceChartConfig = {
  completed: {
    label: "Completadas",
    color: CHART_COLORS.brand,
  },
  scheduled: {
    label: "Programadas",
    color: CHART_COLORS.blue,
  },
  amount: {
    label: "Costo",
    color: CHART_COLORS.violet,
  },
} satisfies ChartConfig

// ── 7. Fuel Consumption Chart ────────────────────────────────────────────────

export interface FuelMonthlyChartPoint {
  month: string
  liters: number
  amount: number | null
  loads: number
}

/**
 * Litros (barra, eje izquierdo) y costo (línea, eje derecho).
 *
 * Antes eran dos barras —litros y cargas— **en el mismo eje Y**: litros va en
 * miles y cargas en decenas, así que la serie "Cargas" quedaba pegada al piso e
 * ilegible. Y el costo, que es lo que gerencia mira, se consultaba en
 * `getFuelMonthlyTrend` y se descartaba.
 *
 * Las cargas siguen disponibles en el tooltip, que es donde una cifra de apoyo
 * no compite por escala con nada.
 */
export function FuelConsumptionChart({ data, showCosts = true, periodLabel }: { data: FuelMonthlyChartPoint[]; showCosts?: boolean; periodLabel?: string }) {
  if (!data.length || !data.some((d) => d.liters > 0 || (showCosts && (d.amount ?? 0) > 0))) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Consumo de Combustibles</h3>
          <p className="text-xs text-[var(--color-text-muted)]">{showCosts ? "Litros cargados y costo por mes" : "Litros cargados por mes"}{periodLabel ? ` · ${periodLabel}` : ""}</p>
        </div>
      </div>

      <ChartContainer config={fuelChartConfig} className="h-48 w-full">
        <ComposedChart aria-label="Consumo de Combustibles" data={data} margin={{ top: 10, right: 6, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis yAxisId="liters" tickLine={false} axisLine={false} tickMargin={8} />
          {showCosts && <YAxis yAxisId="amount" orientation="right" tickLine={false} axisLine={false} tickMargin={4} tickFormatter={formatCompactCLP} width={52} />}
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar yAxisId="liters" dataKey="liters" fill={CHART_COLORS.signal} radius={[4, 4, 0, 0]} />
          {showCosts && <Line yAxisId="amount" type="monotone" dataKey="amount" stroke={CHART_COLORS.brand} strokeWidth={2} dot={{ r: 3 }} />}
        </ComposedChart>
      </ChartContainer>
    </div>
  )
}

// ── 8. Maintenance Activity Chart ─────────────────────────────────────────────

export interface MaintenanceMonthlyChartPoint {
  month: string
  completed: number
  scheduled: number
  amount: number | null
}

/**
 * Conteos en barras (eje izquierdo) y costo en línea (eje derecho). El `amount`
 * ya lo calculaba `getMaintenanceMonthlyTrend` y se descartaba; sin él la
 * tarjeta contaba mantenciones sin decir lo que costaron.
 */
export function MaintenanceTrendChart({ data, showCosts = true, periodLabel }: { data: MaintenanceMonthlyChartPoint[]; showCosts?: boolean; periodLabel?: string }) {
  if (!data.length || !data.some((d) => d.completed > 0 || d.scheduled > 0 || (showCosts && (d.amount ?? 0) > 0))) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Mantención de Flota</h3>
          <p className="text-xs text-[var(--color-text-muted)]">{showCosts ? "Completadas vs. programadas y costo por mes" : "Completadas vs. programadas por mes"}{periodLabel ? ` · ${periodLabel}` : ""}</p>
        </div>
      </div>

      {/* Era el único gráfico del tablero sin lectura equivalente (I-15). */}
      <ChartContainer config={maintenanceChartConfig} className="h-48 w-full">
        <ComposedChart aria-label="Mantención de Flota" data={data} margin={{ top: 10, right: 6, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis yAxisId="count" tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
          {showCosts && <YAxis yAxisId="amount" orientation="right" tickLine={false} axisLine={false} tickMargin={4} tickFormatter={formatCompactCLP} width={52} />}
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar yAxisId="count" dataKey="completed" fill={CHART_COLORS.brand} radius={[4, 4, 0, 0]} />
          <Bar yAxisId="count" dataKey="scheduled" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} />
          {showCosts && <Line yAxisId="amount" type="monotone" dataKey="amount" stroke={CHART_COLORS.violet} strokeWidth={2} dot={{ r: 3 }} />}
        </ComposedChart>
      </ChartContainer>
    </div>
  )
}
