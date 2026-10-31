import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNav } from "@/components/ui/section-nav"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { ServerPagination } from "@/components/ui/server-pagination"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { can, requirePermission } from "@/lib/auth/can"
import { wholeMonthRange } from "@/lib/combustibles/control/queries/field-filters"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { monthlyGranularityNote } from "@/lib/combustibles/period/adapters"
import { FUEL_PATHS, fuelInboxHref, withFuelContext } from "@/lib/combustibles/routes"
import { FUEL_CARRY_PARAMS, cuadraturaNavItems } from "@/lib/combustibles/section-nav"
import { getTaeCopecReconciliation, summarizeCardFieldCoverage, type TaeCopecFilters } from "@/lib/combustibles/tae-copec-reconciliation"
import { resolvePagination } from "@/lib/pagination"
import { ControlFilters } from "../../control/_components/control-filters"
import { loadCuadraturaContext } from "../_components/context"
import { litersText } from "../_components/format"
import { firstParam, hrefWith, periodContext } from "../_components/params"
import { SectionError } from "../_components/section"
import { createSourceTracker } from "../_components/track"
import { COVERAGE_BY_FILTER, COVERAGE_FILTER_LABEL, CoverageTable, coverageAnswer, type CoverageFilter } from "./coverage-table"
import { TaeCopecExportButton } from "./export-button"

export const metadata: Metadata = { title: "Tarjeta y terreno" }

type SearchParams = Record<string, string | string[] | undefined>

const PATH = FUEL_PATHS.cuadraturaTarjetaTerreno
const PAGE_SIZE = 50

const matches = (term: string, ...values: Array<string | null>) => values.some((value) => value?.toLocaleLowerCase("es-CL").includes(term))

export default async function CuadraturaTarjetaTerrenoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:tae_view", PATH) } catch { redirect("/forbidden") }
  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  // La tarjeta informa un total por patente y mes: con una semana o un rango se miden los meses completos que toca.
  const range = wholeMonthRange(period)
  const filters: TaeCopecFilters = { from: range.from, to: range.to, worksiteId: firstParam(sp, "faena") }
  const ctxParams = periodContext(period, filters.worksiteId)
  const filterParam = firstParam(sp, "cobertura")
  const coverageFilter = (filterParam && filterParam in COVERAGE_BY_FILTER ? filterParam : null) as CoverageFilter | null
  const term = (firstParam(sp, "q") ?? "").toLocaleLowerCase("es-CL")
  const ctx = await loadCuadraturaContext(session)
  const canExport = can(session, "combustibles:tae_export")

  const { track, degraded, total } = createSourceTracker("cuadratura-tarjeta-terreno")
  const result = await track(getTaeCopecReconciliation(session, filters), null, "cobertura de la tarjeta")
  const data = result.data
  const coverage = summarizeCardFieldCoverage(data?.rows ?? [])
  const searched = (data?.rows ?? []).filter((row) => !term || matches(term, row.equipment, row.plate, row.worksiteName))
  const visible = coverageFilter ? searched.filter((row) => row.coverage === COVERAGE_BY_FILTER[coverageFilter]) : searched
  const pagination = resolvePagination({ pageParam: firstParam(sp, "pagina"), totalItems: visible.length, pageSize: PAGE_SIZE })
  const pageRows = visible.slice(pagination.offset, pagination.offset + PAGE_SIZE)
  const granularityNote = monthlyGranularityNote(period)
  const counts: Record<CoverageFilter, number> = { ambos: coverage.both, tarjeta: coverage.cardOnly, terreno: coverage.fieldOnly }
  const unmapped = data?.summary

  return (
    <PageContainer>
      <PageHeader
        title="Tarjeta y terreno"
        description="Cuánto de lo que informa la tarjeta quedó registrado en terreno"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cuadratura", href: FUEL_PATHS.cuadratura }, { label: "Tarjeta y terreno" }]} />}
        actions={<FuelHeaderActions period={period}>{canExport ? <TaeCopecExportButton filters={filters} /> : null}</FuelHeaderActions>}
      />
      <SectionNav items={cuadraturaNavItems(session)} activeKey="tarjeta-y-terreno" ariaLabel="Vistas de cuadratura" carryParams={FUEL_CARRY_PARAMS} />
      <DegradedDataBanner degraded={degraded} total={total()} />
      <ControlFilters worksites={ctx.worksites} extraKeys={["q", "cobertura"]}>
        <FilterSearchInput param="q" placeholder="Buscar patente o equipo…" ariaLabel="Buscar patente o equipo" pageKeys={["pagina"]} />
      </ControlFilters>

      {granularityNote ? <Callout tone="info" className="mb-4">{granularityNote}</Callout> : null}

      {result.failed ? (
        <SectionError what="la cobertura de la tarjeta" />
      ) : (data?.rows.length ?? 0) === 0 ? (
        <EmptyState
          title="No hay cargas de tarjeta ni de terreno en este período"
          description="Esta vista cruza los totales que informa la tarjeta con las cargas registradas en terreno. Cuando haya de cualquiera de las dos, aparecen aquí por equipo y mes."
          action={<Button asChild variant="secondary"><Link href={withFuelContext(FUEL_PATHS.cargas, ctxParams)}>Ver las cargas del período</Link></Button>}
        />
      ) : (
        <div className="space-y-5">
          <p className="max-w-3xl text-base text-[var(--color-text)]" data-testid="coverage-answer">
            {coverageAnswer(coverage, period.monthKeys.length > 1)}
          </p>
          <Callout tone="info">
            <strong>Esto no es una diferencia contable.</strong> La tarjeta y el formulario en terreno son canales distintos: «En ambos» dice que el equipo aparece en los dos el mismo mes. La diferencia de litros se mide en{" "}
            <Link className="font-medium underline underline-offset-4" href={withFuelContext(FUEL_PATHS.cuadraturaMandante, ctxParams)}>Por mandante</Link>.
          </Callout>
          {unmapped && (unmapped.unmappedTaeLoads > 0 || unmapped.unmappedTctRecords > 0) ? (
            <Callout tone="warning" role="status" title="Hay litros sin equipo asociado">
              {unmapped.unmappedTaeLoads} {unmapped.unmappedTaeLoads === 1 ? "carga" : "cargas"} en terreno ({litersText(unmapped.unmappedTaeLiters)}) y {unmapped.unmappedTctRecords} {unmapped.unmappedTctRecords === 1 ? "total" : "totales"} de la tarjeta ({litersText(unmapped.unmappedTctLiters)}) no tienen equipo, así que no aparecen en la tabla.{" "}
              <Link className="font-medium underline underline-offset-4" href={fuelInboxHref({ tipo: "patente" })}>Vincularlos</Link>
            </Callout>
          ) : null}

          <SegmentedControl
            variant="pills"
            ariaLabel="Filtrar por dónde aparece el equipo"
            items={[
              { key: "todos", label: `Todos (${coverage.cardRows + coverage.fieldOnly})`, active: !coverageFilter, href: hrefWith(PATH, sp, { cobertura: null, pagina: null }) },
              ...(Object.keys(COVERAGE_FILTER_LABEL) as CoverageFilter[]).map((key) => ({
                key,
                label: `${COVERAGE_FILTER_LABEL[key]} (${counts[key]})`,
                active: coverageFilter === key,
                href: hrefWith(PATH, sp, { cobertura: key, pagina: null }),
              })),
            ]}
          />

          {visible.length === 0 ? (
            <EmptyState
              compact
              title="Ningún equipo coincide con estos filtros"
              description="Prueba con otra patente o quita el filtro de dónde aparece el equipo."
              action={<Button asChild variant="secondary" size="sm"><Link href={hrefWith(PATH, sp, { q: null, cobertura: null, pagina: null })}>Quitar filtros</Link></Button>}
            />
          ) : (
            <div>
              <CoverageTable rows={pageRows} />
              <ServerPagination pagination={pagination} hrefForPage={(page) => hrefWith(PATH, sp, { pagina: page > 1 ? String(page) : null })} />
            </div>
          )}
        </div>
      )}
    </PageContainer>
  )
}
