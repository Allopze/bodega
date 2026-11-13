import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Plus } from "@phosphor-icons/react/dist/ssr"
import { can, requirePermission } from "@/lib/auth/can"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { toInvoiceFilters } from "@/lib/combustibles/period"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS, withFuelContext } from "@/lib/combustibles/routes"
import { FUEL_CARRY_PARAMS, fuelAddDataOptions, pagosNavItems } from "@/lib/combustibles/section-nav"
import { buildPaginationHref } from "@/lib/pagination"
import { formatCLP, formatQty } from "@/lib/utils"
import { AddFuelDataButton } from "@/components/combustibles/add-fuel-data-button"
import { FuelTerm } from "@/components/combustibles/fuel-glossary"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { ExportButton } from "@/components/ui/export-button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNav } from "@/components/ui/section-nav"
import { exportFuelLoadsXlsxAction } from "../actions-module/export"
import { loadInvoicesData } from "./invoice-data"
import { InvoiceCharts } from "./invoice-charts"
import { InvoiceFilters } from "./invoice-filters"
import { INVOICE_FILTER_KEYS, invoiceEquipmentLabel, parseInvoiceParams } from "./invoice-params"
import type { InvoiceFilters as InvoiceQueryFilters } from "./invoice-query"
import { InvoicesTable } from "./invoices-table"

export const metadata: Metadata = { title: "Facturas y pagos" }

type SearchParams = Record<string, string | string[] | undefined>

/**
 * Facturas y pagos › Facturas: las cargas facturadas del período con su neto, IEC e IVA.
 * Antes era `/combustibles/facturas`. Exige costos (`view_costs`) y el alcance por
 * faena de la sesión; el período es el de la cabecera (`toInvoiceFilters`). Las
 * consultas viven en `invoice-data.ts`.
 */
export default async function PagosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view_costs", FUEL_PATHS.pagos); assertFuelCostAccess(session) } catch { redirect("/forbidden") }
  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const params = parseInvoiceParams(sp)

  const filters: InvoiceQueryFilters = {
    ...toInvoiceFilters(period),
    q: params.q || undefined,
    serviceType: params.servicio || undefined,
    vehicleId: params.equipo || undefined,
    worksiteId: params.faena || undefined,
    fuelSupplierId: params.proveedor || undefined,
    product: params.producto || undefined,
    productId: params.productoId || undefined,
    status: params.estado || undefined,
  }
  const data = await loadInvoicesData(session, filters, params.pagina)
  const { rows, pagination, summary, degraded } = data

  const hasFilters = Boolean(params.q) || INVOICE_FILTER_KEYS.some((key) => params[key])
  const canCreate = can(session, "combustibles:create")
  const exportFilters: NonNullable<Parameters<typeof exportFuelLoadsXlsxAction>[0]> = { ...filters }

  // `page` es el nombre de antes del rediseño: si la URL aún lo trae, no debe sobrevivir al paginar.
  const { page: legacyPage, ...paginationParams } = sp
  void legacyPage
  const hrefForPage = (target: number) => buildPaginationHref(FUEL_PATHS.pagos, paginationParams, target, "pagina")
  const clearFiltersHref = withFuelContext(FUEL_PATHS.pagos, { periodo: sp.periodo, desde: sp.desde, hasta: sp.hasta })

  return (
    <PageContainer>
      <PageHeader
        title="Facturas y pagos"
        description="Facturas de combustible con su neto, IEC e IVA"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Facturas y pagos" }]} />}
        actions={
          <FuelHeaderActions period={period}>
            {can(session, "combustibles:export_sensitive") && (
              <ExportButton action={exportFuelLoadsXlsxAction} filters={exportFilters} label="Exportar Excel" ariaLabel="Exportar las facturas con montos a Excel" />
            )}
            <AddFuelDataButton options={fuelAddDataOptions(session)} />
            {canCreate && (
              <Button asChild size="sm" variant="primary">
                <Link href={FUEL_PATHS.pagosNueva}><Plus aria-hidden="true" />Nueva factura</Link>
              </Button>
            )}
          </FuelHeaderActions>
        }
      />

      <SectionNav items={pagosNavItems(session)} activeKey="facturas" ariaLabel="Pagos" carryParams={FUEL_CARRY_PARAMS} />
      <DegradedDataBanner degraded={degraded} total={data.trackedTotal} />

      {summary.loads > 0 && (
        <div className="mb-4 space-y-1">
          <p className="text-sm text-[var(--color-text)]">
            {params.estado ? "Hay " : hasFilters ? "Con estos filtros se facturaron " : "Se facturaron "}
            <strong className="font-semibold"><span className="font-mono tabular-nums">{formatQty(summary.loads)}</span> {summary.loads === 1 ? "factura" : "facturas"}</strong>
            {" por "}
            <strong className="font-mono font-semibold tabular-nums">{formatCLP(summary.total)}</strong>
            {` ${period.inLabel}`}
            {summary.liters > 0 && <>, a <span className="font-mono tabular-nums">{formatCLP(summary.total / summary.liters)}</span> por litro en promedio</>}.
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            Neto <span className="font-mono tabular-nums">{formatCLP(summary.base)}</span>
            {" · "}<FuelTerm term="IEC">IEC</FuelTerm>{" "}<span className="font-mono tabular-nums">{formatCLP(summary.iec)}</span>
            {" · "}<FuelTerm term="IVA">IVA</FuelTerm>{" "}<span className="font-mono tabular-nums">{formatCLP(summary.iva)}</span>
            {" · "}<span className="font-mono tabular-nums">{formatQty(summary.liters)}</span> litros
            {!params.estado && ". No cuenta borradores ni cargas anuladas."}
          </p>
        </div>
      )}

      <InvoiceFilters
        equipment={data.options.vehicles.map((v) => ({ value: v.id, label: invoiceEquipmentLabel(v) }))}
        suppliers={data.options.suppliers}
        worksites={data.options.worksites}
        products={data.options.products}
        current={params}
      />

      {degraded.includes("facturas-lista") ? null : rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? "Ninguna factura coincide con estos filtros" : `No hay facturas ${period.inLabel}`}
          description={hasFilters
            ? "Prueba con otro período o quita algún filtro para ver más."
            : "Aquí aparecen las facturas de combustible del período, con su neto, IEC e IVA. Registra una factura o cárgalas desde un Excel con «Agregar datos»."}
          action={hasFilters
            ? <Button asChild variant="secondary"><Link href={clearFiltersHref}>Quitar filtros</Link></Button>
            : canCreate ? <Button asChild variant="primary"><Link href={FUEL_PATHS.pagosNueva}>Nueva factura</Link></Button> : undefined}
        />
      ) : (
        <InvoicesTable rows={rows} pagination={pagination} hrefForPage={hrefForPage} />
      )}

      {rows.length > 0 && <InvoiceCharts data={data.charts} />}
    </PageContainer>
  )
}
