import { Broom, ClipboardText, Package, Truck } from "@phosphor-icons/react/dist/ssr"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { KpiCard } from "@/components/ui/kpi-card"
import { RankedList } from "@/components/ui/ranked-list"
import { getDashboardData } from "@/lib/services/dashboard"
import { getOperationalCalendarBounds, getOperationalPeriodMetrics } from "@/lib/services/operational-period-metrics"
import { getReceptionQuality } from "@/lib/services/dashboard-domains-data"
import { getOperationalTrendHistory } from "@/lib/services/operational-trend-history"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DASHBOARD_KPI, DomainSection } from "../dashboard-domain-shell"
import { periodComparisonShortLabel, periodScopeLabel, scopedWorksiteId } from "../dashboard-scope"
import { OperationalTrendChart } from "../dashboard-domain-charts"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "../charts/chart-frame"

import type { DomainSectionsProps } from "./shared"
import { moduleWorkloadHref } from "./shared"
import { ORDERS_ISSUED_METRIC } from "../dashboard-metric-definitions"

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
  const [periodMetrics, quality, trend, dashboardData] = await Promise.all([
    // INI-01 (auditoría 2026-10-05): "OC emitidas" sale de la misma función que
    // el Resumen y Finanzas. Antes salía de analítica, que cuenta por fecha de
    // creación y rotulaba "OC emitidas" lo que su detalle llamaba "Órdenes
    // creadas"; de paso se evita el read model completo de analítica, que acá
    // sólo aportaba ese número.
    getOperationalPeriodMetrics(session, { period: scope.period, ...(scopedWorksiteId(scope) ? { worksiteId: scopedWorksiteId(scope)! } : {}) }),
    getReceptionQuality(session, { from: bounds.currentStart, to: bounds.currentEnd }, scopedWorksiteId(scope)),
    getOperationalTrendHistory(session, 6, new Date(), scopedWorksiteId(scope)),
    getDashboardData(session, scopedWorksiteId(scope)),
  ])
  const pendingApprovals = dashboardData.metrics.pending_approvals

  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")
  // La variación sólo existe con período anterior: sin él no hay contra qué
  // comparar y se omite en vez de inventar un 0.
  const previousOrders = periodMetrics.ordersIssued.previous
  const ordersTrend = previousOrders === null ? undefined : periodMetrics.ordersIssued.current - previousOrders

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.adquisiciones}
      links={[{ label: "Compras", href: "/compras" }, { label: "Analítica", href: "/analitica" }, { label: "Finanzas", href: "/dashboard?vista=finanzas" }]}
      kpis={
        <>
          <KpiCard {...DASHBOARD_KPI} icon={<ClipboardText size={16} />} label={ORDERS_ISSUED_METRIC.label} value={String(periodMetrics.ordersIssued.current)}
            // Emitir más o menos OC no es bueno ni malo por sí solo: el delta va en gris.
            trend={ordersTrend} trendFormat="number" trendPolarity="neutral" trendLabel={periodComparisonShortLabel(scope.period)}
            detail={`Salieron de borrador · ${periodo}`} glossary={ORDERS_ISSUED_METRIC.glossary} href="/compras" />
          <KpiCard {...DASHBOARD_KPI} icon={<Truck size={16} />} label="Pendiente de recepción" value={String(dashboardData.metrics.orders_pending_receipt)}
            detail="Órdenes enviadas que aún no llegan · ahora"
            tone={dashboardData.metrics.orders_pending_receipt > 0 ? "signal" : "neutral"} href="/recepcion" />
          <KpiCard {...DASHBOARD_KPI} icon={<Broom size={16} />} label="Rechazo en recepción" value={`${quality.rejectionRate}%`}
            detail={quality.rejected + quality.damaged > 0 ? `${quality.rejected} rechazadas · ${quality.damaged} dañadas · ${periodo}` : `Todo llegó conforme · ${periodo}`}
            tone={quality.rejectionRate > 5 ? "signal" : "neutral"} href="/recepcion" />
          <KpiCard {...DASHBOARD_KPI} icon={<Package size={16} />} label="Por aprobar" value={String(pendingApprovals)}
            detail="Ítems esperando decisión ahora" href="/pendientes?module=aprobaciones" />
        </>
      }
      charts={
        <>
          <ChartSlot span="wide">
            <OperationalTrendChart data={trend.map((p) => ({ month: p.month, requests: p.requests, orders: p.orders, receipts: p.receipts }))} />
          </ChartSlot>
          {moduleWorkload.length > 0 && (
            // 2 + 1 en 2xl; en xl (2 columnas) la lista toma la fila para no dejar un hueco al lado.
            <ChartSlot className="xl:col-span-2 2xl:col-span-1">
              {/* Lista y no barras: el color de cada barra no codificaba nada, y
                  cada módulo ahora lleva a su cola ya filtrada. */}
              <ChartFrame
                title="Distribución por módulo"
                description="Pendiente al día de hoy"
                headline={<><ChartHeadlineValue>{queueTotal}</ChartHeadlineValue><ChartHeadlineCaption>{queueTotal === 1 ? "tarea pendiente" : "tareas pendientes"}</ChartHeadlineCaption></>}
              >
                <RankedList
                  items={moduleWorkload.map((point) => ({ key: point.module, label: point.module, value: point.count, href: moduleWorkloadHref(point) }))}
                  format="count" mode="share" moreHref="/pendientes"
                  ariaLabel="Tareas pendientes por módulo"
                />
              </ChartFrame>
            </ChartSlot>
          )}
        </>
      }
    />
  )
}
