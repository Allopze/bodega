import { Gauge, Package, Truck, WarningOctagon } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { getCachedAnalyticsDashboard } from "@/lib/services/read-model-cache"
import { getStockAlerts } from "@/lib/services/stock-alerts"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DomainSection } from "../dashboard-domain-shell"
import { periodScopeLabel, scopedWorksiteId } from "../dashboard-scope"
import { ThresholdRankingChart } from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"
import { analyticsFilters } from "./shared"

// ── Bodega y entregas ────────────────────────────────────────────────────────

export async function WarehouseSection({ session, scope, worksiteIds }: DomainSectionsProps) {
  const selectedWorksiteId = scopedWorksiteId(scope)
  const alertScope = selectedWorksiteId ? [selectedWorksiteId] : worksiteIds
  const [analytics, alerts] = await Promise.all([
    getCachedAnalyticsDashboard(session, analyticsFilters(scope)),
    getStockAlerts(alertScope),
  ])

  const scoped = alerts
  const critical = scoped.filter((alert) => alert.severity === "critical")
  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.bodega}
      links={[{ label: "Bodega", href: "/bodega" }, { label: "Entregas", href: "/entregas" }]}
      kpis={
        <>
          <KpiCard icon={<WarningOctagon size={16} />} label="Stock crítico" value={String(critical.length)}
            detail={critical.length > 0 ? "Bajo su mínimo, ahora" : "Todo sobre el mínimo, ahora"}
            tone={critical.length > 0 ? "signal" : "neutral"} href="/bodega" />
          <KpiCard icon={<Package size={16} />} label="Stock en alerta" value={String(scoped.length - critical.length)}
            detail="Cerca del mínimo, ahora" href="/bodega" />
          <KpiCard icon={<Truck size={16} />} label="Entregas de EPP" value={String(analytics.eppDeliveries.length)}
            detail={`Trabajadores con entrega · ${periodo}`} href="/entregas" />
          <KpiCard icon={<Gauge size={16} />} label="Productos en rotación" value={String(analytics.productRotation.length)}
            detail={`Con movimiento · ${periodo}`} href="/analitica" />
        </>
      }
      charts={
        <>
          <ThresholdRankingChart
            title="Mayor déficit de stock" description="Cuánto falta para alcanzar el mínimo definido" unit=" u."
            invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
            data={scoped.slice(0, 8).map((alert) => ({
              name: alert.productName,
              value: Math.max(0, Math.round(alert.minStock - alert.currentQty)),
              detail: `${alert.currentQty} de ${alert.minStock} · ${alert.worksiteName}`,
            }))}
          />
          <ThresholdRankingChart
            title="EPP entregado por trabajador" description="Unidades entregadas en el período" unit=" u."
            invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
            data={analytics.eppDeliveries.slice(0, 8).map((row) => ({
              name: row.workerName, value: row.totalQty, detail: `${row.deliveryCount} entregas · ${row.worksiteName}`,
            }))}
          />
        </>
      }
    />
  )
}
