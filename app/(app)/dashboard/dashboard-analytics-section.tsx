"use client"

import dynamic from "next/dynamic"
import type { ReactNode } from "react"
import type { SstMonthlyPoint, MaterialEnvironmentalPoint, FuelMonthlyChartPoint, MaintenanceMonthlyChartPoint, ModuleWorkloadPoint } from "./dashboard-charts"

// Recharts es ~168kb sin usar en el bundle inicial (auditoría UIUX-002): cada
// gráfico se difiere a su propio chunk y sólo se ejecuta tras la carga
// principal, en vez de competir por el hilo principal con el Centro de Control.
function chartSkeleton(heightClass: string) {
  return function ChartSkeleton() {
    return (
      <div className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs animate-pulse ${heightClass}`}>
        <div className="mb-3 h-3 w-40 rounded bg-[var(--color-surface-2)]" />
        <div className="h-[calc(100%-2rem)] w-full rounded bg-[var(--color-surface-2)]" />
      </div>
    )
  }
}

const dynamicChartOptions = { ssr: false }

const OperationalTrendChart = dynamic(() => import("./dashboard-charts").then((m) => m.OperationalTrendChart), { ...dynamicChartOptions, loading: chartSkeleton("h-64") })
const ModuleWorkloadChart = dynamic(() => import("./dashboard-charts").then((m) => m.ModuleWorkloadChart), { ...dynamicChartOptions, loading: chartSkeleton("h-64") })
const WorksiteActivityChart = dynamic(() => import("./dashboard-charts").then((m) => m.WorksiteActivityChart), { ...dynamicChartOptions, loading: chartSkeleton("h-72") })
const SstTrendChart = dynamic(() => import("./dashboard-charts").then((m) => m.SstTrendChart), { ...dynamicChartOptions, loading: chartSkeleton("h-64") })
const SstAccidentChart = dynamic(() => import("./dashboard-charts").then((m) => m.SstAccidentChart), { ...dynamicChartOptions, loading: chartSkeleton("h-64") })
const MaterialEnvironmentalChart = dynamic(() => import("./dashboard-charts").then((m) => m.MaterialEnvironmentalChart), { ...dynamicChartOptions, loading: chartSkeleton("h-64") })
const FuelConsumptionChart = dynamic(() => import("./dashboard-charts").then((m) => m.FuelConsumptionChart), { ...dynamicChartOptions, loading: chartSkeleton("h-64") })
const MaintenanceTrendChart = dynamic(() => import("./dashboard-charts").then((m) => m.MaintenanceTrendChart), { ...dynamicChartOptions, loading: chartSkeleton("h-64") })

interface DashboardAnalyticsSectionProps {
  trendData: Array<{ month: string; requests: number; orders: number; receipts: number }>
  /** Conteos por módulo del backlog completo, no de las filas cargadas. */
  moduleWorkload: ModuleWorkloadPoint[]
  queueTotal: number
  worksitesBreakdown: { name: string; totalCost: number }[]
  fuelTrend: FuelMonthlyChartPoint[]
  maintenanceTrend: MaintenanceMonthlyChartPoint[]
  sstPoints: SstMonthlyPoint[]
  materialEnvPoints: MaterialEnvironmentalPoint[]
}

/**
 * Cada bloque rotula su propio período. El encabezado global decía "Datos del
 * año en curso" sobre gráficos que en su mayoría son de los últimos 6 meses o
 * acumulados sin período (L-07).
 */
function AnalyticsGroup({ id, title, period, children }: {
  id: string
  title: string
  period: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={id} className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
        <span className="text-[11px] font-medium text-[var(--color-text-muted)]">{period}</span>
      </div>
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">{children}</div>
    </section>
  )
}

export function DashboardAnalyticsSection({
  trendData,
  moduleWorkload,
  queueTotal,
  worksitesBreakdown,
  fuelTrend,
  maintenanceTrend,
  sstPoints,
  materialEnvPoints,
}: DashboardAnalyticsSectionProps) {
  const hasTrendData = trendData.some((d) => d.requests > 0 || d.orders > 0 || d.receipts > 0)
  const hasSstData = sstPoints.length > 0
  const hasMaterialEnvData = materialEnvPoints.length > 0
  // Mismo criterio que el guard interno de cada gráfico: si difieren, la sección
  // reserva el hueco y el gráfico devuelve `null` dentro (tarjeta vacía).
  const hasFuelData = fuelTrend.some((d) => d.liters > 0 || d.amount > 0)
  const hasMaintenanceData = maintenanceTrend.some((d) => d.completed > 0 || d.scheduled > 0 || d.amount > 0)
  const hasWorkloadData = moduleWorkload.length > 0
  const hasWorksiteData = worksitesBreakdown.length > 0

  const hasOperation = hasTrendData || hasWorkloadData || hasWorksiteData
  const hasPrevention = hasSstData || hasMaterialEnvData
  const hasFleet = hasFuelData || hasMaintenanceData
  if (!hasOperation && !hasPrevention && !hasFleet) return null

  return (
    <section className="mb-6 flex flex-col gap-6" aria-labelledby="analitica-dashboard">
      <h2 id="analitica-dashboard" className="text-h3 text-[var(--color-text)]">Analítica y tendencias</h2>

      {hasOperation && (
        <AnalyticsGroup id="analitica-operacion" title="Operación" period="Últimos 6 meses">
          {hasTrendData && <OperationalTrendChart data={trendData} />}
          {hasWorkloadData && <ModuleWorkloadChart data={moduleWorkload} total={queueTotal} />}
        </AnalyticsGroup>
      )}

      {/* "Inversión por faena" no comparte el período de "Operación": su query no
          filtra por fecha (`dashboard-metrics.ts`). Vivía bajo el rótulo
          "Últimos 6 meses" mientras su propio subtítulo decía "acumulado
          histórico" — el hallazgo L-07 reintroducido a nivel de grupo. Va en su
          bloque hasta que tenga un período real. */}
      {hasWorksiteData && (
        <AnalyticsGroup id="analitica-inversion" title="Inversión" period="Acumulado histórico">
          <WorksiteActivityChart worksites={worksitesBreakdown} />
        </AnalyticsGroup>
      )}

      {hasPrevention && (
        <AnalyticsGroup id="analitica-prevencion" title="Prevención y SST" period="Año en curso">
          {hasSstData && <SstTrendChart data={sstPoints} />}
          {hasSstData && <SstAccidentChart data={sstPoints} />}
          {hasMaterialEnvData && <MaterialEnvironmentalChart data={materialEnvPoints} />}
        </AnalyticsGroup>
      )}

      {hasFleet && (
        <AnalyticsGroup id="analitica-flota" title="Flota y combustible" period="Últimos 6 meses">
          {hasFuelData && <FuelConsumptionChart data={fuelTrend} />}
          {hasMaintenanceData && <MaintenanceTrendChart data={maintenanceTrend} />}
        </AnalyticsGroup>
      )}
    </section>
  )
}
