import type { Metadata } from "next"
import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { Callout } from "@/components/ui/callout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { RankedList } from "@/components/ui/ranked-list"
import { SectionNav } from "@/components/ui/section-nav"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { can, requirePermission } from "@/lib/auth/can"
import { controlFiltersToParams } from "@/lib/combustibles/control/filters"
import { controlFiltersForRange } from "@/lib/combustibles/control/queries/field-filters"
import { getSealJustifications, getSupervisorSealSummary, listSealDetail, listSealVehicles } from "@/lib/combustibles/control/queries/seals"
import { toDateRange } from "@/lib/combustibles/period/adapters"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS, withFuelContext } from "@/lib/combustibles/routes"
import { FUEL_CARRY_PARAMS, cuadraturaNavItems } from "@/lib/combustibles/section-nav"
import { getSealHistory } from "@/lib/combustibles/seal-history"
import { getTaeGroupedTotals, type TaeGroupRow } from "@/lib/combustibles/tae-dashboard"
import { resolvePagination } from "@/lib/pagination"
import { ControlFilters } from "../../_shared/control-filters"
import { loadCuadraturaContext } from "../_components/context"
import { LazyDetails } from "../_components/lazy-details"
import { firstParam, hrefWith, periodContext } from "../_components/params"
import { ControlSection, SectionError } from "../_components/section"
import { createSourceTracker } from "../_components/track"
import { UrlSelect } from "../_components/url-select"
import { DetailSection } from "./detail-section"
import { TaeGroupChart } from "./group-chart"
import { SealHistorySection } from "./history-section"
import { SealsExportButton } from "./seals-export-button"
import { SupervisorsSection, sealsAnswer } from "./supervisors-section"

export const metadata: Metadata = { title: "Sellos" }

type SearchParams = Record<string, string | string[] | undefined>
type SealsView = "supervisores" | "historial" | "detalle"

const PATH = FUEL_PATHS.cuadraturaSellos
const PAGE_SIZE = 50
const VIEWS: Array<{ key: SealsView; label: string }> = [
  { key: "supervisores", label: "Por supervisor" },
  { key: "historial", label: "Historial de sellos" },
  { key: "detalle", label: "Detalle por equipo" },
]
const NO_GROUPS: TaeGroupRow[] = []

