import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  ArrowRight,
  DownloadSimple,
  GasPump,
  Package,
  ShieldWarning,
  ShoppingCart,
  Warning,
} from "@phosphor-icons/react/dist/ssr"
import { can, requirePermission } from "@/lib/auth/can"
import { normalizeAnalyticsFilters } from "@/lib/services/analytics"
import { getCachedAnalyticsDashboard } from "@/lib/services/read-model-cache"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AnalyticsFiltersBar } from "./analytics-filters"
import { ModuleSpendChart, MonthlySpendChart, RankingBarChart } from "./analytics-charts-lazy"
import { KpiCard } from "./analytics-kpi-card"
import { RankingTable, SeverityBadge, EmptyText } from "./analytics-ranking-table"
import { getFilterOptions, getParam } from "./analytics-page.helpers"

export const metadata: Metadata = { title: "Analítica" }

export default async function AnaliticaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("analytics:view") }
  catch { redirect("/forbidden") }
  const canViewFuel = can(session, "combustibles:view")
  const canViewFuelCosts = canViewFuel && can(session, "combustibles:view_costs")
  const canViewMaintenanceCosts = canViewFuelCosts && can(session, "mantenciones:view")
  const canViewPurchasing = can(session, "purchasing:view")
  const canViewWarehouse = can(session, "warehouse:view_stock")
  const canViewDeliveries = can(session, "deliveries:view")
  const canViewReports = can(session, "reports:view")

  const sp = await searchParams
  const filters = normalizeAnalyticsFilters({
    fromDate: getParam(sp, "from"),
    toDate: getParam(sp, "to"),
    worksiteId: getParam(sp, "faena"),
    supplierId: getParam(sp, "proveedor"),
    vehicleId: getParam(sp, "vehiculo"),
  })

  const [data, options] = await Promise.all([
    // ANA-002/PER-T02: la pantalla lee por la entrada cacheada (30 s); el
    // servicio directo queda para la exportación, que necesita evidencia fresca.
    getCachedAnalyticsDashboard(session, filters),
    getFilterOptions(session),
  ])

  const exportParams = new URLSearchParams({ tipo: "analitica_resumen" })
  exportParams.set("from", data.filters.fromDate)
  exportParams.set("to", data.filters.toDate)
  if (data.filters.worksiteId) exportParams.set("faena", data.filters.worksiteId)
  if (data.filters.supplierId) exportParams.set("proveedor", data.filters.supplierId)
  if (data.filters.vehicleId) exportParams.set("vehiculo", data.filters.vehicleId)

  return (
    <PageContainer>
      <PageHeader
        title="Analítica"
        description="Indicadores transversales de compras, bodega, EPP y combustible."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            ...(canViewReports ? [{ label: "Reportes", href: "/reportes" }] : []),
            { label: "Analítica" },
          ]} />
        }
        actions={
          <Link
            href={`/api/reportes/export?${exportParams.toString()}`}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius)] bg-[var(--color-primary)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-primary-strong)]"
          >
            <DownloadSimple size={14} />
            Exportar Excel
          </Link>
        }
      />

      <div className="grid gap-5">
        <AnalyticsFiltersBar
          filters={data.filters}
          worksites={options.worksites}
          suppliers={options.suppliers}
          vehicles={options.vehicles}
        />

        {/* 4 columnas y no 5: la sección tiene cuatro tarjetas y `xl:grid-cols-5`
            dejaba una columna vacía a la derecha en pantallas grandes. */}
        <section aria-label="KPIs ejecutivos" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={<ShoppingCart size={18} />}
            label="Gasto total"
            value={formatCLP(data.kpis.totalSpend)}
            detail={`Período ${data.filters.fromDate} a ${data.filters.toDate}`}
            trend={data.kpis.spendVariationPct}
            href={canViewPurchasing ? "/compras" : undefined}
            glossary={canViewFuelCosts
              ? "Suma de órdenes de compra emitidas y cargas de combustible del período seleccionado. La variación compara el período anterior de igual duración."
              : "Suma de las órdenes de compra emitidas del período seleccionado. El costo de combustible requiere permisos adicionales."}
          />
          <KpiCard
            icon={<Package size={18} />}
            label="Órdenes de compra"
            value={formatQty(data.kpis.purchaseOrderCount)}
            detail={`Promedio ${formatCLP(data.kpis.averageOrderAmount)}`}
            href={canViewPurchasing ? "/compras" : undefined}
            glossary="Cantidad de órdenes de compra emitidas en el período. El promedio se calcula dividiendo el gasto total de compras entre el número de OC."
          />
          {canViewFuelCosts && <KpiCard
            icon={<GasPump size={18} />}
            label="Combustible"
            value={formatCLP(data.vehicleCosts.reduce((sum, row) => sum + row.totalFuelAmount, 0))}
            detail={`${formatQty(data.kpis.fuelLiters, "L")} · ${data.kpis.fuelLoadCount} cargas`}
            href="/combustibles"
            glossary="Gasto total en combustible durante el período. Incluye todas las cargas registradas de todos los vehículos visibles para tu alcance."
          />}
          {canViewFuel && !canViewFuelCosts && <KpiCard
            icon={<GasPump size={18} />}
            label="Combustible"
            value={formatQty(data.kpis.fuelLiters, "L")}
            detail={`${data.kpis.fuelLoadCount} cargas · monto restringido`}
            href="/combustibles"
            glossary="Volumen de combustible registrado durante el período. Los montos requieren el permiso de costos."
          />}
          <KpiCard
            icon={<ShieldWarning size={18} />}
            label="Alertas"
            value={formatQty(data.alerts.length)}
            detail={`${data.kpis.criticalStockCount} productos bajo mínimo`}
            tone={data.alerts.some((alert) => alert.severity === "critical") ? "signal" : "neutral"}
            href="/dashboard"
            glossary="Alertas accionables detectadas por el sistema: documentos vencidos (flota), mantenciones vencidas, productos bajo stock mínimo, y órdenes pendientes sin avance."
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Tendencia mensual de gasto</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthlySpendChart data={data.spendByMonth} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Gasto por tipo</CardTitle>
            </CardHeader>
            <CardContent>
              <ModuleSpendChart data={data.spendByModule} />
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Faenas con mayor gasto</CardTitle>
            </CardHeader>
            <CardContent>
              <RankingBarChart data={data.topWorksites} labelKey="name" valueKey="totalAmount" emptyLabel="Sin gasto por faena para el filtro actual." />
            </CardContent>
          </Card>
          {canViewFuelCosts && <Card>
            <CardHeader>
              <CardTitle>{canViewMaintenanceCosts ? "Vehículos con mayor costo operacional" : "Vehículos con mayor gasto de combustible"}</CardTitle>
            </CardHeader>
            <CardContent>
              <RankingBarChart data={data.vehicleCosts} labelKey="plate" valueKey={canViewMaintenanceCosts ? "totalOperationalCost" : "totalFuelAmount"} emptyLabel="Sin cargas de combustible por vehículo en el período." />
            </CardContent>
          </Card>}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Alertas accionables</CardTitle>
            </CardHeader>
            <CardContent>
              {data.alerts.length > 0 ? (
                <div className="grid gap-3">
                  {data.alerts.slice(0, 8).map((alert) => (
                    <div key={`${alert.type}-${alert.entityLabel}-${alert.reason}`} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <SeverityBadge severity={alert.severity} />
                            <span className="text-xs font-medium text-[var(--color-text-subtle)]">{alert.module}</span>
                          </div>
                          <p className="mt-2 text-sm font-semibold text-[var(--color-text)]">{alert.entityLabel}</p>
                          <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{alert.reason}</p>
                        </div>
                        <Warning size={17} className="mt-1 shrink-0 text-[var(--color-signal-ink)]" />
                      </div>
                      <p className="mt-2 text-xs font-medium text-[var(--color-text)]">{alert.action}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyText text="No hay alertas para los filtros actuales." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Brechas de trazabilidad</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-3">
                {data.dataGaps.map((gap) => (
                  <li key={gap} className="flex gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm leading-5 text-[var(--color-text-muted)]">
                    <ArrowRight size={15} className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" />
                    <span>{gap}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <RankingTable
            title="Top proveedores"
            headers={["Proveedor", "Módulo", "Eventos", "Monto"]}
            rows={data.topSuppliers.map((row) => {
              const href = row.module === "Combustible"
                ? canViewFuel ? `/combustibles?proveedor=${row.id}` : null
                : canViewPurchasing ? `/compras?proveedor=${row.id}` : null
              return [
              href ? <Link key={row.id} href={href} className="font-medium text-[var(--color-primary)] hover:underline">{row.name}</Link> : row.name,
              row.module ?? "Compras",
              formatQty(row.count),
              formatCLP(row.totalAmount),
            ]})}
            empty="Sin proveedores con gasto para el período."
          />
          <RankingTable
            title="Stock crítico"
            headers={["Producto", "Faena", "Stock", "Mínimo"]}
            rows={data.stockRisks.map((row) => [
              row.productName,
              canViewWarehouse
                ? <Link key={`${row.productId}-${row.worksiteName}`} href={`/bodega?producto=${row.productId}`} className="text-[var(--color-primary)] hover:underline">{row.worksiteName}</Link>
                : row.worksiteName,
              formatQty(row.currentQty),
              formatQty(row.minStock),
            ])}
            empty="No hay productos bajo stock mínimo."
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <RankingTable
            title="Rotación de bodega"
            headers={["Producto", "SKU", "Salidas", "Movimientos"]}
            rows={data.productRotation.map((row) => [
              row.productName,
              row.sku,
              formatQty(row.totalOut),
              formatQty(row.movementCount),
            ])}
            empty="Sin egresos de bodega para el período."
          />
          <RankingTable
            title="EPP entregados"
            headers={["EPP", "Trabajador", "Faena", "Cantidad"]}
            rows={data.eppDeliveries.map((row) => [
              row.productName,
              row.workerName,
              canViewDeliveries
                ? <Link key={`${row.productId}-${row.workerName}`} href="/entregas" className="text-[var(--color-primary)] hover:underline">{row.worksiteName}</Link>
                : row.worksiteName,
              formatQty(row.totalQty),
            ])}
            empty="Sin entregas de EPP para el período."
          />
        </section>

        <RankingTable
          title="Órdenes recientes consideradas"
          headers={["OC", "Faena", "Proveedor", "Fecha", "Monto"]}
          rows={data.recentOrders.map((row) => [
            canViewPurchasing
              ? <Link key={row.id} href={`/compras/${row.id}`} className="font-medium text-[var(--color-primary)] hover:underline">{row.code}</Link>
              : row.code,
            row.worksiteName,
            row.supplierName,
            formatDate(row.createdAt),
            formatCLP(row.totalAmount),
          ])}
          empty="Sin órdenes de compra para el filtro actual."
        />
      </div>
    </PageContainer>
  )
}
