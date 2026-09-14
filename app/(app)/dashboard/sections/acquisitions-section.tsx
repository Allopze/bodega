import { Broom, ClipboardText, Package, Truck } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { getCachedAnalyticsDashboard } from "@/lib/services/read-model-cache"
import { getDashboardData } from "@/lib/services/dashboard"
import { getOperationalCalendarBounds } from "@/lib/services/operational-period-metrics"
import { getReceptionQuality } from "@/lib/services/dashboard-domains-data"
import { getOperationalTrendHistory } from "@/lib/services/operational-trend-history"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DomainSection } from "../dashboard-domain-shell"
import { periodScopeLabel, scopedWorksiteId } from "../dashboard-scope"
import { ModuleWorkloadChart, OperationalTrendChart } from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"
import { analyticsFilters } from "./shared"

// ── Adquisiciones ────────────────────────────────────────────────────────────

/**
 * Adquisiciones: el **proceso** de comprar, no su monto.
 *
 * El gasto, el ticket medio, los proveedores por gasto, el gasto por módulo, la
 * inversión por faena y la salud DTE se fueron a Finanzas, donde conviven con la
 * facturación de venta. Quedaron acá las cifras que describen cómo avanza el
 * flujo: cuántas OC se emiten, cuántas siguen abiertas, qué tan limpio llega lo
 * que se recibe y qué espera una decisión.
 *
 * A5 sigue rigiendo: una cifra, una representación. El tope de tiles se relajó
 * para el tablero; la prohibición de duplicar cifras no.
 */
export async function AcquisitionsSection({ session, scope, moduleWorkload, queueTotal }: DomainSectionsProps) {
  const bounds = getOperationalCalendarBounds(new Date(), scope.period)
  /*
   * `getDashboardData` se consulta acá y no en la página.
   *
   * Entrega `pendingApprovals` —ítems esperando decisión **ahora**, la misma
   * cifra que la alerta del Resumen; `analytics.kpis.pendingApprovals` filtra
   * por la ventana del período y la pantalla llegó a mostrar 3, 1 y 0 para
   * "aprobaciones" a la vez (I-02)— y `orders_pending_receipt`. Con las vistas
   * conmutadas, dejarla en la página la cobraba a los ocho renders.
   */
  const [analytics, quality, trend, dashboardData] = await Promise.all([
    getCachedAnalyticsDashboard(session, analyticsFilters(scope)),
    getReceptionQuality(session, { from: bounds.currentStart, to: bounds.currentEnd }, scopedWorksiteId(scope)),
    getOperationalTrendHistory(session, 6, new Date(), scopedWorksiteId(scope)),
    getDashboardData(session, scopedWorksiteId(scope)),
  ])
  const pendingApprovals = dashboardData.metrics.pending_approvals

  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.adquisiciones}
      links={[{ label: "Compras", href: "/compras" }, { label: "Analítica", href: "/analitica" }, { label: "Finanzas", href: "/dashboard?vista=finanzas" }]}
      kpis={
        <>
          <KpiCard icon={<ClipboardText size={16} />} label="OC emitidas" value={String(analytics.kpis.purchaseOrderCount)}
            detail={`Órdenes creadas · ${periodo}`} href="/compras" />
          <KpiCard icon={<Truck size={16} />} label="Por recibir" value={String(dashboardData.metrics.orders_pending_receipt)}
            detail="Órdenes con recepción pendiente · ahora"
            tone={dashboardData.metrics.orders_pending_receipt > 0 ? "signal" : "neutral"} href="/recepcion" />
          <KpiCard icon={<Broom size={16} />} label="Rechazo en recepción" value={`${quality.rejectionRate}%`}
            detail={quality.rejected + quality.damaged > 0 ? `${quality.rejected} rechazadas · ${quality.damaged} dañadas · ${periodo}` : `Todo llegó conforme · ${periodo}`}
            tone={quality.rejectionRate > 5 ? "signal" : "neutral"} href="/recepcion" />
          <KpiCard icon={<Package size={16} />} label="Por aprobar" value={String(pendingApprovals)}
            detail="Ítems esperando decisión ahora" href="/pendientes?module=aprobaciones" />
        </>
      }
      charts={
        <>
          <div className="xl:col-span-2">
            <OperationalTrendChart data={trend.map((p) => ({ month: p.month, requests: p.requests, orders: p.orders, receipts: p.receipts }))} />
          </div>
          {moduleWorkload.length > 0 && <ModuleWorkloadChart data={moduleWorkload} total={queueTotal} />}
        </>
      }
    />
  )
}