export default async function CuadraturaSellosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", PATH) } catch { redirect("/forbidden") }
  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const worksiteId = firstParam(sp, "faena")
  const equipment = firstParam(sp, "equipo")
  const sealNumber = firstParam(sp, "sello")
  const plate = firstParam(sp, "patente")

  // El historial se ve con `view`, como antes (`/sellos`). El resumen por supervisor, el detalle por equipo y
  // los litros por persona son datos de terreno y siguen pidiendo `tae_view`, como antes (`/control/sellos`).
  const canField = can(session, "combustibles:tae_view")
  const canViewPersonal = can(session, "combustibles:view_personal")
  const canExport = canField && can(session, "combustibles:tae_export")
  const requested = firstParam(sp, "vista")
  const view: SealsView = !canField ? "historial" : VIEWS.some((item) => item.key === requested) ? (requested as SealsView) : "supervisores"

  const range = toDateRange(period)
  const filters = controlFiltersForRange(range, { worksiteId, equipment: view === "detalle" ? equipment : undefined, page: Math.max(1, Number.parseInt(firstParam(sp, "pagina") ?? "1", 10) || 1) })
  const ctxParams = periodContext(period, worksiteId)
  const cargasHref = withFuelContext(`${FUEL_PATHS.cargas}?${new URLSearchParams({ como: "qr,app,historico" }).toString()}`, ctxParams)
  const phrase = `en ${period.inLabel}`
  const access = { canViewPersonal }
  const exportQuery = controlFiltersToParams({ from: range.from, to: range.to, worksiteId, equipment: view === "detalle" ? equipment : undefined }).toString()

  const ctx = await loadCuadraturaContext(session)
  const { track, degraded, total } = createSourceTracker("cuadratura-sellos")

  let body: ReactNode
  let filterExtras: ReactNode = null

  if (view === "supervisores") {
    const [supervisors, justifications, points, drivers, supervisorLiters] = await Promise.all([
      track(getSupervisorSealSummary(session, filters, access), [], "supervisores"),
      track(getSealJustifications(session, filters, access), [], "justificaciones"),
      track(getTaeGroupedTotals(session, { worksiteId, ...range }, "loadingPoint"), NO_GROUPS, "litros por punto de carga"),
      track(getTaeGroupedTotals(session, { worksiteId, ...range }, "driver"), NO_GROUPS, "litros por conductor"),
      track(getTaeGroupedTotals(session, { worksiteId, ...range }, "supervisor"), NO_GROUPS, "litros por supervisor"),
    ])
    const drilldownBaseHref = withFuelContext(`${FUEL_PATHS.cargas}?${new URLSearchParams({ como: "qr,app,historico" }).toString()}`, ctxParams)
    body = (
      <div className="space-y-8">
        {supervisors.failed ? null : <p className="max-w-3xl text-base text-[var(--color-text)]" data-testid="sellos-answer">{sealsAnswer(supervisors.data, phrase)}</p>}
        <ControlSection id="supervisores" title="Cargas y sellos por supervisor" question="¿Quién cargó, y dónde faltaron sellos o se cortó la cadena?">
          {supervisors.failed || justifications.failed ? <SectionError what="el resumen por supervisor" /> : <SupervisorsSection rows={supervisors.data} justifications={justifications.data} cargasHref={cargasHref} />}
        </ControlSection>
        <ControlSection id="puntos" title="Litros por punto de carga" question="¿Qué punto reparte más? Útil para decidir dónde reforzar el control.">
          {points.failed ? <SectionError what="los litros por punto de carga" /> : points.data.length === 0 ? (
            <EmptyState compact title="No hay cargas en terreno en este período" description="Cuando se registren cargas en un punto de carga, aparece cuántos litros repartió." />
          ) : (
            <Card>
              <CardContent className="pt-4">
                <RankedList
                  ariaLabel="Litros por punto de carga"
                  format="count"
                  unit=" L"
                  limit={8}
                  items={points.data.map((row) => ({ key: row.group, label: row.group, value: row.liters, detail: `${row.count} ${row.count === 1 ? "carga" : "cargas"}` }))}
                />
              </CardContent>
            </Card>
          )}
        </ControlSection>
        <LazyDetails summary="Más análisis: litros por supervisor y por conductor" hint="Cada barra abre las cargas de esa persona en el período. Sin el permiso para ver datos personales, las personas salen numeradas por volumen.">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Litros por supervisor</CardTitle><CardDescription>¿Qué supervisor concentra el volumen repartido?</CardDescription></CardHeader>
              <CardContent>{supervisorLiters.failed ? <SectionError what="los litros por supervisor" /> : <TaeGroupChart data={supervisorLiters.data} drilldownBaseHref={drilldownBaseHref} />}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Litros por conductor</CardTitle><CardDescription>¿Qué conductor recibió más litros en el período?</CardDescription></CardHeader>
              <CardContent>{drivers.failed ? <SectionError what="los litros por conductor" /> : <TaeGroupChart data={drivers.data} drilldownBaseHref={drilldownBaseHref} />}</CardContent>
            </Card>
          </div>
        </LazyDetails>
      </div>
    )
  } else if (view === "historial") {
    filterExtras = (
      <>
        <FilterSearchInput param="sello" placeholder="Buscar un sello…" ariaLabel="Buscar por número de sello" pageKeys={["pagina"]} />
        <FilterSearchInput param="patente" placeholder="Buscar una patente…" ariaLabel="Buscar por patente" pageKeys={["pagina"]} />
      </>
    )
    const history = await track(getSealHistory(session, { worksiteId, from: range.from, to: range.to, sealNumber, plate }), [], "historial de sellos")
    const pagination = resolvePagination({ pageParam: firstParam(sp, "pagina"), totalItems: history.data.length, pageSize: PAGE_SIZE })
    body = history.failed
      ? <SectionError what="el historial de sellos" />
      : (
        <SealHistorySection
          rows={history.data.slice(pagination.offset, pagination.offset + PAGE_SIZE)}
          total={history.data.length}
          pagination={pagination}
          hrefForPage={(page) => hrefWith(PATH, sp, { pagina: page > 1 ? String(page) : null })}
          clearHref={hrefWith(PATH, sp, { sello: null, patente: null, pagina: null })}
        />
      )
  } else {
    const offset = (filters.page - 1) * PAGE_SIZE
    const [detail, vehicles] = await Promise.all([
      track(listSealDetail(session, filters, { ...access, limit: PAGE_SIZE, offset }), { rows: [], total: 0 }, "detalle"),
      track(listSealVehicles(session, filters), [], "equipos"),
    ])
    const pagination = resolvePagination({ pageParam: String(filters.page), totalItems: detail.data.total, pageSize: PAGE_SIZE })
    filterExtras = vehicles.failed ? null : <UrlSelect param="equipo" options={vehicles.data} value={equipment ?? ""} ariaLabel="Equipo del detalle" allLabel="Todos los equipos" />
    body = (
      <ControlSection id="detalle" title="Detalle por equipo" question="¿Qué se cargó en cada equipo, con qué sellos y desde dónde?">
        {detail.failed
          ? <SectionError what="el detalle de cargas" />
          : <DetailSection rows={detail.data.rows} pagination={pagination} hrefForPage={(page) => hrefWith(PATH, sp, { pagina: page > 1 ? String(page) : null })} canViewPhotos={canViewPersonal} clearHref={equipment ? hrefWith(PATH, sp, { equipo: null, pagina: null }) : undefined} />}
      </ControlSection>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Sellos"
        description="La cadena de sellos de cada equipo, carga a carga"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cuadratura", href: FUEL_PATHS.cuadratura }, { label: "Sellos" }]} />}
        actions={<FuelHeaderActions period={period}>{canExport ? <SealsExportButton query={exportQuery} /> : null}</FuelHeaderActions>}
      />
      <SectionNav items={cuadraturaNavItems(session)} activeKey="sellos" ariaLabel="Vistas de cuadratura" carryParams={FUEL_CARRY_PARAMS} />
      <DegradedDataBanner degraded={degraded} total={total()} />
      <Callout tone="info" className="mb-4">
        <strong>Esto no es una diferencia de litros.</strong> Acá se revisa que cada carga tenga sus sellos y que la cadena no se corte; los litros se cuadran en las otras vistas.
      </Callout>
      {canField ? (
        <div className="mb-4">
          <SegmentedControl
            variant="segmented"
            ariaLabel="Vista de sellos"
            items={VIEWS.map((item) => ({ key: item.key, label: item.label, active: item.key === view, href: hrefWith(PATH, sp, { vista: item.key === "supervisores" ? null : item.key, pagina: null, equipo: null, sello: null, patente: null }) }))}
          />
        </div>
      ) : null}
      <ControlFilters worksites={ctx.worksites} extraKeys={["equipo", "sello", "patente"]}>{filterExtras}</ControlFilters>
      {body}
    </PageContainer>
  )
}
