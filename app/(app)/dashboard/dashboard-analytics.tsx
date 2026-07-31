import type { Session } from "next-auth"
import type { WorksiteScope } from "@/lib/auth/scope"
import { getOperationalTrendHistory } from "@/lib/services/operational-trend-history"
import { getFuelMonthlyTrend, getMaintenanceMonthlyTrend } from "@/lib/services/dashboard-fleet-maintenance"
import { getCanonicalSafetyIndicatorYear, getMaterialEnvironmentalEvents } from "@/lib/services/prevention-indicadores"
import { DashboardAnalyticsSection } from "./dashboard-analytics-section"
import type { ModuleWorkloadPoint } from "./dashboard-charts"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

/** Forma mínima que `toSstMonthlyPoints` necesita de `CanonicalIndicatorResult`. */
interface CanonicalMonthlySlice {
  confirmed: { accidents: number; frequencyRate: number | null; severityRate: number | null }
  provisional: { accidents: number }
}

/**
 * Serie mensual de indicadores SST para los gráficos.
 *
 * `provisional` es confirmados **más** pendientes
 * (`safety-indicators-calc.ts:217-219`), así que la resta da los incidentes que
 * sólo tienen casos por calificar. Es una función exportada y no un `.map()`
 * inline porque es la única lógica de derivación de la sección y necesitaba un
 * test: antes esta misma línea alimentaba una serie rotulada "Accidentes STP"
 * con el superconjunto provisional.
 *
 * El `Math.max(0, …)` sostiene el invariante provisional ⊇ confirmed, que
 * garantiza el motor de cálculo y no el tipo.
 */
export function toSstMonthlyPoints(monthly: CanonicalMonthlySlice[]) {
  return monthly.map((m, index) => ({
    month: MONTH_LABELS[index] ?? `M${index + 1}`,
    tasaFrecuencia: m.confirmed.frequencyRate ?? 0,
    tasaGravedad: m.confirmed.severityRate ?? 0,
    confirmados: m.confirmed.accidents ?? 0,
    porCalificar: Math.max(0, (m.provisional.accidents ?? 0) - (m.confirmed.accidents ?? 0)),
  }))
}

interface DashboardAnalyticsProps {
  session: Session
  /** Alcance de permisos ya intersectado con la faena elegida. */
  worksiteScope: WorksiteScope
  /** La faena elegida, para los servicios que filtran por columna y no por scope. */
  scopedWorksiteId?: string
  currentYear: number
  canViewIndicators: boolean
  moduleWorkload: ModuleWorkloadPoint[]
  queueTotal: number
  worksitesBreakdown: { name: string; totalCost: number }[]
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
  scopedWorksiteId,
  currentYear,
  canViewIndicators,
  moduleWorkload,
  queueTotal,
  worksitesBreakdown,
}: DashboardAnalyticsProps) {
  const [trendHistory, fuelTrend, maintenanceTrend, sstYearView, envEventsData] = await Promise.all([
    getOperationalTrendHistory(session, 6, new Date(), scopedWorksiteId),
    getFuelMonthlyTrend(session, 6, scopedWorksiteId),
    getMaintenanceMonthlyTrend(session, 6, scopedWorksiteId),
    // Estas dos ya reciben el alcance intersectado, así que la faena elegida
    // viaja dentro de `worksiteScope` y no necesitan el id aparte.
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

  const totalGroup = sstYearView?.groups.find((g) => g.worksiteId === "total")
  const sstPoints = totalGroup ? toSstMonthlyPoints(totalGroup.monthly) : []

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
