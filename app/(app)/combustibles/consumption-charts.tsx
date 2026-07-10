"use client"

import { useRouter, useSearchParams } from "next/navigation"
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  type TooltipContentProps,
} from "recharts"
import { ChartLineUp } from "@phosphor-icons/react"
import type { PeriodoRow, PatenteRankingRow, RendimientoRow } from "@/lib/combustibles/consumption-dashboard"
import { buildConsumptionHref } from "./consumption-url"

const MONTO_COLOR = "var(--color-info)"
const CANTIDAD_COLOR = "var(--color-primary)"
const PRICE_COLOR = "var(--color-signal-ink)"
const NORMAL_COLOR = "var(--color-primary)"
const ATIPICO_COLOR = "var(--color-warning-ink)"
const GRID_COLOR = "var(--color-border)"

const shortMonths = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

const formatCLP = (value: number) => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

const formatQty = (value: number) => {
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toFixed(0)
}

const formatPrice = (value: number) => `$${Math.round(value).toLocaleString("es-CL")}/L`

function formatPeriod(period: string | number) {
  const value = String(period)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return `${Number(match[3])} ${shortMonths[Number(match[2]) - 1]}`
}

function truncate(label: string, max = 18) {
  return label.length > max ? `${label.slice(0, max)}…` : label
}

type ChartTooltipProps = Partial<TooltipContentProps<number, string>>

