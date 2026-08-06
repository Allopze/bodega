import { CurrencyDollar, Gauge, ShoppingCart, Timer, Warning } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { MoneyStat } from "@/app/(app)/facturacion/money-stat"
import { formatCLP } from "@/lib/utils"
import { getBillingSummary } from "@/lib/services/billing/queries"
import { getAnalyticsDashboard } from "@/lib/services/analytics-module/dashboard"
import { getDashboardData } from "@/lib/services/dashboard"
import { getFuelMonthlyTrend } from "@/lib/services/dashboard-fleet-maintenance"
import { getOverdueFuelDebt } from "@/lib/services/dashboard-domains-data"
import { computeHealthStats } from "@/lib/services/dte-portal/reconciliation"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { getOperationalCalendarBounds } from "@/lib/services/operational-period-metrics"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DomainSection, type DomainKpiGroup } from "../dashboard-domain-shell"
import { periodScopeLabel, scopedWorksiteId } from "../dashboard-scope"
import {
  BillingFlowChart, CompositionDonutChart, ThresholdRankingChart, WorksiteActivityChart,
} from "../dashboard-domain-charts"
import type { DomainSectionsProps } from "../dashboard-domain-sections"

/**
 * Finanzas: **toda la plata**, en las dos direcciones.
 *
 * Los ingresos (venta) salían sólo en `/facturacion`, que no tenía ninguna
 * presencia en el tablero. Los egresos (gasto en OC, proveedores, combustible,
 * deuda) vivían repartidos entre Adquisiciones y Flota, donde competían con las
 * cifras de proceso de esos dominios. Acá conviven y se comparan.
 *
 * Ocho tiles en dos filas rotuladas: es la excepción declarada a §A1 de
 * AGENTS.md, que sigue rigiendo para el resto de las pantallas. Lo que **no** se
 * relaja es A5 — por eso el gasto en OC se fue de Adquisiciones al nacer esta
 * sección, en vez de quedar en las dos.
 */
