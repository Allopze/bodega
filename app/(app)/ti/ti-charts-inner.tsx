"use client"

import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { CHART_COLORS, chartTooltipStyle } from "@/lib/chart-palette"
import { compactCLP, type MaintenanceMonthPoint } from "@/lib/services/ti/dashboard"
import { formatCLP } from "@/lib/utils"

export interface WorksiteGroupRow {
  worksiteName: string
  inUse: number
  available: number
  inRepair: number
  other: number
}

export interface TiChartsProps {
  byWorksite: WorksiteGroupRow[]
  maintenanceByMonth: MaintenanceMonthPoint[]
}

const CARD = "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs"

/** Colores por estado: los mismos matices que los badges de `IT_ASSET_STATUS_META`. */
const GROUPS = [
  { key: "inUse", label: "En uso", color: "var(--color-info)" },
  { key: "available", label: "Disponibles", color: "var(--color-success)" },
  { key: "inRepair", label: "En reparación", color: "var(--color-warning)" },
  { key: "other", label: "En bodega y otros", color: CHART_COLORS.neutral },
] as const

/** Leyenda en texto muted con muestra de color: el texto nunca lleva el color de la serie. */
function Legend({ items }: { items: readonly { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/** Alternativa textual: los mismos datos del gráfico, en una tabla que se abre a demanda. */
function DataTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="inline-flex min-h-11 sm:min-h-8 cursor-pointer items-center font-semibold text-[var(--color-primary)] hover:underline">
        Ver datos
      </summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full text-left text-[var(--color-text-muted)]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>{headers.map((h) => <th key={h} scope="col" className="py-1 pr-3 font-semibold text-[var(--color-text)]">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-[var(--color-border)]">
                {row.map((cell, j) => (
                  j === 0
                    ? <th key={j} scope="row" className="py-1 pr-3 font-normal">{cell}</th>
                    : <td key={j} className="py-1 pr-3 tabular-nums">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function WorksiteChart({ data }: { data: WorksiteGroupRow[] }) {
  if (data.length === 0) return null
  const summary = data
    .map((r) => `${r.worksiteName}: ${r.inUse} en uso, ${r.available} disponibles, ${r.inRepair} en reparación, ${r.other} otros`)
    .join(". ")
  return (
    <section className={CARD} aria-labelledby="ti-chart-faena">
      <h2 id="ti-chart-faena" className="text-sm font-semibold text-[var(--color-text)]">Equipos por faena</h2>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">Parque vigente según su estado de hoy</p>
      <Legend items={GROUPS} />
      {/* `role="img"` + nombre: el gráfico no ofrece foco propio; los datos
          están en la tabla de abajo. */}
      <div role="img" aria-label={`Equipos por faena y estado. ${summary}`} style={{ height: Math.max(160, data.length * 38 + 30) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12 }} accessibilityLayer={false}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="worksiteName" width={120} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip cursor={{ fill: "var(--color-surface-2)" }} contentStyle={chartTooltipStyle()} />
            {GROUPS.map((g) => (
              <Bar key={g.key} dataKey={g.key} name={g.label} stackId="s" fill={g.color}
                stroke="var(--color-surface)" strokeWidth={2} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption="Equipos por faena y estado"
        headers={["Faena", ...GROUPS.map((g) => g.label)]}
        rows={data.map((r) => [r.worksiteName, r.inUse, r.available, r.inRepair, r.other])}
      />
    </section>
  )
}

/**
 * Gasto (miles de pesos) y cantidad (decenas) no comparten escala: eje doble,
 * regla A5b de AGENTS.md. El tick de dinero es compacto para que no se recorte.
 */
function MaintenanceChart({ data }: { data: MaintenanceMonthPoint[] }) {
  if (data.every((p) => p.count === 0)) return null
  const summary = data.filter((p) => p.count > 0)
    .map((p) => `${p.label}: ${p.count} mantenciones, ${formatCLP(p.cost)}`).join(". ")
  return (
    <section className={CARD} aria-labelledby="ti-chart-mant">
      <h2 id="ti-chart-mant" className="text-sm font-semibold text-[var(--color-text)]">Mantenciones por mes</h2>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">Gasto y número de intervenciones, últimos 12 meses</p>
      <Legend items={[
        { label: "Gasto (eje izquierdo)", color: CHART_COLORS.brand },
        { label: "Cantidad (eje derecho)", color: CHART_COLORS.blue },
      ]} />
      <div role="img" aria-label={`Mantenciones por mes. ${summary}`} className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ left: 0, right: 0 }} accessibilityLayer={false}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis yAxisId="cost" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={compactCLP} width={64} />
            <YAxis yAxisId="count" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={28} />
            <Tooltip
              contentStyle={chartTooltipStyle()}
              formatter={(value, name) => (name === "Gasto" ? [formatCLP(Number(value ?? 0)), name] : [String(value ?? ""), name])}
            />
            <Bar yAxisId="cost" dataKey="cost" name="Gasto" fill={CHART_COLORS.brand} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Line yAxisId="count" type="monotone" dataKey="count" name="Cantidad" stroke={CHART_COLORS.blue}
              strokeWidth={2} dot={{ r: 4, stroke: "var(--color-surface)", strokeWidth: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption="Mantenciones por mes"
        headers={["Mes", "Cantidad", "Gasto"]}
        rows={data.map((p) => [p.label, p.count, formatCLP(p.cost)])}
      />
    </section>
  )
}

export default function TiChartsInner({ byWorksite, maintenanceByMonth }: TiChartsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <WorksiteChart data={byWorksite} />
      <MaintenanceChart data={maintenanceByMonth} />
    </div>
  )
}
