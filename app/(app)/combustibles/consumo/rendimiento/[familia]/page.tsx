import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { GasPump } from "@phosphor-icons/react/dist/ssr"
import { can, requirePermission } from "@/lib/auth/can"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { ExportButton } from "@/components/ui/export-button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { PERFORMANCE_FAMILY_LABELS, PERFORMANCE_UNIT_LABELS, familyFromSlug, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { hasAnyLoads } from "@/lib/combustibles/control/queries/overview"
import { controlFiltersFromPeriod, exportParamsFromFilters } from "@/lib/combustibles/control/queries/period-filters"
import { DETAIL_PAGE_SIZE, getEquipmentStats, getEquipmentWorseSummary, getReviewExclusions, getWorksiteStats } from "@/lib/combustibles/control/queries/performance"
import { getFamilyVehicleOptions, getLoadDetail, getSupplyMediumOptions } from "@/lib/combustibles/control/queries/performance-detail"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS, fuelEquipmentHref, fuelInboxHref } from "@/lib/combustibles/routes"
import { fuelAddDataOptions } from "@/lib/combustibles/section-nav"
import { formatQty } from "@/lib/utils"
import { ConsumoNav } from "../../../consumo-nav"
import { PerformanceDispersionChart } from "../../_components/charts/performance-charts-lazy"
import { SectionError, ViewSection } from "../../_components/charts/overview-section"
import { ReviewExclusionNote } from "../../_components/charts/performance-review-note"
import { loadControlContext } from "../../_components/control-context"
import { hrefInContext, fuelContextParams, searchWith } from "../../_components/page-links"
import { createSourceTracker } from "../../_components/track-sources"
import { Disclosure } from "../../_components/disclosure"
import { exportEquipmentStatsAction, exportLoadDetailAction, exportWorksiteStatsAction } from "../export-actions"
import { FamilyFilters } from "./family-filters"
import { FamilySwitch } from "./family-switch"
import { LoadDetailTable } from "./load-detail-table"
import { EquipmentStatisticsTable, EquipmentStatsTable, WorksiteStatsTable } from "./stats-tables"
import { WorksiteRanking } from "./worksite-ranking"

