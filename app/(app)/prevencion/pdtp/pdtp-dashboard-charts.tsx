"use client"

import type { ReactNode } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { EmptyState } from "@/components/ui/empty-state"

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

function ChartSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs"><div className="mb-4"><h2 className="text-h3 text-[var(--color-text)]">{title}</h2><p className="mt-1 text-xs text-[var(--color-text-muted)]">{description}</p></div>{children}</section>
}

export function PdtpDashboardCharts({ monthlyTrend, worksiteCompliance, categoryBreakdown }: PdtpDashboardChartsProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartSection title="Tendencia de ejecución mensual" description="Actividades programadas frente a ejecuciones registradas con evidencia.">
          {monthlyTrend.length === 0 ? <EmptyState compact title="Sin tendencia de ejecución" description="Registra la primera ejecución desde Actividades del programa." /> : <ChartContainer config={trendConfig} className="h-64 w-full"><AreaChart data={monthlyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}><defs><linearGradient id="pdtp-executed" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="monthName" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} /><ChartTooltip content={<ChartTooltipContent indicator="dot" />} /><ChartLegend content={<ChartLegendContent />} /><Area type="monotone" dataKey="scheduled" stroke="var(--color-text-faint)" fill="none" strokeWidth={1.5} /><Area type="monotone" dataKey="executed" stroke="var(--color-primary)" fill="url(#pdtp-executed)" strokeWidth={2.5} /></AreaChart></ChartContainer>}
        </ChartSection>
        <ChartSection title="Cumplimiento por faena" description="Comparativa de las faenas autorizadas. Selecciona una faena para operar sus actividades.">
          {worksiteCompliance.length === 0 ? <EmptyState compact title="Sin faenas con planificación" description="Cuando existan actividades planificadas aparecerán aquí." /> : <ChartContainer config={worksiteConfig} className="h-64 w-full"><BarChart data={worksiteCompliance} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} /><YAxis dataKey="name" type="category" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><ChartTooltip content={<ChartTooltipContent formatter={(value, _name, item) => [item?.payload ? `${value}% (${item.payload.executed}/${item.payload.scheduled})` : `${value}%`, "% Cumplimiento"]} />} /><Bar dataKey="percent" radius={[0, 4, 4, 0]} barSize={18}>{worksiteCompliance.map((entry) => <Cell key={entry.name} fill={entry.percent >= 80 ? "var(--color-success)" : entry.percent >= 50 ? "var(--color-warning-ink)" : "var(--color-danger)"} />)}</Bar></BarChart></ChartContainer>}
        </ChartSection>
      </div>
      <ChartSection title="Avance por eje del sistema de gestión" description="Planificado frente a ejecuciones aprobadas, agrupado por eje operacional.">
        {categoryBreakdown.length === 0 ? <EmptyState compact title="Sin ejes para mostrar" description="Los ejes aparecerán al configurar las actividades del programa." /> : <ChartContainer config={categoryConfig} className="h-56 w-full"><BarChart data={categoryBreakdown} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="category" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} allowDecimals={false} /><ChartTooltip content={<ChartTooltipContent indicator="dashed" />} /><ChartLegend content={<ChartLegendContent />} /><Bar dataKey="scheduled" fill="var(--color-border-strong)" radius={[4, 4, 0, 0]} /><Bar dataKey="executed" fill="var(--color-primary)" radius={[4, 4, 0, 0]} /></BarChart></ChartContainer>}
      </ChartSection>
    </div>
  )
}
