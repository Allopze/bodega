import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { ServerPagination } from "@/components/ui/server-pagination"
import { SegmentedControl } from "@/components/ui/segmented-control"
import {
  getConsolidatedTraceability,
  TRACEABILITY_CONSOLIDATED_PAGE_SIZE,
  TRACEABILITY_MAX_ITEM_ROWS,
} from "@/lib/services/trazabilidad-consolidated"
import {
  listTraceabilityIntegrityAdjustmentOptions,
  listTraceabilityIntegrityCases,
} from "@/lib/services/traceability-integrity-cases"
import { getDocumentChainByCode } from "@/lib/services/document-chain"
import { ConsolidatedKpis } from "./_components/consolidated-kpis"
import { ConsolidatedFilters } from "./_components/consolidated-filters"
import { ConsolidatedTable } from "./_components/consolidated-table"
import { ConsolidatedRequestsSummary } from "./_components/consolidated-requests-summary"
import { TraceabilityIntegrityCases } from "./_components/traceability-integrity-cases"
import { DocumentChainSearch } from "./_components/document-chain-search"
import { Path, Warning } from "@phosphor-icons/react/dist/ssr"
import { resolvePagination, type PaginationState } from "@/lib/pagination"

export const metadata: Metadata = {
  title: "Trazabilidad y Seguimiento por Faena",
  description: "Control integrado de solicitudes, órdenes de compra, recepciones, guías y entregas por faena.",
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function TrazabilidadPage({ searchParams }: PageProps) {
  let session
  try {
    session = await requirePermission("warehouse:view_traceability")
  } catch {
    redirect(`/forbidden?desde=${encodeURIComponent("/bodega/trazabilidad")}`)
  }

  const sp = await searchParams
  const activeTab = typeof sp.tab === "string" && sp.tab === "documento" ? "documento" : "seguimiento"

  // 1. Integridad
  const canReconcileIntegrity = can(session, "warehouse:reconcile_integrity")
  const [integrityCases, adjustmentOptions] = await Promise.all([
    listTraceabilityIntegrityCases(session),
    canReconcileIntegrity ? listTraceabilityIntegrityAdjustmentOptions(session) : Promise.resolve([]),
  ])

  // 2. Tab Documento (búsqueda por código)
  const codigoQuery = typeof sp.codigo === "string" ? sp.codigo.trim() : ""
  const chainResult = activeTab === "documento" && codigoQuery
    ? await getDocumentChainByCode(session, codigoQuery)
    : null

  // 3. Tab Seguimiento (vista consolidada por faena)
  const consolidatedData = activeTab === "seguimiento"
    ? await getConsolidatedTraceability(sp, session)
    : null

  const paginationState: PaginationState | null = consolidatedData && consolidatedData.totalFiltered > 0
    ? resolvePagination({
        pageParam: sp.page,
        totalItems: consolidatedData.totalFiltered,
        pageSize: TRACEABILITY_CONSOLIDATED_PAGE_SIZE,
      })
    : null

  const hrefForPage = (targetPage: number) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) {
      if (v !== undefined && v !== null && k !== "page") {
        if (Array.isArray(v)) v.forEach((val) => params.append(k, val))
        else params.set(k, v)
      }
    }
    params.set("page", String(targetPage))
    return `/bodega/trazabilidad?${params.toString()}`
  }

  /**
   * Las pestañas conservan los filtros de seguimiento (OP-06, auditoría
   * 2026-09-05).
   *
   * Antes sólo viajaba la faena: ir a "Buscar por código" y volver perdía
   * `estado`, `desde`/`hasta`, el solicitante y el resto de filtros, dejando
   * al usuario en la faena sin su contexto de búsqueda. La pestaña "Seguimiento"
   * reconstruye la URL con todos los filtros vigentes; "Documento" conserva sólo
   * la faena y el código que se esté mirando.
   */
  const FILTER_KEYS = ["faena", "estado", "categoria", "solicitante", "proveedor", "desde", "hasta", "pendientes"] as const
  const faenaParam = typeof sp.faena === "string" && sp.faena ? sp.faena : ""
  const tabHref = (tab: "seguimiento" | "documento") => {
    const params = new URLSearchParams()
    if (tab === "documento") params.set("tab", "documento")
    for (const key of FILTER_KEYS) {
      const value = sp[key]
      if (typeof value === "string" && value) params.set(key, value)
    }
    if (tab === "documento" && typeof sp.codigo === "string" && sp.codigo.trim()) {
      params.set("codigo", sp.codigo.trim())
    }
    const query = params.toString()
    return query ? `/bodega/trazabilidad?${query}` : "/bodega/trazabilidad"
  }

  const hasSecondaryFilters = Boolean(
    consolidatedData &&
    (consolidatedData.filters.q ||
      consolidatedData.filters.estado ||
      consolidatedData.filters.categoria ||
      consolidatedData.filters.proveedor ||
      consolidatedData.filters.solicitante ||
      consolidatedData.filters.desde ||
      consolidatedData.filters.hasta ||
      consolidatedData.filters.pendientes),
  )

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Trazabilidad y Seguimiento por Faena"
        description="Estado completo de materiales, insumos y EPP por faena: solicitudes, órdenes de compra, recepciones, stock y entregas."
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Inicio", href: "/dashboard" },
              { label: "Bodega", href: "/bodega" },
              { label: "Trazabilidad" },
            ]}
          />
        }
      />

      {/* Excepciones de integridad históricas */}
      <TraceabilityIntegrityCases
        cases={integrityCases}
        canReconcile={canReconcileIntegrity}
        adjustmentOptions={adjustmentOptions}
      />

      {/* Pestañas de la vista. `SegmentedControl` es el primitivo del sistema
          para selectores sincronizados con la URL: el subrayado azul artesanal
          que había aquí importaba un color de marca que la paleta no define. */}
      <SegmentedControl
        variant="segmented"
        ariaLabel="Vista de trazabilidad"
        className="mb-5"
        items={[
          {
            key: "seguimiento",
            label: "Seguimiento por faena",
            href: tabHref("seguimiento"),
            active: activeTab === "seguimiento",
          },
          {
            key: "documento",
            label: "Buscar por código",
            href: tabHref("documento"),
            active: activeTab === "documento",
          },
        ]}
      />

      {activeTab === "documento" ? (
        <DocumentChainSearch query={codigoQuery} result={chainResult} faena={faenaParam} />
      ) : consolidatedData ? (
        <div className="space-y-4">
          {/* La vista carga un techo de ítems por faena: si se alcanzó, los
              totales y KPIs cubren sólo los más recientes y hay que decirlo. */}
          {consolidatedData.truncated && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] px-4 py-3 text-xs text-[var(--color-signal-ink)]"
            >
              <Warning size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
              <p>
                Esta faena tiene más de {TRACEABILITY_MAX_ITEM_ROWS.toLocaleString("es-CL")} ítems.
                Se muestran los más recientes: acota con un rango de fechas para que los totales y
                las métricas cubran todo el período que te interesa.
              </p>
            </div>
          )}

          {/* Métricas / KPIs superiores */}
          <ConsolidatedKpis
            kpis={consolidatedData.kpis}
            filters={consolidatedData.filters}
            filtered={hasSecondaryFilters}
          />

          {/* Barra de filtros y selector de faena */}
          <ConsolidatedFilters
            worksites={consolidatedData.visibleWorksites}
            categories={consolidatedData.categories}
            requesters={consolidatedData.requesters}
            suppliers={consolidatedData.suppliers}
            current={consolidatedData.filters}
          />

          {/* Tabla de resultados o estado vacío */}
          {consolidatedData.rows.length === 0 ? (
            <EmptyState
              icon={<Path size={28} />}
              title={
                hasSecondaryFilters
                  ? "Sin resultados para los filtros seleccionados"
                  : "No hay ítems registrados para esta faena"
              }
              description={
                hasSecondaryFilters
                  ? "Intenta modificar o restablecer los filtros para ver otros movimientos."
                  : "Cuando se ingresen solicitudes de compra o materiales para esta faena, su avance aparecerá reflejado aquí."
              }
            />
          ) : (
            /* Sin tarjeta envolvente: `TableRoot` ya aporta borde, radio y
               superficie por token, y las tarjetas mobile traen los suyos. El
               `<div>` que había aquí los duplicaba —dos bordes y dos radios
               anidados a 1px, con un gris distinto al del sistema— y su
               `overflow-hidden` recortaba la región de scroll de la tabla. */
            <>
              {/* TR-I1: la tabla ya es por solicitud (desktop) y el resumen por
                  solicitud (mobile). Ambos cuentan el mismo universo que la
                  paginación, que opera sobre solicitudes. */}
              <ConsolidatedTable requests={consolidatedData.requests} />

              {/* Tarjetas mobile por solicitud */}
              <div className="md:hidden">
                <ConsolidatedRequestsSummary requests={consolidatedData.requests} />
              </div>

              {/* Paginación */}
              {paginationState && (
                <ServerPagination
                  pagination={paginationState}
                  hrefForPage={hrefForPage}
                />
              )}
            </>

          )}
        </div>
      ) : null}
    </PageContainer>
  )
}
