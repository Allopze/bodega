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
  "var(--color-info)",
  "var(--color-warning)",
  "var(--color-danger)",
  "var(--color-accent)",
  "var(--color-primary-strong)",
  "var(--color-signal-ink)",
]

const AMOUNT_COLOR = "var(--color-info)"
const PRICE_COLOR = "var(--color-signal)"

const formatCLP = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

const formatLiters = (n: number) => {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

// Precio por litro: la métrica que explica el gasto (volumen vs. precio).
const formatPricePerLiter = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}/L`

function tooltipStyle() {
  return {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius)",
    color: "var(--color-text)",
    fontSize: "13px",
  }
}

function groupSmallProductSlices(data: ChartDataPoint[]) {
  const chartData = data
    .map(d => ({
      name: d.group ?? "Otro",
      value: d.totalAmount,
      liters: d.totalLiters,
    }))
    .sort((a, b) => b.value - a.value)
  const total = chartData.reduce((sum, item) => sum + item.value, 0)
  if (chartData.length <= 2 || total <= 0) return chartData

  const visible = chartData.filter((item, index) => index < 5 && item.value / total >= 0.1)
  const grouped = chartData.filter((item, index) => index >= 5 || item.value / total < 0.1)

  if (grouped.length === 0) return visible

  const others = grouped.reduce(
    (acc, item) => ({
      name: "Otros",
      value: acc.value + item.value,
      liters: acc.liters + item.liters,
    }),
    { name: "Otros", value: 0, liters: 0 },
  )

  return [...visible.slice(0, 5), others]
}

/* ── Monthly Evolution (Area Chart) ──────────────────────────────────────── */
export function MonthlyEvolutionChart({ data }: { data: ChartDataPoint[] }) {
  if (data.length === 0) return <EmptyChart label="Sin datos mensuales" />

  const chartData = data.map(d => ({
    month: d.group ?? "?",
    litros: d.totalLiters,
    monto: d.totalAmount,
    // Precio promedio del período (CLP/L). 0 si no hubo litros cargados.
    precio: d.totalLiters > 0 ? d.totalAmount / d.totalLiters : 0,
  }))

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradAmount" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={AMOUNT_COLOR} stopOpacity={0.3} />
              <stop offset="95%" stopColor={AMOUNT_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="month" className="text-xs" tick={{ fill: "var(--color-text-muted)" }} />
          {/* Eje izquierdo = Monto (cuánto se gastó); derecho = Precio $/L (por qué). */}
          <YAxis yAxisId="amount" className="text-xs" tickFormatter={formatCLP} tick={{ fill: AMOUNT_COLOR }} width={60} />
          <YAxis yAxisId="price" orientation="right" className="text-xs" tickFormatter={(v) => formatPricePerLiter(Number(v))} tick={{ fill: PRICE_COLOR }} width={68} domain={[0, "auto"]} />
          <Tooltip
            contentStyle={tooltipStyle()}
            formatter={(value, name) => {
              const n = String(name).toLowerCase()
              if (n === "precio") return [formatPricePerLiter(Number(value)), "Precio prom."]
              return [formatCLP(Number(value)), "Monto CLP"]
            }}
          />
          <Legend iconType="plainline" />
          {/* Monto: área azul rellena (cuánto se gastó). */}
          <Area yAxisId="amount" type="monotone" dataKey="monto" stroke={AMOUNT_COLOR} fill="url(#gradAmount)" strokeWidth={2.5} name="Monto CLP" dot={false} activeDot={{ r: 4 }} />
          {/* Precio promedio: línea punteada; revela si el gasto se mueve por volumen o por precio. */}
          <Area yAxisId="price" type="monotone" dataKey="precio" stroke={PRICE_COLOR} fill="none" strokeWidth={2} strokeDasharray="5 3" name="Precio" dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── By Category (Horizontal Bar Chart) ──────────────────────────────────── */
export function CategoryBarChart({ data, title, onSelect }: { data: ChartDataPoint[]; title: string; onSelect?: (group: string) => void }) {
  if (data.length === 0) return <EmptyChart label={`Sin datos de ${title.toLowerCase()}`} />

  const chartData = data.slice(0, 8).map(d => ({
    name: (d.group ?? "Sin asignar").length > 20 ? (d.group ?? "Sin asignar").substring(0, 20) + "…" : (d.group ?? "Sin asignar"),
    fullName: d.group ?? "Sin asignar",
    monto: d.totalAmount,
    litros: d.totalLiters,
  }))

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }} title={onSelect ? `${title}. Selecciona una barra para filtrar el panel por esta selección.` : title}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          {/* Una sola métrica: gasto (CLP). Los litros viven en el tooltip, no como barra rival. */}
          <XAxis type="number" className="text-xs" tickFormatter={formatCLP} tick={{ fill: "var(--color-text-muted)" }} />
          <YAxis type="category" dataKey="name" width={120} className="text-xs" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
          <Tooltip
            contentStyle={tooltipStyle()}
            formatter={(value, _name, item) => {
              const litros = (item?.payload as { litros?: number } | undefined)?.litros ?? 0
              return [`${formatCLP(Number(value))} · ${formatLiters(litros)} L`, "Gasto"]
            }}
          />
          <Bar
            dataKey="monto"
            radius={[0, 3, 3, 0]}
            name="Gasto"
            fill="var(--color-primary)"
            style={onSelect ? { cursor: "pointer" } : undefined}
            onClick={onSelect ? (entry) => onSelect((entry as unknown as { payload: { fullName: string } }).payload.fullName) : undefined}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── By Product (Pie Chart) ──────────────────────────────────────────────── */
export function ProductPieChart({ data }: { data: ChartDataPoint[] }) {
  if (data.length === 0) return <EmptyChart label="Sin datos de producto" />

  const chartData = groupSmallProductSlices(data)

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={82}
            paddingAngle={3}
            dataKey="value"
            nameKey="name"
            label={({ percent }) => (percent != null && percent >= 0.06 ? `${(percent * 100).toFixed(0)}%` : "")}
            labelLine={false}
          >
            {chartData.map((entry, i) => <Cell key={entry.name} fill={COLORS[i % COLORS.length]} stroke="var(--color-surface)" strokeWidth={2} />)}
          </Pie>
          <Tooltip
            contentStyle={tooltipStyle()}
            formatter={(value, name, item) => {
              const litros = (item?.payload as { liters?: number } | undefined)?.liters ?? 0
              return [`${formatCLP(Number(value))} · ${formatLiters(litros)} L`, String(name)]
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            iconType="circle"
            formatter={(value) => <span className="text-xs text-[var(--color-text-muted)]">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── Empty State ─────────────────────────────────────────────────────────── */
function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-64 items-center justify-center border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 text-center text-sm text-[var(--color-text-muted)]">
      {label}
    </div>
  )
}
