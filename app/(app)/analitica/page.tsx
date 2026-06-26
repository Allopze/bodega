import type { Metadata } from "next"
import type { ReactNode } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { asc, eq, inArray } from "drizzle-orm"
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  DownloadSimple,
  GasPump,
  Package,
  ShieldWarning,
  ShoppingCart,
  Truck,
  Warning,
} from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { fuelVehicles, suppliers, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { getAnalyticsDashboard, normalizeAnalyticsFilters, type AnalyticsAlertSeverity } from "@/lib/services/analytics"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { AnalyticsFiltersBar } from "./analytics-filters"
import { ModuleSpendChart, MonthlySpendChart, RankingBarChart } from "./analytics-charts"

export const metadata: Metadata = { title: "Analítica" }

export default async function AnaliticaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("analytics:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const filters = normalizeAnalyticsFilters({
    fromDate: getParam(sp, "from"),
    toDate: getParam(sp, "to"),
    worksiteId: getParam(sp, "faena"),
    supplierId: getParam(sp, "proveedor"),
    vehicleId: getParam(sp, "vehiculo"),
  })

  const [data, options] = await Promise.all([
    getAnalyticsDashboard(session, filters),
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
            { label: "Dashboard", href: "/dashboard" },
            { label: "Reportes", href: "/reportes" },
            { label: "Analítica" },
          ]} />
        }
        actions={
          <Link
            href={`/api/reportes/export?${exportParams.toString()}`}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius)] bg-[var(--color-primary)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-primary-strong)]"
          >
            <DownloadSimple size={14} />
            Exportar XLSX
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

        <section aria-label="KPIs ejecutivos" className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            icon={<ShoppingCart size={18} />}
            label="Gasto total"
            value={formatCLP(data.kpis.totalSpend)}
            detail={`Período ${data.filters.fromDate} a ${data.filters.toDate}`}
            trend={data.kpis.spendVariationPct}
          />
          <KpiCard
            icon={<Package size={18} />}
            label="Órdenes de compra"
            value={formatQty(data.kpis.purchaseOrderCount)}
            detail={`Promedio ${formatCLP(data.kpis.averageOrderAmount)}`}
          />
          <KpiCard
            icon={<GasPump size={18} />}
            label="Combustible"
            value={formatCLP(data.vehicleCosts.reduce((sum, row) => sum + row.totalFuelAmount, 0))}
            detail={`${formatQty(data.kpis.fuelLiters, "L")} · ${data.kpis.fuelLoadCount} cargas`}
          />
          <KpiCard
            icon={<ShieldWarning size={18} />}
            label="Alertas"
            value={formatQty(data.alerts.length)}
            detail={`${data.kpis.criticalStockCount} productos bajo mínimo`}
            tone={data.alerts.some((alert) => alert.severity === "critical") ? "signal" : "neutral"}
          />
          <KpiCard
            icon={<Truck size={18} />}
            label="Vehículos"
            value={formatQty(data.vehicleCosts.length)}
            detail="Combustible, mantenciones e imputaciones"
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
          <Card>
            <CardHeader>
              <CardTitle>Vehículos con mayor costo</CardTitle>
            </CardHeader>
            <CardContent>
              <RankingBarChart data={data.vehicleCosts} labelKey="plate" valueKey="totalOperationalCost" emptyLabel="Sin cargas de combustible por vehículo en el período." />
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Alertas accionables</CardTitle>
            </CardHeader>
            <CardContent>
              {data.alerts.length > 0 ? (
                <div className="grid gap-3">
                  {data.alerts.slice(0, 8).map((alert, index) => (
                    <div key={`${alert.type}-${alert.entityLabel}-${index}`} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <SeverityBadge severity={alert.severity} />
                            <span className="text-xs font-medium text-[var(--color-text-subtle)]">{alert.module}</span>
                          </div>
                          <p className="mt-2 text-sm font-semibold text-[var(--color-text)]">{alert.entityLabel}</p>
                          <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{alert.reason}</p>
                        </div>
                        <Warning size={17} className="mt-1 shrink-0 text-[var(--color-signal)]" />
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
            rows={data.topSuppliers.map((row) => [
              <Link key={row.id} href={row.module === "Combustible" ? `/combustibles?proveedor=${row.id}` : `/compras?proveedor=${row.id}`} className="font-medium text-[var(--color-primary)] hover:underline">
                {row.name}
              </Link>,
              row.module ?? "Compras",
              formatQty(row.count),
              formatCLP(row.totalAmount),
            ])}
            empty="Sin proveedores con gasto para el período."
          />
          <RankingTable
            title="Stock crítico"
            headers={["Producto", "Faena", "Stock", "Mínimo"]}
            rows={data.stockRisks.map((row) => [
              row.productName,
              <Link key={`${row.productId}-${row.worksiteName}`} href={`/bodega?producto=${row.productId}`} className="text-[var(--color-primary)] hover:underline">
                {row.worksiteName}
              </Link>,
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
              <Link key={`${row.productId}-${row.workerName}`} href="/entregas" className="text-[var(--color-primary)] hover:underline">
                {row.worksiteName}
              </Link>,
              formatQty(row.totalQty),
            ])}
            empty="Sin entregas de EPP para el período."
          />
        </section>

        <RankingTable
          title="Órdenes recientes consideradas"
          headers={["OC", "Faena", "Proveedor", "Fecha", "Monto"]}
          rows={data.recentOrders.map((row) => [
            <Link key={row.id} href={`/compras/${row.id}`} className="font-medium text-[var(--color-primary)] hover:underline">
              {row.code}
            </Link>,
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

function KpiCard({
  icon,
  label,
  value,
  detail,
  trend,
  tone = "neutral",
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  trend?: number | null
  tone?: "neutral" | "signal"
}) {
  return (
    <Card className={tone === "signal" ? "ring-1 ring-[var(--color-signal-line)]" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
            {icon}
          </span>
          {typeof trend === "number" && (
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${trend >= 0 ? "text-[var(--color-signal-ink)]" : "text-[var(--color-success)]"}`}>
              {trend >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              {Math.abs(trend)}%
            </span>
          )}
        </div>
        <p className="mt-4 text-xs font-medium uppercase text-[var(--color-text-subtle)]">{label}</p>
        <p className="mt-1 truncate text-xl font-semibold tracking-normal text-[var(--color-text)]">{value}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{detail}</p>
      </CardContent>
    </Card>
  )
}

function RankingTable({
  title,
  headers,
  rows,
  empty,
}: {
  title: string
  headers: string[]
  rows: ReactNode[][]
  empty: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length > 0 ? (
          <TableRoot className="shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((header, index) => (
                    <TableHead key={header} className={index === headers.length - 1 ? "text-right" : undefined}>{header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 8).map((row, rowIndex) => (
                  <TableRow key={`${title}-${rowIndex}`}>
                    {row.map((cell, cellIndex) => {
                      const isLast = cellIndex === row.length - 1
                      const Cell = isLast ? TableCellNum : TableCell
                      return <Cell key={cellIndex}>{cell}</Cell>
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        ) : (
          <EmptyText text={empty} />
        )}
      </CardContent>
    </Card>
  )
}

function SeverityBadge({ severity }: { severity: AnalyticsAlertSeverity }) {
  if (severity === "critical") return <Badge variant="signal" size="sm" dot>Crítica</Badge>
  if (severity === "high") return <Badge variant="warning" size="sm" dot>Alta</Badge>
  if (severity === "medium") return <Badge variant="default" size="sm">Media</Badge>
  return <Badge variant="outline" size="sm">Baja</Badge>
}

function EmptyText({ text }: { text: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
      {text}
    </div>
  )
}

async function getFilterOptions(session: Awaited<ReturnType<typeof requirePermission>>) {
  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const worksiteWhere = isGlobal
    ? eq(worksites.isActive, true)
    : wsIds.length > 0
      ? inArray(worksites.id, wsIds)
      : inArray(worksites.id, ["__none__"])

  const [worksiteRows, supplierRows, vehicleRows] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(worksiteWhere)
      .orderBy(asc(worksites.name)),
    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.name)),
    db.select({ id: fuelVehicles.id, name: fuelVehicles.plate, plate: fuelVehicles.plate })
      .from(fuelVehicles)
      .where(eq(fuelVehicles.isActive, true))
      .orderBy(asc(fuelVehicles.plate)),
  ])

  return {
    worksites: worksiteRows,
    suppliers: supplierRows,
    vehicles: vehicleRows,
  }
}

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key]
  return typeof value === "string" && value.trim() ? value : undefined
}
