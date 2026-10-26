"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
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
import { MONTH_LABELS, formatCLP, formatCompactCLP } from "@/lib/utils"
import { CHART_COLORS } from "@/lib/chart-palette"


const trendChartConfig = {
  requests: {
    label: "Solicitudes",
    color: CHART_COLORS.blue,
  },
  orders: {
    label: "OC Emitidas",
    color: CHART_COLORS.violet,
  },
  receipts: {
    label: "Recepciones",
    color: CHART_COLORS.brand,
  },
} satisfies ChartConfig

const billingFlowConfig = {
  invoiced:  { label: "Facturado", color: CHART_COLORS.brand },
  collected: { label: "Cobrado",   color: CHART_COLORS.blue },
} satisfies ChartConfig

// ── 1. Operational Trend Area Chart (supports 6+ data points) ───────────────

export function OperationalTrendChart({ data }: { data: Array<{ month: string; requests: number; orders: number; receipts: number }> }) {
  // Todo-en-cero también se oculta: una rejilla vacía con conclusión absurda
  // ("el mes de mayor actividad es Mar: 0") es peor que nada (I-03).
  if (!data.some((row) => row.requests + row.orders + row.receipts > 0)) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Tendencia Operativa</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Solicitudes, órdenes y recepciones (últimos 6 meses)</p>
      </div>

      <ChartContainer config={trendChartConfig} className="h-48 w-full">
        <AreaChart aria-label="Tendencia Operativa" data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="fillRequests" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_COLORS.blue} stopOpacity={0.35} />
              <stop offset="95%" stopColor={CHART_COLORS.blue} stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="fillOrders" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_COLORS.violet} stopOpacity={0.35} />
              <stop offset="95%" stopColor={CHART_COLORS.violet} stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="fillReceipts" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_COLORS.brand} stopOpacity={0.35} />
              <stop offset="95%" stopColor={CHART_COLORS.brand} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Area type="monotone" dataKey="requests" stroke={CHART_COLORS.blue} strokeWidth={2} fillOpacity={1} fill="url(#fillRequests)" />
          <Area type="monotone" dataKey="orders" stroke={CHART_COLORS.violet} strokeWidth={2} fillOpacity={1} fill="url(#fillOrders)" />
          <Area type="monotone" dataKey="receipts" stroke={CHART_COLORS.brand} strokeWidth={2} fillOpacity={1} fill="url(#fillReceipts)" />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}


// ── 12. Billing Flow Chart ───────────────────────────────────────────────────

/**
 * Facturado contra cobrado, mes a mes.
 *
 * Las dos series son dinero en la misma moneda y la misma escala, así que
 * comparten eje (A5b sólo prohíbe mezclar unidades distintas). La brecha entre
 * ambas líneas **es** la lectura: lo emitido que todavía no entra en caja.
 */
/**
 * "2026-07" → "Jul 2026". El eje mostraba la clave cruda del período, mientras
 * el resto de los gráficos del tablero rotula los meses en español (INI,
 * auditoría 2026-10-05). Una clave que no calza se deja tal cual.
 */
export function billingPeriodLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  const label = match ? MONTH_LABELS[Number(match[2]) - 1] : undefined
  return match && label ? `${label} ${match[1]}` : period
}

export function BillingFlowChart({ data: rawData }: {
  data: Array<{ period: string; invoiced: number; collected: number }>
}) {
  const data = rawData.map((row) => ({ ...row, period: billingPeriodLabel(row.period) }))
  // Todo-en-cero también se oculta: una rejilla vacía con conclusión absurda
  // ("el mayor facturado se registró en Mar: $0") es peor que nada (I-03).
  if (!data.some((row) => row.invoiced + row.collected > 0)) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Facturado y cobrado</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Emisión contra pagos confirmados, por mes</p>
      </div>

      <ChartContainer config={billingFlowConfig} className="h-56 w-full">
        <LineChart aria-label="Facturado y cobrado" data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={52} fontSize={11} tickFormatter={formatCompactCLP} />
          <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => `${String(name)}: ${formatCLP(Number(value))}`} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Line dataKey="invoiced" type="monotone" stroke={CHART_COLORS.brand} strokeWidth={2} dot={false} />
          <Line dataKey="collected" type="monotone" stroke={CHART_COLORS.blue} strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </div>
  )
}
