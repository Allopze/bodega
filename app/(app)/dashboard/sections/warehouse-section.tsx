import { Gauge, Truck } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { getCachedAnalyticsDashboard } from "@/lib/services/read-model-cache"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DomainSection } from "../dashboard-domain-shell"
import { periodScopeLabel } from "../dashboard-scope"
import { ThresholdRankingChart } from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"
import { analyticsFilters } from "./shared"

// ── Bodega y entregas ────────────────────────────────────────────────────────

export async function WarehouseSection({ session, scope }: DomainSectionsProps) {
  const analytics = await getCachedAnalyticsDashboard(session, analyticsFilters(scope))
  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.bodega}
      links={[{ label: "Bodega", href: "/bodega" }, { label: "Entregas", href: "/entregas" }]}
      kpis={
        <>
          <KpiCard icon={<Truck size={16} />} label="Entregas de EPP" value={String(analytics.eppDeliveries.length)}
            detail={`Trabajadores con entrega · ${periodo}`} href="/entregas" />
          <KpiCard icon={<Gauge size={16} />} label="Productos en rotación" value={String(analytics.productRotation.length)}
            detail={`Con movimiento · ${periodo}`} href="/analitica" />
        </>
      }
      charts={
        <ThresholdRankingChart
          title="EPP entregado por trabajador" description="Unidades entregadas en el período" unit=" u."
          invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
          data={analytics.eppDeliveries.slice(0, 8).map((row) => ({
            name: row.workerName, value: row.totalQty, detail: `${row.deliveryCount} entregas · ${row.worksiteName}`,
          }))}
        />
      }
    />
  )
}
