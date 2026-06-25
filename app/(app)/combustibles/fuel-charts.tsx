"use client"

import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"

interface ChartDataPoint {
  group: string | null
  totalLiters: number
  totalAmount: number
  count?: number
}

const COLORS = [
  "var(--color-primary)",
  "var(--color-signal)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-danger)",
  "var(--color-info)",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
]

const formatCLP = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

const formatLiters = (n: number) => {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

/* ── Monthly Evolution (Area Chart) ──────────────────────────────────────── */
export function MonthlyEvolutionChart({ data }: { data: ChartDataPoint[] }) {
  if (data.length === 0) return <EmptyChart label="Sin datos mensuales" />

  const chartData = data.map(d => ({
    month: d.group ?? "?",
    litros: d.totalLiters,
    monto: d.totalAmount,
  }))

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradLiters" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradAmount" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="month" className="text-xs" tick={{ fill: "var(--color-text-muted)" }} />
          <YAxis yAxisId="left" className="text-xs" tickFormatter={formatLiters} tick={{ fill: "var(--color-text-muted)" }} />
          <YAxis yAxisId="right" orientation="right" className="text-xs" tickFormatter={formatCLP} tick={{ fill: "var(--color-text-muted)" }} />
          <Tooltip
            contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "13px" }}
            formatter={(value, name) => [name === "litros" ? formatLiters(Number(value)) : formatCLP(Number(value)), name === "litros" ? "Litros" : "Monto"]}
          />
          <Legend />
          <Area yAxisId="left" type="monotone" dataKey="litros" stroke="var(--color-primary)" fill="url(#gradLiters)" strokeWidth={2} name="Litros" />
          <Area yAxisId="right" type="monotone" dataKey="monto" stroke="var(--color-success)" fill="url(#gradAmount)" strokeWidth={2} name="Monto CLP" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── By Category (Horizontal Bar Chart) ──────────────────────────────────── */
export function CategoryBarChart({ data, title }: { data: ChartDataPoint[]; title: string }) {
  if (data.length === 0) return <EmptyChart label={`Sin datos de ${title.toLowerCase()}`} />

  const chartData = data.slice(0, 8).map(d => ({
    name: (d.group ?? "Sin asignar").length > 20 ? (d.group ?? "Sin asignar").substring(0, 20) + "…" : (d.group ?? "Sin asignar"),
    monto: d.totalAmount,
    litros: d.totalLiters,
  }))

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis type="number" className="text-xs" tickFormatter={formatCLP} tick={{ fill: "var(--color-text-muted)" }} />
          <YAxis type="category" dataKey="name" width={120} className="text-xs" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "13px" }}
            formatter={(value, name) => [name === "monto" ? formatCLP(Number(value)) : formatLiters(Number(value)), name === "monto" ? "Monto" : "Litros"]}
          />
          <Bar dataKey="monto" radius={[0, 4, 4, 0]} name="Monto">
            {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── By Product (Pie Chart) ──────────────────────────────────────────────── */
export function ProductPieChart({ data }: { data: ChartDataPoint[] }) {
  if (data.length === 0) return <EmptyChart label="Sin datos de producto" />

  const chartData = data.map(d => ({
    name: d.group ?? "Otro",
    value: d.totalAmount,
    liters: d.totalLiters,
  }))

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={4}
            dataKey="value"
            nameKey="name"
            label={({ name, percent }) => `${name} ${percent != null ? (percent * 100).toFixed(0) : 0}%`}
            labelLine={false}
          >
            {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip
            contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "13px" }}
            formatter={(value) => [formatCLP(Number(value)), "Monto"]}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── Empty State ─────────────────────────────────────────────────────────── */
function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
      {label}
    </div>
  )
}
