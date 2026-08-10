"use client"

import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { chartTooltipStyle } from "@/lib/chart-palette"

const STATUS_LABELS: Record<string, string> = {
  open: "Abierto",
  in_review: "En revisión",
  resolved: "Resuelto",
  dismissed: "Descartado",
  reopened: "Reabierto",
}

const SEVERITY_LABELS: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
}

const STATUS_COLORS: Record<string, string> = {
  open: "var(--color-danger)",
  in_review: "var(--color-warning)",
  resolved: "var(--color-success)",
  dismissed: "var(--color-text-muted)",
  reopened: "var(--color-signal)",
}

const SEVERITY_COLORS = [
  "var(--color-info)",
  "var(--color-warning)",
  "var(--color-danger)",
  "var(--color-danger-strong)",
]

const RULE_COLORS = [
  "var(--color-primary)",
  "var(--color-signal)",
  "var(--color-info)",
  "var(--color-warning)",
  "var(--color-danger)",
  "var(--color-accent)",
  "var(--color-primary-strong)",
  "var(--color-signal-ink)",
]

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-48 items-center justify-center border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 text-center text-sm text-[var(--color-text-muted)]">
      {label}
    </div>
  )
}

interface DistributionData {
  byStatus: Array<{ status: string; count: number }>
  bySeverity: Array<{ severity: string; count: number }>
  byRuleCode: Array<{ ruleCode: string; ruleName: string | null; count: number }>
  total: number
}

export function AnomalyDistributionChart({ distribution }: { distribution: DistributionData }) {
  if (distribution.total === 0) return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="border border-(--color-border) bg-(--color-surface) p-4">
        <h3 className="mb-2 text-sm font-medium">Casos por estado</h3>
        <EmptyChart label="Sin casos registrados" />
      </div>
      <div className="border border-(--color-border) bg-(--color-surface) p-4">
        <h3 className="mb-2 text-sm font-medium">Casos por severidad</h3>
        <EmptyChart label="Sin casos registrados" />
      </div>
    </div>
  )

  const statusData = distribution.byStatus
    .filter((d) => d.status && d.count > 0)
    .map((d) => ({ name: STATUS_LABELS[d.status] ?? d.status, value: d.count, fill: STATUS_COLORS[d.status] ?? "var(--color-text-muted)" }))

  const severityData = distribution.bySeverity
    .filter((d) => d.severity && d.count > 0)
    .map((d) => ({ name: SEVERITY_LABELS[d.severity] ?? d.severity, value: d.count }))

  const ruleData = distribution.byRuleCode
    .filter((d) => d.ruleCode && d.count > 0)
    .slice(0, 8)
    .map((d, i) => ({ name: d.ruleName ?? d.ruleCode, value: d.count, fill: RULE_COLORS[i % RULE_COLORS.length] }))


  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* Casos por estado — bar chart vertical simple */}
      <div className="border border-(--color-border) bg-(--color-surface) p-4">
        <h3 className="mb-3 text-sm font-medium">Casos por estado</h3>
        <p className="mb-2 text-xs text-(--color-text-muted)">{distribution.total} total</p>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={statusData} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="name" className="text-xs" tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} />
              <YAxis className="text-xs" tick={{ fill: "var(--color-text-muted)" }} width={30} />
              <Tooltip contentStyle={chartTooltipStyle()} formatter={(value) => [value, "Casos"]} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]} name="Casos">
                {statusData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Casos por severidad — donut */}
      <div className="border border-(--color-border) bg-(--color-surface) p-4">
        <h3 className="mb-3 text-sm font-medium">Casos por severidad</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={severityData}
                cx="50%" cy="50%"
                innerRadius={36}
                outerRadius={60}
                paddingAngle={3}
                dataKey="value"
                nameKey="name"
                label={({ percent }) => (percent != null && percent >= 0.08 ? `${(percent * 100).toFixed(0)}%` : "")}
                labelLine={false}
              >
                {severityData.map((entry, i) => <Cell key={entry.name} fill={SEVERITY_COLORS[i % SEVERITY_COLORS.length]} stroke="var(--color-surface)" strokeWidth={2} />)}
              </Pie>
              <Tooltip contentStyle={chartTooltipStyle()} formatter={(value, name) => [value, String(name)]} />
              <Legend
                verticalAlign="bottom"
                height={28}
                iconType="circle"
                formatter={(value) => <span className="text-xs text-[var(--color-text-muted)]">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top reglas de anomalía — bar chart horizontal */}
      <div className="border border-(--color-border) bg-(--color-surface) p-4">
        <h3 className="mb-3 text-sm font-medium">Top reglas activas</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ruleData} layout="vertical" margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" className="text-xs" tick={{ fill: "var(--color-text-muted)" }} width={30} />
              <YAxis type="category" dataKey="name" width={100} className="text-xs" tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} />
              <Tooltip contentStyle={chartTooltipStyle()} formatter={(value) => [value, "Casos"]} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]} name="Casos">
                {ruleData.map((entry, i) => <Cell key={entry.name} fill={entry.fill ?? RULE_COLORS[i % RULE_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
