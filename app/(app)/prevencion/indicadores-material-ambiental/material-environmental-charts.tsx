"use client"

import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from "recharts"
import type { MaterialEnvironmentalData } from "./material-environmental-dashboard"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function tooltipStyle() {
  return {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius)",
    color: "var(--color-text)",
    fontSize: "13px",
  }
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="mb-3 text-sm font-medium text-[var(--color-text-muted)]">{title}</p>
      <ResponsiveContainer width="100%" height={280}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  )
}

export default function MaterialEnvironmentalCharts({
  selectedData,
  eventData,
}: {
  selectedData: MaterialEnvironmentalData
  eventData: MaterialEnvironmentalData[]
}) {
  const monthlyData = selectedData.monthly.map((item) => ({
    month: MONTH_LABELS[item.month - 1],
    "Inc. peligrosos": item.dangerousIncidents,
    "Daño material": item.materialDamage,
    "Daño ambiental": item.environmentalSpills,
  }))

  const worksiteData = eventData
    .filter((item) => item.worksiteId !== "total")
    .map((item) => ({
      name: item.worksiteName,
      "Inc. peligrosos": item.annual.dangerousIncidents,
      "Daño material": item.annual.materialDamage,
      "Daño ambiental": item.annual.environmentalSpills,
    }))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard title="Eventos por tipo · desglose mensual">
        <BarChart data={monthlyData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Legend />
          <Bar dataKey="Inc. peligrosos" name="Inc. peligrosos" fill="var(--color-signal)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Daño material" name="Daño material" fill="var(--color-warning)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Daño ambiental" name="Daño ambiental" fill="var(--color-info)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard title="Tendencia mensual de eventos">
        <LineChart data={monthlyData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Legend />
          <Line type="monotone" dataKey="Inc. peligrosos" name="Inc. peligrosos" stroke="var(--color-signal)" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="Daño material" name="Daño material" stroke="var(--color-warning)" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="Daño ambiental" name="Daño ambiental" stroke="var(--color-info)" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ChartCard>

      <ChartCard title="Total eventos por faena (anual)">
        <BarChart data={worksiteData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis type="number" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} width={140} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Legend />
          <Bar dataKey="Inc. peligrosos" name="Inc. peligrosos" fill="var(--color-signal)" radius={[0, 4, 4, 0]} stackId="a" />
          <Bar dataKey="Daño material" name="Daño material" fill="var(--color-warning)" radius={[0, 4, 4, 0]} stackId="a" />
          <Bar dataKey="Daño ambiental" name="Daño ambiental" fill="var(--color-info)" radius={[0, 4, 4, 0]} stackId="a" />
        </BarChart>
      </ChartCard>

      <ChartCard title="Distribución anual acumulada">
        <ComposedChart data={monthlyData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Legend />
          <Bar dataKey="Daño material" name="Daño material" fill="var(--color-warning)" radius={[4, 4, 0, 0]} opacity={0.6} />
          <Line type="monotone" dataKey="Daño ambiental" name="Daño ambiental" stroke="var(--color-info)" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="Inc. peligrosos" name="Inc. peligrosos" stroke="var(--color-signal)" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} />
        </ComposedChart>
      </ChartCard>
    </div>
  )
}