export async function FinanceSection({ session, scope }: DomainSectionsProps) {
  const permissions = session.user.permissions
  const has = (permission: string) => permissions.includes(permission)
  const worksiteId = scopedWorksiteId(scope)
  const bounds = getOperationalCalendarBounds(new Date(), scope.period)

  // `getBillingSummary` acepta período tributario `YYYY-MM` y faena, así que el
  // alcance global del tablero lo reencuadra sin código de datos nuevo. Con
  // trimestre o año elegidos toma el mes de inicio de la ventana: el libro de
  // ventas es mensual por norma, y el `note` de abajo lo declara.
  const billingPeriod = bounds.currentStart.slice(0, 7)
  const canSeeFuelCosts = has("combustibles:view_costs")
  const canSeePurchasing = has("purchasing:view")

  const dteCodEmp = canSeePurchasing ? (await readDtePortalConfig()).credentials.codEmp : null

  const [billing, analytics, fuelTrend, debt, dteHealth, dashboardData] = await Promise.all([
    has("billing:view")
      ? getBillingSummary(session, { period: billingPeriod, ...(worksiteId ? { worksiteId } : {}) }).catch(() => null)
      : Promise.resolve(null),
    canSeePurchasing
      ? getAnalyticsDashboard(session, {
          fromDate: bounds.currentStart.slice(0, 10),
          toDate: bounds.currentEnd.slice(0, 10),
          ...(worksiteId ? { worksiteId } : {}),
        })
      : Promise.resolve(null),
    canSeeFuelCosts ? getFuelMonthlyTrend(session, 6, worksiteId) : Promise.resolve([]),
    canSeeFuelCosts ? getOverdueFuelDebt(bounds.currentEnd.slice(0, 10)) : Promise.resolve({ amount: 0, statements: 0 }),
    dteCodEmp ? computeHealthStats(billingPeriod, dteCodEmp).catch(() => null) : Promise.resolve(null),
    canSeePurchasing ? getDashboardData(session, worksiteId).catch(() => null) : Promise.resolve(null),
  ])

  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")
  const fuelCost = fuelTrend.reduce((sum, point) => sum + point.amount, 0)

  /*
   * Tres cifras de esta sección no pueden respetar el filtro de faena y hay que
   * decirlo: el libro de ventas es por período tributario, y tanto los DTE como
   * la cuenta corriente de combustible son por empresa o por proveedor.
   */
  const notes = [
    billing && scope.period !== "mes"
      ? "La facturación de venta usa el período tributario del mes en curso del alcance, no el trimestre ni el año completos."
      : null,
    dteHealth && worksiteId
      ? "Las cifras de DTE son por empresa y período tributario, no por faena: no siguen el filtro de arriba."
      : null,
    debt.statements > 0 && worksiteId
      ? "La deuda de cuenta corriente es por proveedor: no se puede repartir por faena."
      : null,
  ].filter(Boolean)

  const kpiGroups: DomainKpiGroup[] = []

  if (billing) {
    kpiGroups.push({
      key: "ingresos",
      label: "Ingresos — facturación de venta",
      content: (
        <>
          <MoneyStat label="Facturado en el período" amounts={billing.invoicedByCurrency}
            detail={`${billing.invoiceCount} ${billing.invoiceCount === 1 ? "documento emitido" : "documentos emitidos"} · ${periodo}`}
            origin="Documentos sincronizados desde FacturaEnLínea, sin contar anuladas."
            href={`/facturacion/facturas?periodo=${billingPeriod}`} />
          <MoneyStat label="Cobrado del período" amounts={billing.collectedByCurrency}
            detail="Sólo pagos con confirmación manual"
            origin="Suma de pagos confirmados imputados a facturas emitidas en el período. Una sugerencia de pago no suma acá."
            href={`/facturacion/facturas?periodo=${billingPeriod}&pago=paid`} />
          <MoneyStat label="Pendiente de cobro" amounts={billing.outstandingByCurrency}
            detail="Saldo de todas las facturas abiertas"
            origin="Total menos pagos confirmados, de todas las facturas no pagadas (no sólo del período)."
            href="/facturacion/facturas?pago=unpaid" />
          <MoneyStat label="Vencido" amounts={billing.overdueByCurrency}
            detail={`${billing.overdueCount} ${billing.overdueCount === 1 ? "factura vencida" : "facturas vencidas"} · hoy`}
            origin="Facturas con fecha de vencimiento anterior a hoy y saldo pendiente."
            tone={billing.overdueCount > 0 ? "danger" : "neutral"}
            href="/facturacion/facturas?vencidas=1" />
        </>
      ),
    })
  }

  if (analytics || canSeeFuelCosts) {
    kpiGroups.push({
      key: "egresos",
      label: "Egresos — compra y consumo",
      content: (
        <>
          {analytics && (
            <KpiCard icon={<ShoppingCart size={16} />} label="Gasto en OC" value={formatCLP(analytics.kpis.totalSpend)}
              detail={`${analytics.kpis.purchaseOrderCount} OC emitidas · ${periodo}`}
              trend={analytics.kpis.spendVariationPct} href="/compras" />
          )}
          {analytics && (
            <KpiCard icon={<Timer size={16} />} label="Ticket medio por OC" value={formatCLP(analytics.kpis.averageOrderAmount)}
              detail={`Monto promedio · ${periodo}`} href="/analitica" />
          )}
          {canSeeFuelCosts && (
            <KpiCard icon={<Gauge size={16} />} label="Costo de combustible" value={formatCLP(fuelCost)}
              detail="Cargas facturadas · últimos 6 meses" href="/combustibles" />
          )}
          {canSeeFuelCosts && (
            <KpiCard icon={<Warning size={16} />} label="Deuda vencida" value={formatCLP(debt.amount)}
              detail={debt.statements > 0 ? `${debt.statements} cuenta(s) · hoy` : "Sin cuentas vencidas, hoy"}
              tone={debt.amount > 0 ? "signal" : "neutral"} href="/combustibles/cuenta-corriente" />
          )}
        </>
      ),
    })
  }

  // Sin ninguna de las dos mitades el rol no debería ver la pestaña, pero el
  // permiso puede autorizar la sección y la consulta fallar: mejor un tile de
  // contexto que una sección con dos filas vacías.
  if (kpiGroups.length === 0) {
    kpiGroups.push({
      key: "sin-datos",
      label: null,
      content: (
        <KpiCard icon={<CurrencyDollar size={16} />} label="Facturación" value="Sin datos"
          detail="Sincroniza un período para ver los indicadores" href="/facturacion/sincronizacion" />
      ),
    })
  }

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.finanzas}
      note={notes.length > 0 ? notes.join(" ") : undefined}
      links={[
        { label: "Facturación", href: "/facturacion" },
        { label: "Compras", href: "/compras" },
        { label: "Analítica", href: "/analitica" },
      ]}
      kpiGroups={kpiGroups}
      charts={
        <>
          {billing && billing.monthly.length > 0 && (
            <div className="xl:col-span-2">
              <BillingFlowChart data={billing.monthly.map((row) => ({
                period: row.period, invoiced: row.invoiced, collected: row.collected,
              }))} />
            </div>
          )}
          {billing && billing.aging.some((bucket) => bucket.count > 0) && (
            <ThresholdRankingChart
              title="Antigüedad de la deuda" description="Saldo pendiente por días desde el vencimiento"
              unit="" format="clp" invert
              goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
              data={billing.aging.map((bucket) => ({
                name: bucket.label,
                // Una sola moneda en el eje: mezclarlas daría un total falso.
                value: bucket.byCurrency[0]?.amount ?? 0,
                detail: `${bucket.count} factura(s)${bucket.byCurrency.length > 1 ? ` · ${bucket.byCurrency[0]!.currency}` : ""}`,
              }))}
            />
          )}
          {analytics && (
            <CompositionDonutChart
              title="Gasto por módulo" description={`De qué se compone el gasto — ${periodo}`}
              totalLabel="del período" format="clp"
              data={analytics.spendByModule.map((row) => ({ key: row.module, label: row.module, value: row.totalAmount }))}
            />
          )}
          {analytics && analytics.topSuppliers.length > 0 && (
            <ThresholdRankingChart
              title="Proveedores por gasto" description="Concentración de compra en el período" unit="" format="clp"
              invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
              data={analytics.topSuppliers.slice(0, 8).map((row) => ({
                name: row.name, value: Math.round(row.totalAmount), detail: `${row.count} OC`,
              }))}
            />
          )}
          {billing && billing.topClients.length > 0 && (
            <ThresholdRankingChart
              title="Principales clientes" description="Facturación del período atribuida a un cliente" unit="" format="clp"
              invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
              data={billing.topClients.slice(0, 8).map((row) => ({
                name: row.clientName, value: Math.round(row.amount), detail: row.currency,
              }))}
            />
          )}
          {dashboardData && dashboardData.worksitesBreakdown.length > 0 && (
            <WorksiteActivityChart worksites={dashboardData.worksitesBreakdown} />
          )}
        </>
      }
    />
  )
}
