"use client"

import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from "recharts"
import type { MaterialEnvironmentalData } from "./material-environmental-dashboard"
import { chartTooltipStyle } from "@/lib/chart-palette"
import { ChartDataTable } from "@/components/ui/chart-data-table"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function ChartCard({ title, summary, children }: { title: string; summary?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="mb-3 text-sm font-medium text-[var(--color-text-muted)]">{title}</p>
      {summary}
      <ResponsiveContainer width="100%" height={280}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  )
}

/**
 * Tres series distinguidas sólo por color en cuatro gráficos (TASK-UI-015).
 * Las tablas no se repiten cuatro veces: los cuatro gráficos dibujan dos
 * conjuntos de datos, así que hay dos tablas y los otros dos gráficos remiten a
 * ellas — duplicar la misma tabla sería ruido, no accesibilidad.
 */
const SERIES = ["Inc. peligrosos", "Daño material", "Daño ambiental"] as const
type SeriesRow = Record<(typeof SERIES)[number], number>

function totals(rows: SeriesRow[]) {
  return SERIES.map((serie) => ({ serie, total: rows.reduce((sum, row) => sum + row[serie], 0) }))
}

function dominantSeries(rows: SeriesRow[]): string {
  const sums = totals(rows)
  const top = sums.reduce((current, row) => row.total > current.total ? row : current, sums[0]!)
  const total = sums.reduce((sum, row) => sum + row.total, 0)
  if (total === 0) return "No se registró ningún evento en el período."
  return `${top.serie} concentra la mayoría: ${top.total} de ${total} eventos.`
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
      <ChartCard title="Eventos por tipo · desglose mensual" summary={<ChartDataTable
        title="Eventos por tipo · desglose mensual"
        groupLabel="Mes"
        columns={[...SERIES]}
        rows={monthlyData.map((row) => ({ label: row.month ?? "—", values: SERIES.map((serie) => row[serie]) }))}
        conclusion={dominantSeries(monthlyData)}
        caption="Eventos registrados en el año seleccionado."
        className="mb-3 mt-0 border-b border-t-0 pb-3 pt-0"
      />}>
        <BarChart data={monthlyData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} allowDecimals={false} />
          <Tooltip contentStyle={chartTooltipStyle()} />
          <Legend />
          <Bar dataKey="Inc. peligrosos" name="Inc. peligrosos" fill="var(--color-signal)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Daño material" name="Daño material" fill="var(--color-warning)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Daño ambiental" name="Daño ambiental" fill="var(--color-info)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard title="Tendencia mensual de eventos" summary={<p className="mb-3 text-xs text-[var(--color-text-muted)]">Redibuja como línea los mismos datos de &ldquo;Eventos por tipo&rdquo;; su tabla equivalente está en esa tarjeta.</p>}>
        <LineChart data={monthlyData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} allowDecimals={false} />
          <Tooltip contentStyle={chartTooltipStyle()} />
          <Legend />
          <Line type="monotone" dataKey="Inc. peligrosos" name="Inc. peligrosos" stroke="var(--color-signal)" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="Daño material" name="Daño material" stroke="var(--color-warning)" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="Daño ambiental" name="Daño ambiental" stroke="var(--color-info)" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ChartCard>

      <ChartCard title="Total eventos por faena (anual)" summary={<ChartDataTable
        title="Total eventos por faena"
        groupLabel="Faena"
        columns={[...SERIES, "Total"]}
        rows={worksiteData.map((row) => ({
          label: row.name,
          values: [...SERIES.map((serie) => row[serie]), SERIES.reduce((sum, serie) => sum + row[serie], 0)],
        }))}
        conclusion={worksiteData.length === 0
          ? "Ninguna faena registró eventos en el año."
          : `La faena con más eventos es ${worksiteData.reduce((current, row) => SERIES.reduce((s, k) => s + row[k], 0) > SERIES.reduce((s, k) => s + current[k], 0) ? row : current, worksiteData[0]!).name}.`}
        caption="Las barras están apiladas: el largo total es la suma de las tres series."
        className="mb-3 mt-0 border-b border-t-0 pb-3 pt-0"
      />}>
        <BarChart data={worksiteData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis type="number" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} width={140} />
          <Tooltip contentStyle={chartTooltipStyle()} />
          <Legend />
          <Bar dataKey="Inc. peligrosos" name="Inc. peligrosos" fill="var(--color-signal)" radius={[0, 4, 4, 0]} stackId="a" />
          <Bar dataKey="Daño material" name="Daño material" fill="var(--color-warning)" radius={[0, 4, 4, 0]} stackId="a" />
          <Bar dataKey="Daño ambiental" name="Daño ambiental" fill="var(--color-info)" radius={[0, 4, 4, 0]} stackId="a" />
        </BarChart>
      </ChartCard>

      <ChartCard title="Distribución anual acumulada" summary={<p className="mb-3 text-xs text-[var(--color-text-muted)]">Combina barra y línea sobre los mismos datos de &ldquo;Eventos por tipo&rdquo;; su tabla equivalente está en esa tarjeta.</p>}>
        <ComposedChart data={monthlyData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} allowDecimals={false} />
          <Tooltip contentStyle={chartTooltipStyle()} />
          <Legend />
          <Bar dataKey="Daño material" name="Daño material" fill="var(--color-warning)" radius={[4, 4, 0, 0]} opacity={0.6} />
          <Line type="monotone" dataKey="Daño ambiental" name="Daño ambiental" stroke="var(--color-info)" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="Inc. peligrosos" name="Inc. peligrosos" stroke="var(--color-signal)" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} />
        </ComposedChart>
      </ChartCard>
    </div>
  )
}
