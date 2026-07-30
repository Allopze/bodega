import type { Session } from "next-auth"
import type { WorksiteScope } from "@/lib/auth/scope"
import { getOperationalTrendHistory } from "@/lib/services/operational-trend-history"
import { getFuelMonthlyTrend, getMaintenanceMonthlyTrend } from "@/lib/services/dashboard-fleet-maintenance"
import { getCanonicalSafetyIndicatorYear, getMaterialEnvironmentalEvents } from "@/lib/services/prevention-indicadores"
import { DashboardAnalyticsSection } from "./dashboard-analytics-section"
import type { ModuleWorkloadPoint } from "./dashboard-charts"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

interface DashboardAnalyticsProps {
  session: Session
  worksiteScope: WorksiteScope
  currentYear: number
  canViewIndicators: boolean
  moduleWorkload: ModuleWorkloadPoint[]
  queueTotal: number
  worksitesBreakdown: {
    id: string
    name: string
    requestsCount: number
    pendingCount: number
    approvedCount: number
    totalCost: number
  }[]
}

/**
 * Carga de datos de la sección analítica, aislada tras un `Suspense`.
 *
 * Estas cinco consultas sólo alimentan gráficos que están bajo el pliegue y con
 * hidratación diferida (`next/dynamic`, `ssr: false`). Mientras vivían en el
 * lote principal, el Centro de Control —lo primero que el usuario mira— no se
 * pintaba hasta que todas resolvían (P-02).
 */
export async function DashboardAnalytics({
  session,
  worksiteScope,
  currentYear,
  canViewIndicators,
  moduleWorkload,
  queueTotal,
  worksitesBreakdown,
}: DashboardAnalyticsProps) {
  const [trendHistory, fuelTrend, maintenanceTrend, sstYearView, envEventsData] = await Promise.all([
    getOperationalTrendHistory(session, 6),
    getFuelMonthlyTrend(session, 6),
    getMaintenanceMonthlyTrend(session, 6),
    canViewIndicators
      ? getCanonicalSafetyIndicatorYear(currentYear, worksiteScope).catch(() => null)
      : Promise.resolve(null),
    canViewIndicators
      ? getMaterialEnvironmentalEvents(currentYear, worksiteScope).catch(() => null)
      : Promise.resolve(null),
  ])

  const trendData = trendHistory.map((point) => ({
    month: point.month,
    requests: point.requests,
    orders: point.orders,
    receipts: point.receipts,
  }))

  const sstPoints = sstYearView?.groups.find((g) => g.worksiteId === "total")?.monthly.map((m, i) => ({
    month: MONTH_LABELS[i] ?? `M${i + 1}`,
    tasaFrecuencia: m.confirmed.frequencyRate ?? 0,
    tasaGravedad: m.confirmed.severityRate ?? 0,
    accConTiempoPerdido: m.confirmed.accidents ?? 0,
    accSinTiempoPerdido: m.provisional.accidents ?? 0,
  })) ?? []

  const materialEnvPoints = envEventsData?.eventData.find((e) => e.worksiteId === "total")?.monthly.map((m) => ({
    month: MONTH_LABELS[m.month - 1] ?? `M${m.month}`,
    dangerousIncidents: m.dangerousIncidents,
    materialDamage: m.materialDamage,
    environmentalSpills: m.environmentalSpills,
  })) ?? []

  return (
    <DashboardAnalyticsSection
      trendData={trendData}
      moduleWorkload={moduleWorkload}
      queueTotal={queueTotal}
      worksitesBreakdown={worksitesBreakdown}
      fuelTrend={fuelTrend}
      maintenanceTrend={maintenanceTrend}
      sstPoints={sstPoints}
      materialEnvPoints={materialEnvPoints}
    />
  )
}

/** Reserva el alto de la sección para que el Centro de Control no salte. */
export function DashboardAnalyticsFallback() {
  return (
    <div className="mb-6 grid gap-6 grid-cols-1 xl:grid-cols-2" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="h-64 animate-pulse rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <div className="mb-3 h-3 w-40 rounded bg-[var(--color-surface-2)]" />
          <div className="h-[calc(100%-2rem)] w-full rounded bg-[var(--color-surface-2)]" />
        </div>
      ))}
    </div>
  )
}
