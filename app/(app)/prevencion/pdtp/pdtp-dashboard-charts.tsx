"use client"

import type { ReactNode } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { EmptyState } from "@/components/ui/empty-state"
import { ChartDataTable } from "@/components/ui/chart-data-table"

export type MonthlyTrendData = { monthName: string; scheduled: number; executed: number; compliancePercent: number }
export type WorksiteComplianceData = { name: string; percent: number; executed: number; scheduled: number }
export type CategoryBreakdownData = { category: string; scheduled: number; executed: number; percent: number }

interface PdtpDashboardChartsProps {
  monthlyTrend: MonthlyTrendData[]
  worksiteCompliance: WorksiteComplianceData[]
  categoryBreakdown: CategoryBreakdownData[]
}

const trendConfig = {
  scheduled: { label: "Programadas", color: "var(--color-text-faint)" },
  executed: { label: "Ejecutadas", color: "var(--color-primary)" },
} satisfies ChartConfig
const worksiteConfig = { percent: { label: "% Cumplimiento", color: "var(--color-primary)" } } satisfies ChartConfig
const categoryConfig = {
  scheduled: { label: "Programadas", color: "var(--color-border-strong)" },
  executed: { label: "Ejecutadas", color: "var(--color-primary)" },
} satisfies ChartConfig

/**
 * La lectura equivalente va **antes** del gráfico (TASK-UI-015): responde la
 * pregunta sin depender del color ni del tamaño de la pantalla, y el gráfico
 * queda como detalle.
 */
function ChartSection({ title, description, summary, children }: { title: string; description: string; summary?: ReactNode; children: ReactNode }) {
  return <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs"><div className="mb-4"><h2 className="text-h3 text-[var(--color-text)]">{title}</h2><p className="mt-1 text-xs text-[var(--color-text-muted)]">{description}</p></div>{summary}{children}</section>
}

const pct = (value: number) => `${Math.round(value)}%`

function trendConclusion(rows: MonthlyTrendData[]): string {
  if (rows.length === 0) return "Todavía no hay ejecuciones registradas."
  const last = rows[rows.length - 1]!
  const total = rows.reduce((sum, row) => ({ scheduled: sum.scheduled + row.scheduled, executed: sum.executed + row.executed }), { scheduled: 0, executed: 0 })
  const acumulado = total.scheduled === 0 ? 0 : (total.executed / total.scheduled) * 100
  return `En ${last.monthName} se ejecutaron ${last.executed} de ${last.scheduled} actividades programadas. Acumulado del período: ${pct(acumulado)}.`
}

function worksiteConclusion(rows: WorksiteComplianceData[]): string {
  if (rows.length === 0) return "Ninguna faena tiene actividades planificadas."
  const peor = rows.reduce((current, row) => row.percent < current.percent ? row : current, rows[0]!)
  const mejor = rows.reduce((current, row) => row.percent > current.percent ? row : current, rows[0]!)
  if (rows.length === 1) return `Única faena con planificación: ${mejor.name}, ${pct(mejor.percent)} (${mejor.executed}/${mejor.scheduled}).`
  return `${peor.name} es la faena más rezagada con ${pct(peor.percent)} (${peor.executed}/${peor.scheduled}); la más avanzada es ${mejor.name} con ${pct(mejor.percent)}.`
}

function categoryConclusion(rows: CategoryBreakdownData[]): string {
  if (rows.length === 0) return "No hay ejes configurados en el programa."
  const peor = rows.reduce((current, row) => row.percent < current.percent ? row : current, rows[0]!)
  return `El eje con menor avance es ${peor.category}: ${pct(peor.percent)} (${peor.executed} de ${peor.scheduled}).`
}

