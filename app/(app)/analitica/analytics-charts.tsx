"use client"

import Link from "next/link"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { SpendByModuleRow, SpendByMonthRow, VehicleCostRow, WorksiteSpendRow } from "@/lib/services/analytics"
import { formatCLP } from "@/lib/utils"
import { CHART_SERIES, chartTooltipStyle } from "@/lib/chart-palette"

// Segunda de las tres paletas que coexistían (G-07). Ahora es la única del
// producto, en `lib/chart-palette.ts`: sus hues están verificados para
// distinguirse entre sí como categorías contiguas, que es lo que esta lista
// no garantizaba (primary, success y warning son verde, verde y ámbar).
const COLORS = CHART_SERIES

function compactCLP(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`
  return `$${Math.round(value)}`
}

export function MonthlySpendChart({ data }: { data: SpendByMonthRow[] }) {
  if (data.length === 0) return <EmptyChart label="Aún no hay gasto en el período" hint="No se registraron órdenes de compra ni cargas de combustible en las fechas y faenas seleccionadas. Prueba ampliar el rango o revisa que existan movimientos." ctaLabel="Ver compras" ctaHref="/compras" />

  return (
    <>
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="month" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <YAxis tickFormatter={compactCLP} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} width={58} />
          <Tooltip
            contentStyle={chartTooltipStyle()}
            formatter={(value, name) => [formatCLP(Number(value)), name === "totalAmount" ? "Total" : String(name)]}
          />
          <Line type="monotone" dataKey="totalAmount" name="Total" stroke="var(--color-primary)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey="purchasingAmount" name="Compras" stroke="var(--color-info)" strokeWidth={1.8} dot={false} />
          <Line type="monotone" dataKey="fuelAmount" name="Combustible" stroke="var(--color-warning)" strokeWidth={1.8} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}

export function ModuleSpendChart({ data }: { data: SpendByModuleRow[] }) {
  if (data.length === 0) return <EmptyChart label="Sin gasto para distribuir" hint="La distribución por módulo aparece cuando hay compras o combustible registrados en el período." />

  return (
    <>
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.slice(0, 8)} layout="vertical" margin={{ top: 6, right: 16, left: 10, bottom: 6 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis type="number" tickFormatter={compactCLP} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <YAxis type="category" dataKey="module" width={92} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <Tooltip contentStyle={chartTooltipStyle()} formatter={(value) => [formatCLP(Number(value)), "Monto"]} />
          <Bar dataKey="totalAmount" name="Monto" radius={[0, 5, 5, 0]}>
            {data.slice(0, 8).map((row, index) => (
              <Cell key={row.module} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}

export function RankingBarChart({
  data,
  labelKey,
  valueKey,
  emptyLabel,
}: {
  data: Array<WorksiteSpendRow | VehicleCostRow>
  labelKey: "name" | "plate"
  valueKey: "totalAmount" | "totalOperationalCost" | "totalFuelAmount"
  emptyLabel: string
}) {
  if (data.length === 0) return <EmptyChart label={emptyLabel} />

  const chartData = data.slice(0, 8).map((row) => ({
    name: labelKey === "plate" && "plate" in row ? row.plate : "name" in row ? row.name : "",
    value: valueKey in row ? Number((row as unknown as Record<string, unknown>)[valueKey] ?? 0) : 0,
  }))

  return (
    <>
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis type="number" tickFormatter={compactCLP} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={118} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <Tooltip contentStyle={chartTooltipStyle()} formatter={(value) => [formatCLP(Number(value)), "Costo"]} />
          <Bar dataKey="value" radius={[0, 5, 5, 0]}>
            {chartData.map((row, index) => (
              <Cell key={row.name || index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}

function EmptyChart({ label, hint, ctaLabel, ctaHref }: { label: string; hint?: string; ctaLabel?: string; ctaHref?: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 text-center">
      <p className="text-sm font-medium text-[var(--color-text)]">{label}</p>
      {hint && <p className="max-w-sm text-xs text-[var(--color-text-muted)]">{hint}</p>}
      {ctaLabel && ctaHref && (
        <Link href={ctaHref} className="mt-1 text-xs font-medium text-[var(--color-primary-ink)] hover:underline">
          {ctaLabel} →
        </Link>
      )}
    </div>
  )
}
