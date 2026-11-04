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
import { formatCLP, formatDate, formatPercent, formatQty } from "@/lib/utils"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartSection } from "@/components/charts/chart-section"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { RankedList } from "@/components/ui/ranked-list"
import { getSupplyLeadTime } from "@/lib/services/analytics-module/lead-time"
import { AnalyticsFiltersBar } from "./analytics-filters"
import { MonthlySpendChart, SupplierParetoChart } from "./analytics-charts-lazy"
import { KpiCard } from "./analytics-kpi-card"
import { RankingTable, SeverityBadge, EmptyText } from "./analytics-ranking-table"
import { getFilterOptions, getParam } from "./analytics-page.helpers"
import { monthlyTrendSummary, trendDataRows } from "./analytics-trend"
import { buildSupplierPareto, paretoSummary } from "./analytics-pareto"
import { rankingItems, rankingLeaderSummary } from "./analytics-rankings"
import { LeadTimeSection } from "./lead-time-section"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

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
  const canViewPurchasing = can(session, "purchasing:view")
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

  const [data, options, leadTime] = await Promise.all([
    // ANA-002/PER-T02: la pantalla lee por la entrada cacheada (30 s); el
    // servicio directo queda para la exportación, que necesita evidencia fresca.
    getCachedAnalyticsDashboard(session, filters),
    getFilterOptions(session),
    // CHART-029: plazos del ciclo. Un fallo suyo no tumba el resto de la pantalla; se dice en su tarjeta.
    getSupplyLeadTime(session, {
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      ...(filters.worksiteId ? { worksiteId: filters.worksiteId } : {}),
    }).catch(() => null),
  ])

  // Datos de los gráficos: la forma (qué se dibuja y qué dice la frase) vive en funciones puras con pruebas propias.
  const spendByTypeItems = rankingItems(data.spendByModule.map((row) => ({ key: row.module, label: row.module, value: row.totalAmount })))
  const worksiteItems = rankingItems(data.topWorksites.map((row) => ({ key: row.id, label: row.name, value: row.totalAmount })))
  const vehicleItems = rankingItems(data.vehicleCosts.map((row) => ({
    key: row.id,
    label: row.plate,
    value: row.totalFuelAmount,
    detail: `${formatQty(row.totalLiters, "L")} · ${formatQty(row.loadCount)} ${row.loadCount === 1 ? "carga" : "cargas"}`,
  })))
  const concentrationThreshold = data.supplierConcentrationPct ?? 60
  const pareto = buildSupplierPareto({ suppliers: data.topSuppliers, totalSpend: data.kpis.totalSpend })
  // La lista que explica la barra: las OC del proveedor en el MISMO período (el filtro de Compras fecha por emisión, como el gasto) o sus cargas.
  const supplierHref = (row: { key: string; module: string | null }) => {
    if (row.module === "Combustible") return canViewFuel ? `${FUEL_PATHS.consumoLitros}?seccion=tarjetas&proveedor=${row.key}` : undefined
    if (!canViewPurchasing) return undefined
    const params = new URLSearchParams({ desde: data.filters.fromDate, hasta: data.filters.toDate, proveedor: row.key })
    if (data.filters.worksiteId) params.set("faena", data.filters.worksiteId)
    return `/compras?${params.toString()}`
  }
  const paretoRows = pareto.rows.map((row) => ({ ...row, href: row.isOther ? undefined : supplierHref(row) }))
  const paretoEmpty = data.filters.supplierId
    ? {
        label: "El Pareto compara proveedores entre sí",
        hint: "Con el filtro de proveedor activo queda uno solo y el resto sería combustible. Quita el filtro de proveedor para ver cómo se reparte el gasto.",
      }
    : pareto.rows.length === 0
      ? {
          label: "Sin proveedores con gasto en el período",
          hint: "El Pareto aparece cuando hay órdenes de compra emitidas o compras de combustible en el período.",
          ...(canViewPurchasing ? { ctaLabel: "Ver compras", ctaHref: "/compras" } : {}),
        }
      : null

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

      {/* `grid-cols-1` (= `minmax(0, 1fr)`) aquí y en cada sección: con la
          pista `auto` los filtros ensanchaban la columna 141 px más allá del
          pozo a 320 px, y las tablas de las tarjetas —que desplazan dentro de
          su `TableRoot`— otros 104 px. */}
      <div className="grid grid-cols-1 gap-5">
        <AnalyticsFiltersBar
          filters={data.filters}
          worksites={options.worksites}
          suppliers={options.suppliers}
          vehicles={options.vehicles}
        />

        {/* 4 columnas y no 5: la sección tiene cuatro tarjetas y `xl:grid-cols-5`
            dejaba una columna vacía a la derecha en pantallas grandes. */}
        <section aria-label="KPIs ejecutivos" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={<ShoppingCart size={18} />}
            label="Gasto total"
            value={formatCLP(data.kpis.totalSpend)}
            detail={`Período ${data.filters.fromDate} a ${data.filters.toDate}`}
            trend={data.kpis.spendVariationPct}
            // Dinero gastado: subir es mala noticia. Sin esto `KpiCard` usa
            // `up-good` y pintaba de verde un alza del 133 % (Fase 0 · 0.2).
            trendPolarity="up-bad"
            href={canViewPurchasing ? "/compras" : undefined}
            glossary={canViewFuelCosts
              ? "Suma de las órdenes de compra emitidas en el período (fechadas por su día de emisión) y del gasto en combustible (transacciones Copec aceptadas), ambos con impuestos incluidos. La variación compara el período anterior de igual duración."
              : "Suma de las órdenes de compra emitidas en el período (fechadas por su día de emisión), con impuestos incluidos. El costo de combustible requiere permisos adicionales."}
          />
          <KpiCard
            icon={<Package size={18} />}
            label="Órdenes de compra"
            value={formatQty(data.kpis.purchaseOrderCount)}
            detail={`Promedio ${formatCLP(data.kpis.averageOrderAmount)}`}
            href={canViewPurchasing ? "/compras" : undefined}
            glossary="Cantidad de órdenes de compra emitidas en el período, sin borradores, anuladas ni eliminadas. El promedio divide el gasto en OC (con impuestos) entre ese número."
          />
          {canViewFuelCosts && <KpiCard
            icon={<GasPump size={18} />}
            label="Combustible"
            value={formatCLP(data.kpis.fuelAmount)}
            detail={`${formatQty(data.kpis.fuelLiters, "L")} · ${data.kpis.fuelLoadCount} cargas`}
            href={FUEL_PATHS.consumoLitros}
            glossary="Gasto en combustible durante el período, con impuestos incluidos (IVA e IEC). Suma las transacciones de Copec aceptadas y vigentes de todos los vehículos y estanques visibles para tu alcance, sin duplicar el agregado mensual del informe TCT."
          />}
          {canViewFuel && !canViewFuelCosts && <KpiCard
            icon={<GasPump size={18} />}
            label="Combustible"
            value={formatQty(data.kpis.fuelLiters, "L")}
            detail={`${data.kpis.fuelLoadCount} cargas · monto restringido`}
            href={FUEL_PATHS.consumoLitros}
            glossary="Volumen de combustible registrado durante el período. Los montos requieren el permiso de costos."
          />}
          <KpiCard
            icon={<ShieldWarning size={18} />}
            label="Alertas"
            value={formatQty(data.alerts.length)}
            detail="Detectadas en el período"
            // Una alerta crítica es un problema, no un pendiente: el naranja
            // signal está reservado a pendientes (DESIGN.md).
            tone={data.alerts.some((alert) => alert.severity === "critical") ? "danger" : "neutral"}
            // La lista de alertas está en esta misma pantalla («Alertas accionables»);
            // /dashboard no las muestra, así que el tile saltaba a un lugar sin ellas.
            href="#alertas"
            glossary="Alertas accionables detectadas por el sistema: gasto anómalo por vehículo, concentración de gasto en un proveedor y entregas recurrentes de EPP a un mismo trabajador."
          />
        </section>

        {/* Una sola base para el dinero, dicha en pantalla: sin esto /analitica y el tablero parecían
            discrepar sin motivo (CHART-033). */}
        <p className="text-xs leading-5 text-[var(--color-text-muted)] text-pretty">
          <strong className="font-semibold text-[var(--color-text)]">Base de las cifras.</strong>{" "}
          Una orden de compra cuenta en el período en que se <strong className="font-semibold">emitió</strong> (no en el que se creó), con impuestos incluidos, y no cuenta borradores, anuladas ni eliminadas: es la misma definición de Finanzas en el tablero.
          {canViewFuelCosts ? " El combustible suma las transacciones Copec aceptadas y vigentes, con impuestos." : ""}
        </p>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <ChartSection
            title="Tendencia mensual de gasto"
            // La serie no sigue el período elegido: son 12 meses que terminan en `hasta` (C-10). La frase nombra la
            // ventana, el mes parcial y los meses sin datos del proveedor (C-4), y el mayor mes sólo entre los comparables.
            summary={monthlyTrendSummary(data.filters.toDate, data.spendByMonth, formatCLP)}
            data={{ caption: "Gasto mensual en compras y combustible", ...trendDataRows(data.spendByMonth, canViewFuelCosts, formatCLP) }}
            empty={data.spendByMonth.every((row) => row.totalAmount === 0) ? {
              label: "Aún no hay gasto en los últimos 12 meses",
              hint: "No se registraron órdenes de compra emitidas ni combustible en las faenas seleccionadas durante esta ventana. Revisa los filtros o que existan movimientos.",
              ...(canViewPurchasing ? { ctaLabel: "Ver compras", ctaHref: "/compras" } : {}),
            } : null}
          >
            <ChartErrorBoundary chartName="la tendencia mensual">
              <MonthlySpendChart data={data.spendByMonth} showFuel={canViewFuelCosts} />
            </ChartErrorBoundary>
          </ChartSection>
          <ChartSection
            title="Gasto por tipo"
            summary={rankingLeaderSummary(spendByTypeItems, formatCLP, { of: "del gasto" })}
            empty={spendByTypeItems.length === 0 ? {
              label: "Sin gasto para distribuir",
              hint: "La distribución por tipo aparece cuando hay compras o combustible registrados en el período.",
            } : null}
          >
            <RankedList items={spendByTypeItems} format="clp" mode="share" order="input" limit={spendByTypeItems.length} ariaLabel="Gasto por tipo" />
          </ChartSection>
        </section>

        <ChartSection
          title="Concentración del gasto por proveedor"
          summary={paretoSummary(pareto, concentrationThreshold, canViewFuelCosts ? "del gasto" : "del gasto en compras")}
          data={{
            caption: "Gasto por proveedor y porcentaje acumulado del gasto total",
            headers: ["Proveedor", "Módulo", "OC o cargas", "Gasto", "% del gasto", "% acumulado"],
            rows: paretoRows.map((row) => [
              row.href ? <Link key={row.key} href={row.href} className="font-medium text-[var(--color-primary-ink)] hover:underline">{row.label}</Link> : row.label,
              row.module ?? "Varios",
              row.isOther ? "—" : formatQty(row.count),
              formatCLP(row.amount),
              formatPercent(row.sharePct, 1),
              formatPercent(row.cumulativePct, 1),
            ]),
          }}
          empty={paretoEmpty}
        >
          <ChartErrorBoundary chartName="el Pareto de proveedores">
            <SupplierParetoChart rows={paretoRows} thresholdPct={concentrationThreshold} />
          </ChartErrorBoundary>
        </ChartSection>

        <LeadTimeSection report={leadTime} ignoresFilters={Boolean(data.filters.supplierId || data.filters.vehicleId)} />

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <ChartSection
            title="Faenas con mayor gasto"
            summary={rankingLeaderSummary(worksiteItems, formatCLP)}
            empty={worksiteItems.length === 0 ? { label: "Sin gasto por faena para el filtro actual." } : null}
          >
            <RankedList items={worksiteItems} format="clp" mode="share" order="input" limit={10} ariaLabel="Faenas con mayor gasto" />
          </ChartSection>
          {canViewFuelCosts && (
            <ChartSection
              title="Vehículos con mayor gasto de combustible"
              summary={rankingLeaderSummary(vehicleItems, formatCLP, { gender: "o" })}
              empty={vehicleItems.length === 0 ? { label: "Sin cargas de combustible por vehículo en el período." } : null}
            >
              <RankedList items={vehicleItems} format="clp" mode="share" order="input" limit={10} ariaLabel="Vehículos con mayor gasto de combustible" />
            </ChartSection>
          )}
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* Destino del tile «Alertas». `tabIndex={-1}` deja que el salto de ancla mueva el foco
              aquí; `scroll-mt-4` por convención de las demás anclas (la TopBar no es sticky). */}
          <Card
            id="alertas"
            role="region"
            aria-labelledby="alertas-titulo"
            tabIndex={-1}
            className="scroll-mt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            <CardHeader>
              <CardTitle id="alertas-titulo">Alertas accionables</CardTitle>
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

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
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
          title="Órdenes de compra emitidas recientemente"
          headers={["OC", "Faena", "Proveedor", "Emisión", "Monto"]}
          rows={data.recentOrders.map((row) => [
            canViewPurchasing
              ? <Link key={row.id} href={`/compras/${row.id}`} className="font-medium text-[var(--color-primary)] hover:underline">{row.code}</Link>
              : row.code,
            row.worksiteName,
            row.supplierName,
            formatDate(row.issuedAt),
            formatCLP(row.totalAmount),
          ])}
          empty="Sin órdenes de compra para el filtro actual."
        />
      </div>
    </PageContainer>
  )
}
