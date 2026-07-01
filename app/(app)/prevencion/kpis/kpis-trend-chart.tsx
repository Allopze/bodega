"use client"

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

interface MonthPoint {
  month: number
  planned: number
  executed: number
  percent: number | null
}

function tooltipStyle() {
  return {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius)",
    color: "var(--color-text)",
    fontSize: "13px",
  }
}

export function KpisTrendChart({ monthly }: { monthly: MonthPoint[] }) {
  if (monthly.every((m) => m.planned === 0 && m.executed === 0)) {
    return (
      <div className="flex h-64 items-center justify-center border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 text-center text-sm text-[var(--color-text-muted)]">
        Sin datos de cumplimiento mensual para graficar.
      </div>
    )
  }

  const data = monthly.map((m) => ({
    mes: `M${m.month}`,
    cumplimiento: m.percent !== null ? Math.round(m.percent * 100) : 0,
  }))

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradCumplimiento" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="mes" className="text-xs" tick={{ fill: "var(--color-text-muted)" }} />
          <YAxis className="text-xs" tickFormatter={(v) => `${v}%`} domain={[0, 100]} tick={{ fill: "var(--color-text-muted)" }} width={40} />
          <Tooltip contentStyle={tooltipStyle()} formatter={(value) => [`${value}%`, "Cumplimiento"]} />
          <Area type="monotone" dataKey="cumplimiento" stroke="var(--color-primary)" fill="url(#gradCumplimiento)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
