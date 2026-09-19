"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { EmptyState } from "@/components/ui/empty-state"

export type MonthlyTrendData = { monthName: string; scheduled: number; executed: number; compliancePercent: number }
export type WorksiteComplianceData = { name: string; percent: number; executed: number; scheduled: number }
export type CategoryBreakdownData = { category: string; scheduled: number; executed: number; percent: number }

interface PdtpDashboardChartsProps {
  monthlyTrend: MonthlyTrendData[]
  worksiteCompliance: WorksiteComplianceData[]
  categoryBreakdown: CategoryBreakdownData[]
  operationalHref: string
}

const trendConfig = {
  scheduled: { label: "Programadas", color: "var(--color-text-faint)" },
  executed: { label: "Ejecutadas", color: "var(--color-primary)" },
} satisfies ChartConfig
const worksiteConfig = { percent: { label: "% Cumplimiento", color: "var(--color-primary)" } } satisfies ChartConfig

/**
 * La lectura equivalente va **antes** del gráfico (TASK-UI-015): responde la
 * pregunta sin depender del color ni del tamaño de la pantalla, y el gráfico
 * queda como detalle.
 *
 * La tendencia mensual usa `type="linear"`, no "monotone": son conteos
 * mensuales discretos, y una curva suave dibuja picos entre meses que no
 * existen (auditoría UI/UX, Corte 7). `allowDecimals={false}` en el eje Y
 * evita ticks fraccionarios (0.5, 1.5) cuando el máximo del mes es un número
 * chico — un conteo de ejecuciones nunca es fraccionario.
 */
function ChartSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs"><div className="mb-4"><h2 className="text-h3 text-[var(--color-text)]">{title}</h2><p className="mt-1 text-xs text-[var(--color-text-muted)]">{description}</p></div>{children}</section>
}

function NoAccreditedExecutions({ href }: { href: string }) {
  return <EmptyState compact title="Aún no hay ejecuciones acreditadas" description="Registra el trabajo operativo para que el avance aparezca aquí." action={<Button asChild size="sm"><Link href={href}>Ir al trabajo operativo</Link></Button>} />
}

export function PdtpDashboardCharts({ monthlyTrend, worksiteCompliance, categoryBreakdown, operationalHref }: PdtpDashboardChartsProps) {
  const hasMonthlyExecutions = monthlyTrend.some((entry) => entry.executed > 0)
  const hasWorksiteExecutions = worksiteCompliance.some((entry) => entry.executed > 0)
  const hasCategoryExecutions = categoryBreakdown.some((entry) => entry.executed > 0)
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartSection title="Tendencia de ejecución mensual" description="Actividades programadas frente a ejecuciones registradas con evidencia.">
          {!hasMonthlyExecutions ? <NoAccreditedExecutions href={operationalHref} /> : <ChartContainer config={trendConfig} className="h-64 w-full"><AreaChart data={monthlyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}><defs><linearGradient id="pdtp-executed" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="monthName" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} /><ChartTooltip content={<ChartTooltipContent indicator="dot" />} /><ChartLegend content={<ChartLegendContent />} /><Area type="linear" dataKey="scheduled" stroke="var(--color-text-faint)" fill="none" strokeWidth={1.5} /><Area type="linear" dataKey="executed" stroke="var(--color-primary)" fill="url(#pdtp-executed)" strokeWidth={2.5} /></AreaChart></ChartContainer>}
        </ChartSection>
        <ChartSection title="Cumplimiento por faena" description="Comparativa de todas las faenas autorizadas. El selector de faena filtra la tendencia y el avance por eje.">
        {!hasWorksiteExecutions ? <NoAccreditedExecutions href={operationalHref} /> : worksiteCompliance.length === 0 ? <EmptyState compact title="Sin faenas con planificación" description="Cuando existan actividades planificadas aparecerán aquí." /> : <ChartContainer config={worksiteConfig} className="h-64 w-full"><BarChart data={worksiteCompliance} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} /><YAxis dataKey="name" type="category" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><ChartTooltip content={<ChartTooltipContent formatter={(value, _name, item) => [item?.payload ? `${value}% · Plan ${item.payload.scheduled} · ejecutado ${item.payload.executed}` : `${value}%`, "% Cumplimiento"]} />} /><Bar dataKey="percent" radius={[0, 4, 4, 0]} barSize={18}>{worksiteCompliance.map((entry) => <Cell key={entry.name} fill={entry.percent >= 80 ? "var(--color-success)" : entry.percent >= 50 ? "var(--color-warning-ink)" : "var(--color-danger)"} />)}</Bar></BarChart></ChartContainer>}
        </ChartSection>
      </div>
      <ChartSection title="Avance por eje del sistema de gestión" description="Planificado frente a ejecuciones aprobadas, agrupado por eje operacional.">
        {!hasCategoryExecutions ? <NoAccreditedExecutions href={operationalHref} /> : categoryBreakdown.length === 0 ? <EmptyState compact title="Sin ejes para mostrar" description="Los ejes aparecerán al configurar las actividades del programa." /> : <ol className="divide-y divide-[var(--color-border)]">{[...categoryBreakdown].sort((a, b) => b.percent - a.percent || b.executed - a.executed).map((entry) => <li key={entry.category} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 py-3 text-sm"><span className="min-w-0 truncate font-medium text-[var(--color-text)]">{entry.category}</span><span className="text-xs text-[var(--color-text-muted)]">Plan {entry.scheduled}</span><span className="text-xs text-[var(--color-text-muted)]">Ejecutado {entry.executed}</span><span className="font-mono text-xs font-semibold text-[var(--color-text)]">{entry.percent}%</span></li>)}</ol>}
      </ChartSection>
    </div>
  )
}