export function PdtpDashboardCharts({ monthlyTrend, worksiteCompliance, categoryBreakdown }: PdtpDashboardChartsProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartSection title="Tendencia de ejecución mensual" description="Actividades programadas frente a ejecuciones registradas con evidencia."
          summary={<ChartDataTable
            title="Tendencia de ejecución mensual"
            groupLabel="Mes"
            columns={["Programadas", "Ejecutadas", "Cumplimiento"]}
            rows={monthlyTrend.map((row) => ({ label: row.monthName, values: [row.scheduled, row.executed, pct(row.compliancePercent)] }))}
            conclusion={trendConclusion(monthlyTrend)}
            caption="Actividades del programa anual vigente."
            className="mb-4 mt-0 border-b border-t-0 pb-3 pt-0"
          />}>
          {monthlyTrend.length === 0 ? <EmptyState compact title="Sin tendencia de ejecución" description="Registra la primera ejecución desde Actividades del programa." /> : <ChartContainer config={trendConfig} className="h-64 w-full"><AreaChart data={monthlyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}><defs><linearGradient id="pdtp-executed" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="monthName" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} /><ChartTooltip content={<ChartTooltipContent indicator="dot" />} /><ChartLegend content={<ChartLegendContent />} /><Area type="monotone" dataKey="scheduled" stroke="var(--color-text-faint)" fill="none" strokeWidth={1.5} /><Area type="monotone" dataKey="executed" stroke="var(--color-primary)" fill="url(#pdtp-executed)" strokeWidth={2.5} /></AreaChart></ChartContainer>}
        </ChartSection>
        <ChartSection title="Cumplimiento por faena" description="Comparativa de las faenas autorizadas. Selecciona una faena para operar sus actividades."
          summary={<ChartDataTable
            title="Cumplimiento por faena"
            groupLabel="Faena"
            columns={["Cumplimiento", "Ejecutadas", "Programadas"]}
            rows={worksiteCompliance.map((row) => ({ label: row.name, values: [pct(row.percent), row.executed, row.scheduled] }))}
            conclusion={worksiteConclusion(worksiteCompliance)}
            caption="El color de la barra codifica el mismo umbral que la columna Cumplimiento."
            className="mb-4 mt-0 border-b border-t-0 pb-3 pt-0"
          />}>
          {worksiteCompliance.length === 0 ? <EmptyState compact title="Sin faenas con planificación" description="Cuando existan actividades planificadas aparecerán aquí." /> : <ChartContainer config={worksiteConfig} className="h-64 w-full"><BarChart data={worksiteCompliance} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} /><YAxis dataKey="name" type="category" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><ChartTooltip content={<ChartTooltipContent formatter={(value, _name, item) => [item?.payload ? `${value}% (${item.payload.executed}/${item.payload.scheduled})` : `${value}%`, "% Cumplimiento"]} />} /><Bar dataKey="percent" radius={[0, 4, 4, 0]} barSize={18}>{worksiteCompliance.map((entry) => <Cell key={entry.name} fill={entry.percent >= 80 ? "var(--color-success)" : entry.percent >= 50 ? "var(--color-warning-ink)" : "var(--color-danger)"} />)}</Bar></BarChart></ChartContainer>}
        </ChartSection>
      </div>
      <ChartSection title="Avance por eje del sistema de gestión" description="Planificado frente a ejecuciones aprobadas, agrupado por eje operacional."
        summary={<ChartDataTable
          title="Avance por eje del sistema de gestión"
          groupLabel="Eje"
          columns={["Programadas", "Ejecutadas", "Avance"]}
          rows={categoryBreakdown.map((row) => ({ label: row.category, values: [row.scheduled, row.executed, pct(row.percent)] }))}
          conclusion={categoryConclusion(categoryBreakdown)}
          className="mb-4 mt-0 border-b border-t-0 pb-3 pt-0"
        />}>
        {categoryBreakdown.length === 0 ? <EmptyState compact title="Sin ejes para mostrar" description="Los ejes aparecerán al configurar las actividades del programa." /> : <ChartContainer config={categoryConfig} className="h-56 w-full"><BarChart data={categoryBreakdown} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="category" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} allowDecimals={false} /><ChartTooltip content={<ChartTooltipContent indicator="dashed" />} /><ChartLegend content={<ChartLegendContent />} /><Bar dataKey="scheduled" fill="var(--color-border-strong)" radius={[4, 4, 0, 0]} /><Bar dataKey="executed" fill="var(--color-primary)" radius={[4, 4, 0, 0]} /></BarChart></ChartContainer>}
      </ChartSection>
    </div>
  )
}