function TooltipPanel({
  active,
  label,
  payload,
  formatValue,
}: ChartTooltipProps & { formatValue?: (value: number, name: string) => string }) {
  if (!active || !payload?.length) return null

  return (
    <div className="min-w-40 border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-md)]">
      {label != null && <p className="mb-1.5 text-xs font-semibold text-[var(--color-text)]">{formatPeriod(label)}</p>}
      <div className="space-y-1">
        {payload.filter((entry) => entry.value != null).map((entry, index) => {
          const name = String(entry.name ?? "Valor")
          const value = Number(entry.value)
          return (
            <div key={`${name}-${index}`} className="flex items-baseline justify-between gap-5 text-xs">
              <span className="text-[var(--color-text-muted)]">{name}</span>
              <span className="font-mono font-medium text-[var(--color-text)]">{formatValue?.(value, name) ?? value.toLocaleString("es-CL")}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function usePatenteDrilldown() {
  const router = useRouter()
  const searchParams = useSearchParams()

  return (patente: string | undefined) => {
    if (!patente) return
    router.push(buildConsumptionHref(searchParams.toString(), { patente }))
  }
}

function chartAxisProps() {
  return {
    axisLine: false,
    tickLine: false,
    tick: { fill: "var(--color-text-muted)", fontSize: 11 },
  }
}

/* ── Evolución: cantidad consumida + monto por período ─────────────────────── */
export function EvolutionChart({ data }: { data: PeriodoRow[] }) {
  if (data.length === 0) return <EmptyChart label="Aún no hay períodos importados para esta selección." />

  return (
    <div className="h-72" aria-label="Evolución de consumo y gasto por período">
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <AreaChart
          data={data}
          margin={{ top: 12, right: 10, left: -8, bottom: 0 }}
          title="Evolución de gasto y litros consumidos por período"
        >
          <defs>
            <linearGradient id="consumption-amount-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={MONTO_COLOR} stopOpacity={0.22} />
              <stop offset="100%" stopColor={MONTO_COLOR} stopOpacity={0.015} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="2 5" />
          <XAxis dataKey="periodo" tickFormatter={formatPeriod} minTickGap={28} {...chartAxisProps()} />
          <YAxis yAxisId="monto" tickFormatter={formatCLP} width={60} {...chartAxisProps()} />
          <YAxis yAxisId="cantidad" orientation="right" tickFormatter={(value) => `${formatQty(Number(value))} L`} width={58} {...chartAxisProps()} />
          <Tooltip
            cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "3 3" }}
            content={<TooltipPanel formatValue={(value, name) => name === "Consumo" ? `${formatQty(value)} L` : formatCLP(value)} />}
          />
          <Legend iconType="plainline" iconSize={10} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Area
            yAxisId="monto"
            type="linear"
            dataKey="monto"
            stroke={MONTO_COLOR}
            fill="url(#consumption-amount-fill)"
            strokeWidth={2.5}
            name="Monto"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, fill: "var(--color-surface)" }}
            animationDuration={460}
            animationEasing="ease-out"
          />
          <Area
            yAxisId="cantidad"
            type="linear"
            dataKey="cantidad"
            stroke={CANTIDAD_COLOR}
            fill="none"
            strokeWidth={2}
            strokeDasharray="5 4"
            name="Consumo"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, fill: "var(--color-surface)" }}
            animationDuration={460}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── Precio promedio por unidad, por período ─────────────────────────────── */
export function PriceEvolutionChart({ data }: { data: PeriodoRow[] }) {
  const chartData = data.filter((row) => row.precioPromedio != null)
  if (chartData.length === 0) return <EmptyChart label="No hay litros suficientes para calcular un precio promedio." />

  return (
    <div className="h-72" aria-label="Precio promedio por litro y período">
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <LineChart
          data={chartData}
          margin={{ top: 12, right: 2, left: -4, bottom: 0 }}
          title="Precio promedio por litro a través de los períodos"
        >
          <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="2 5" />
          <XAxis dataKey="periodo" tickFormatter={formatPeriod} minTickGap={28} {...chartAxisProps()} />
          <YAxis tickFormatter={(value) => `$${Math.round(Number(value)).toLocaleString("es-CL")}`} width={64} domain={["auto", "auto"]} {...chartAxisProps()} />
          <Tooltip
            cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "3 3" }}
            content={<TooltipPanel formatValue={(value) => formatPrice(value)} />}
          />
          <Line
            type="linear"
            dataKey="precioPromedio"
            stroke={PRICE_COLOR}
            strokeWidth={2.5}
            dot={{ r: 3, fill: "var(--color-surface)", strokeWidth: 2 }}
            activeDot={{ r: 4, fill: PRICE_COLOR, stroke: "var(--color-surface)", strokeWidth: 2 }}
            name="Precio promedio"
            animationDuration={460}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

const RANKING_FORMATTERS: Record<"cantidad" | "monto" | "transacciones", (value: number) => string> = {
  cantidad: (value) => `${formatQty(value)} L`,
  monto: formatCLP,
  transacciones: (value) => formatQty(value),
}

/* ── Ranking por patente, con acceso directo a sus registros ─────────────── */
export function PatenteRankingChart({
  data,
  metric,
}: {
  data: PatenteRankingRow[]
  metric: "cantidad" | "monto" | "transacciones"
}) {
  const openPatente = usePatenteDrilldown()
  if (data.length === 0) return <EmptyChart label="No hay patentes que comparar con esta selección." />

  const formatter = RANKING_FORMATTERS[metric]
  const chartData = data.slice(0, 8).map((row) => ({
    name: truncate(row.patente, 16),
    filterPatente: row.filterPatente ?? row.patente,
    value: row[metric],
    sinAsociar: row.vehicleId == null,
  }))

  return (
    <div className="h-64" aria-label={`Ranking de patentes por ${metric}`}>
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 12, left: 0, bottom: 2 }}
          title={`Ranking de patentes por ${metric}. Selecciona una barra para ver su detalle.`}
        >
          <CartesianGrid horizontal={false} stroke={GRID_COLOR} strokeDasharray="2 5" />
          <XAxis type="number" tickFormatter={formatter} {...chartAxisProps()} />
          <YAxis type="category" dataKey="name" width={96} {...chartAxisProps()} />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={<TooltipPanel formatValue={(value) => formatter(value)} />}
          />
          <Bar
            dataKey="value"
            radius={[0, 2, 2, 0]}
            name="Valor"
            barSize={17}
            style={{ cursor: "pointer" }}
            onClick={(entry) => openPatente((entry as unknown as { payload?: { filterPatente?: string } }).payload?.filterPatente)}
            animationDuration={420}
            animationEasing="ease-out"
          >
            {chartData.map((row) => <Cell key={row.filterPatente} fill={row.sinAsociar ? "var(--color-warning)" : NORMAL_COLOR} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── Rendimiento, destacando valores que requieren revisión ───────────────── */
export function RendimientoChart({ data }: { data: RendimientoRow[] }) {
  const openPatente = usePatenteDrilldown()
  if (data.length === 0) return <EmptyChart label="No hay rendimiento informado para esta selección." />

  const chartData = data.slice(0, 12).map((row) => ({
    name: truncate(row.patente, 12),
    filterPatente: row.filterPatente ?? row.patente,
    rendimiento: row.rendimiento,
    atipico: row.atipico,
  }))

  return (
    <div className="h-64" aria-label="Rendimiento promedio por patente">
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 4, left: -8, bottom: 4 }}
          title="Rendimiento promedio por patente. Las barras ámbar son valores atípicos o sin rendimiento informado."
        >
          <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="2 5" />
          <XAxis dataKey="name" interval={0} angle={-28} textAnchor="end" height={52} {...chartAxisProps()} />
          <YAxis width={38} {...chartAxisProps()} />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={<TooltipPanel formatValue={(value) => value.toFixed(2)} />}
          />
          <Bar
            dataKey="rendimiento"
            radius={[2, 2, 0, 0]}
            name="Rendimiento"
            maxBarSize={34}
            style={{ cursor: "pointer" }}
            onClick={(entry) => openPatente((entry as unknown as { payload?: { filterPatente?: string } }).payload?.filterPatente)}
            animationDuration={420}
            animationEasing="ease-out"
          >
            {chartData.map((row) => <Cell key={row.filterPatente} fill={row.atipico ? ATIPICO_COLOR : NORMAL_COLOR} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-6 text-center">
      <ChartLineUp size={24} className="mb-2 text-[var(--color-text-subtle)]" aria-hidden />
      <p className="max-w-64 text-sm leading-5 text-[var(--color-text-muted)]">{label}</p>
    </div>
  )
}
