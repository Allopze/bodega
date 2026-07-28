"use client"

import dynamic from "next/dynamic"
import type { DashboardTask } from "./dashboard-control-center"
import type { SstMonthlyPoint, MaterialEnvironmentalPoint, FuelMonthlyChartPoint, MaintenanceMonthlyChartPoint } from "./dashboard-charts"

// Recharts es ~168kb sin usar en el bundle inicial (auditoría UIUX-002): cada
// gráfico se difiere a su propio chunk y sólo se ejecuta tras la carga
// principal, en vez de competir por el hilo principal con el Centro de Control.
function chartSkeleton(heightClass: string) {
  return function ChartSkeleton() {
    return (
      <div className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs animate-pulse ${heightClass}`}>
        <div className="mb-3 h-3 w-40 rounded bg-slate-100" />
        <div className="h-[calc(100%-2rem)] w-full rounded bg-slate-50" />
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
  tasks: DashboardTask[]
  worksitesBreakdown: {
    id: string
    name: string
    requestsCount: number
    pendingCount: number
    approvedCount: number
    totalCost: number
  }[]
  fuelTrend: FuelMonthlyChartPoint[]
  maintenanceTrend: MaintenanceMonthlyChartPoint[]
  sstPoints: SstMonthlyPoint[]
  materialEnvPoints: MaterialEnvironmentalPoint[]
}

export function DashboardAnalyticsSection({
  trendData,
  tasks,
  worksitesBreakdown,
  fuelTrend,
  maintenanceTrend,
  sstPoints,
  materialEnvPoints,
}: DashboardAnalyticsSectionProps) {
  const hasTrendData = trendData.some((d) => d.requests > 0 || d.orders > 0 || d.receipts > 0)
  const hasSstData = sstPoints.length > 0
  const hasMaterialEnvData = materialEnvPoints.length > 0
  const hasFuelData = fuelTrend.some((d) => d.liters > 0 || d.loads > 0)
  const hasMaintenanceData = maintenanceTrend.some((d) => d.completed > 0 || d.scheduled > 0)
  const hasWorkloadData = tasks.length > 0
  const hasWorksiteData = worksitesBreakdown.length > 0
  const hasAnyChart = hasTrendData || hasWorkloadData || hasWorksiteData || hasSstData || hasMaterialEnvData || hasFuelData || hasMaintenanceData

  if (!hasAnyChart) return null

  return (
    <section className="mb-6" aria-labelledby="analitica-dashboard">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="analitica-dashboard" className="text-sm font-bold text-slate-900">Analítica y Tendencias</h2>
        <span className="text-[11px] font-medium text-(--color-text-muted)">Datos del año en curso</span>
      </div>
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
        {hasTrendData && <OperationalTrendChart data={trendData} />}
        {hasWorkloadData && <ModuleWorkloadChart tasks={tasks} />}
        {hasWorksiteData && <WorksiteActivityChart worksites={worksitesBreakdown} />}
        {hasFuelData && <FuelConsumptionChart data={fuelTrend} />}
        {hasMaintenanceData && <MaintenanceTrendChart data={maintenanceTrend} />}
        {hasSstData && <SstTrendChart data={sstPoints} />}
        {hasSstData && <SstAccidentChart data={sstPoints} />}
        {hasMaterialEnvData && <MaterialEnvironmentalChart data={materialEnvPoints} />}
      </div>
    </section>
  )
}