type PageProps = {
  params: Promise<{ familia: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Pick<PageProps, "params">): Promise<Metadata> {
  const family = familyFromSlug((await params).familia)
  return { title: family ? `Rendimiento · ${PERFORMANCE_FAMILY_LABELS[family]}` : "Rendimiento" }
}

const UNITS: PerformanceUnit[] = ["km_per_liter", "liters_per_hour"]

function positivePage(value: string | string[] | undefined) {
  const parsed = Number.parseInt(String(Array.isArray(value) ? value[0] : value ?? ""), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export default async function FamilyPerformancePage({ params, searchParams }: PageProps) {
  const slug = (await params).familia
  const family = familyFromSlug(slug)
  if (!family) notFound()

  let session
  try {
    session = await requirePermission("combustibles:view", FUEL_PATHS.consumo)
  } catch {
    redirect("/forbidden")
  }

  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const filters = controlFiltersFromPeriod(period, sp, { family })
  const exportInput = { familia: slug, params: exportParamsFromFilters(filters) }
  const canExport = can(session, "combustibles:export")
  const canViewPersonal = can(session, "combustibles:view_personal")
  const label = PERFORMANCE_FAMILY_LABELS[family]

  const { track, degraded, total } = createSourceTracker("combustibles/consumo/rendimiento")
  const [ctx, worksiteStats, exclusions, equipment, worse, detail, vehicles, media, anyLoads] = await Promise.all([
    loadControlContext(session, { years: false }),
    track(getWorksiteStats(session, filters), [], "rendimiento por faena"),
    track(getReviewExclusions(session, filters), null, "cargas por decidir"),
    track(getEquipmentStats(session, filters, { page: filters.page }), null, "rendimiento por equipo"),
    track(getEquipmentWorseSummary(session, filters, 0), null, "equipos que rinden peor"),
    track(getLoadDetail(session, filters, { includePersonal: canViewPersonal, page: positivePage(sp.cargas) }), null, "detalle de cargas"),
    track(getFamilyVehicleOptions(session, family), [], "equipos de la familia"),
    track(getSupplyMediumOptions(), [], "medios de suministro"),
    track(hasAnyLoads(session), true, "cargas en el alcance"),
  ])

  const excludedTotal = exclusions.data ? exclusions.data.km_per_liter + exclusions.data.liters_per_hour : null
  const reviewHref = hrefInContext(fuelInboxHref({ tipo: "carga", faena: filters.worksiteId }), period)
  const unitsInStats = UNITS.filter((unit) => worksiteStats.data.some((row) => row.unit === unit))
  const contextForFamily = { ...sp, ...fuelContextParams(period, { faena: filters.worksiteId }) }
  const equipmentHref = (vehicleId: string) => hrefInContext(fuelEquipmentHref(vehicleId), period)
  const worksiteHref = (worksiteId: string) => searchWith(sp, { faena: worksiteId, pagina: null, cargas: null })
  const pageLink = (key: string) => (page: number) => searchWith(sp, { [key]: page > 1 ? String(page) : null })

  // A4: sin datos, qué significa + qué hacer + una acción real.
  const addPlanilla = fuelAddDataOptions(session).find((option) => option.kind === "planilla")
  const emptyAction = addPlanilla?.allowed
    ? <Button asChild><Link href={addPlanilla.href}>Agregar planilla de cargas</Link></Button>
    : can(session, "combustibles:register_load")
      ? <Button asChild><Link href={FUEL_PATHS.registrar}>Registrar una carga</Link></Button>
      : undefined

  return (
    <PageContainer>
      <PageHeader
        title="Rendimiento"
        description="Cuánto rinde cada equipo contra su modelo y contra su propio historial"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Consumo", href: FUEL_PATHS.consumo }, { label: "Rendimiento" }]} />}
        actions={<FuelHeaderActions period={period} />}
      />
      <DegradedDataBanner degraded={degraded} total={total()} />
      <ConsumoNav activeKey="rendimiento" />
      <FamilySwitch active={family} searchParams={contextForFamily} />
      <FamilyFilters worksites={ctx.worksites} mandantes={ctx.mandantes} media={media.data} vehicles={vehicles.data} />

      {anyLoads.data === false ? (
        <EmptyState
          icon={<GasPump size={24} aria-hidden />}
          title="Todavía no hay cargas de equipos para analizar"
          description="Los rendimientos se calculan con las lecturas de odómetro y horómetro de cada carga. Agrega la planilla de cargas o registra cargas en terreno para empezar."
          action={emptyAction}
        />
      ) : (
        <>
          <WorseAnswer
            summary={worse.data}
            failed={worse.failed}
            units={unitsInStats}
            label={label}
          />
          {excludedTotal !== null ? <ReviewExclusionNote count={excludedTotal} href={reviewHref} className="mb-6" /> : null}

          <ViewSection
            id="por-equipo"
            title="Por equipo"
            question="¿Qué equipos rinden peor que su modelo o que su propio historial? El código abre la ficha del equipo."
            actions={canExport && equipment.data ? <ExportButton action={exportEquipmentStatsAction} filters={exportInput} label="Exportar Excel" /> : undefined}
          >
            {equipment.data ? (
              <div className="grid gap-3">
                <EquipmentStatsTable rows={equipment.data.rows} equipmentHref={equipmentHref} />
                <ServerPagination pagination={equipment.data.pagination} hrefForPage={pageLink("pagina")} className="border-t-0 px-0" />
              </div>
            ) : (
              <SectionError what="el rendimiento por equipo" />
            )}
          </ViewSection>

          <ViewSection
            id="por-faena"
            title="Por faena"
            question="¿Qué faenas rinden mejor y en cuáles el rendimiento es más irregular? Un clic filtra esa faena."
            actions={canExport && !worksiteStats.failed ? <ExportButton action={exportWorksiteStatsAction} filters={exportInput} label="Exportar Excel" /> : undefined}
          >
            {worksiteStats.failed ? <SectionError what="el rendimiento por faena" /> : <WorksiteRanking rows={worksiteStats.data} hrefForWorksite={worksiteHref} />}
          </ViewSection>

          {!worksiteStats.failed || equipment.data ? (
            <div className="mb-10">
              <Disclosure
                title="Ver datos estadísticos"
                description="Promedio, desviación estándar y variación de cada faena y de cada equipo, con sus cargas válidas."
              >
                <div className="grid gap-8">
                  {unitsInStats.length > 0 ? (
                    <div className={unitsInStats.length > 1 ? "grid gap-6 xl:grid-cols-2" : undefined}>
                      {unitsInStats.map((unit) => (
                        <div key={unit}>
                          <h3 className="mb-1 text-h3 text-[var(--color-text)]">Promedio y desviación en {PERFORMANCE_UNIT_LABELS[unit]}</h3>
                          <PerformanceDispersionChart
                            unit={unit}
                            points={worksiteStats.data.filter((row) => row.unit === unit).map((row) => ({ name: row.worksiteName, n: row.n, mean: row.mean, sd: row.sd }))}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div>
                    <h3 className="mb-2 text-h3 text-[var(--color-text)]">Por faena</h3>
                    {worksiteStats.failed ? <SectionError what="las cifras por faena" /> : <WorksiteStatsTable rows={worksiteStats.data} />}
                  </div>
                  {equipment.data ? (
                    <div>
                      <h3 className="mb-2 text-h3 text-[var(--color-text)]">Por equipo <span className="text-sm font-normal text-[var(--color-text-muted)]">· los de esta página</span></h3>
                      <EquipmentStatisticsTable rows={equipment.data.rows} />
                    </div>
                  ) : null}
                </div>
              </Disclosure>
            </div>
          ) : null}

          <ViewSection
            id="detalle"
            title="Cargas que forman estas cifras"
            question={`¿Qué cargas componen estos números? Sólo cargas de ${label.toLowerCase()}, de a ${DETAIL_PAGE_SIZE}. La fecha abre la ficha de la carga.`}
            actions={canExport && detail.data ? <ExportButton action={exportLoadDetailAction} filters={exportInput} label="Exportar Excel" /> : undefined}
          >
            {detail.data ? (
              <div className="grid gap-3">
                <LoadDetailTable rows={detail.data.rows} canViewPersonal={canViewPersonal} />
                <ServerPagination pagination={detail.data.pagination} hrefForPage={pageLink("cargas")} className="border-t-0 px-0" />
              </div>
            ) : (
              <SectionError what="el detalle de cargas" />
            )}
          </ViewSection>
        </>
      )}
    </PageContainer>
  )
}

/** La respuesta de la pantalla en una frase: cuántos equipos rinden peor, y en qué unidad se mide. */
function WorseAnswer({
  summary,
  failed,
  units,
  label,
}: {
  summary: Awaited<ReturnType<typeof getEquipmentWorseSummary>> | null
  failed: boolean
  units: PerformanceUnit[]
  label: string
}) {
  if (failed || !summary) return null
  const measure = units.length === 0
    ? null
    : units.map((unit) => `${PERFORMANCE_UNIT_LABELS[unit]}: ${unit === "km_per_liter" ? "más es mejor" : "menos es mejor"}`).join(" · ")
  if (summary.total === 0) {
    return (
      <p className="mb-4 max-w-[78ch] text-base text-[var(--color-text)]">
        Ningún equipo de {label.toLowerCase()} tiene cargas con rendimiento calculado con estos filtros.
      </p>
    )
  }
  return (
    <p className="mb-4 max-w-[78ch] text-base text-[var(--color-text)]">
      {summary.worse > 0 ? (
        <>
          <strong className="font-semibold tabular-nums">{formatQty(summary.worse)} de {formatQty(summary.total)}</strong>{" "}
          {summary.total === 1 ? "equipo" : "equipos"} {summary.worse === 1 ? "rinde" : "rinden"} más de 10 % peor que su modelo o que su propio historial.
        </>
      ) : (
        <>Ningún equipo rinde más de 10 % peor que su modelo ni que su propio historial.</>
      )}
      {measure ? <span className="text-[var(--color-text-muted)]"> Se mide en {measure}.</span> : null}
    </p>
  )
}
