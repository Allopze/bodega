import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { GasPump } from "@phosphor-icons/react/dist/ssr"
import { can, requirePermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { ExportButton } from "@/components/ui/export-button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
import { PERFORMANCE_FAMILY_LABELS, PERFORMANCE_UNIT_LABELS, familyFromSlug, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { parseControlFilters } from "@/lib/combustibles/control/filters"
import { hasAnyLoads } from "@/lib/combustibles/control/queries/overview"
import { DETAIL_PAGE_SIZE, getEquipmentStats, getReviewExclusions, getWorksiteStats } from "@/lib/combustibles/control/queries/performance"
import { getFamilyVehicleOptions, getLoadDetail, getSupplyMediumOptions } from "@/lib/combustibles/control/queries/performance-detail"
import { pickControlParams, revisionHref } from "@/lib/combustibles/control/view-helpers"
import { ControlFilters } from "../../_components/control-filters"
import { ControlNav } from "../../_components/control-nav"
import { loadControlContext } from "../../_components/control-context"
import { PerformanceDispersionChart } from "../../_charts/performance-charts-lazy"
import { SectionError, ViewSection } from "../../_charts/overview-section"
import { ReviewExclusionNote } from "../../_charts/performance-review-note"
import { exportEquipmentStatsAction, exportLoadDetailAction, exportWorksiteStatsAction } from "../export-actions"
import { FamilyFilters } from "./family-filters"
import { LoadDetailTable } from "./load-detail-table"
import { EquipmentStatsTable, WorksiteStatsTable } from "./stats-tables"

type PageProps = {
  params: Promise<{ familia: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Pick<PageProps, "params">): Promise<Metadata> {
  const family = familyFromSlug((await params).familia)
  return { title: family ? `Rendimiento · ${PERFORMANCE_FAMILY_LABELS[family]}` : "Rendimiento" }
}

const UNITS: PerformanceUnit[] = ["km_per_liter", "liters_per_hour"]

function pageHref(sp: Record<string, string | string[] | undefined>, key: string, page: number) {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(sp)) {
    const raw = Array.isArray(value) ? value[0] : value
    if (raw !== undefined && name !== key) params.set(name, raw)
  }
  if (page > 1) params.set(key, String(page))
  const query = params.toString()
  return query ? `?${query}` : "?"
}

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
    session = await requirePermission("combustibles:view", "/combustibles/control")
  } catch {
    redirect("/forbidden")
  }

  const sp = await searchParams
  const filters = parseControlFilters(sp, { family })
  const exportInput = { familia: slug, params: pickControlParams(sp) }
  const canExport = can(session, "combustibles:export")
  const canImport = can(session, "combustibles:import")
  const canViewPersonal = can(session, "combustibles:view_personal")
  const label = PERFORMANCE_FAMILY_LABELS[family]

  const failed: string[] = []
  const sources: string[] = []
  const track = <T,>(promise: Promise<T>, name: string): Promise<T | null> => {
    sources.push(name)
    return promise.catch((error: unknown) => {
      logger.error(`[combustibles/control/rendimiento] ${name} falló`, error)
      failed.push(name)
      return null
    })
  }

  const [ctx, worksiteStats, exclusions, equipment, detail, vehicles, media, anyLoads] = await Promise.all([
    loadControlContext(session),
    track(getWorksiteStats(session, filters), "worksite-stats"),
    track(getReviewExclusions(session, filters), "exclusions"),
    track(getEquipmentStats(session, filters, { page: filters.page }), "equipment-stats"),
    track(getLoadDetail(session, filters, { includePersonal: canViewPersonal, page: positivePage(sp.cargas) }), "load-detail"),
    track(getFamilyVehicleOptions(session, family), "vehicle-options"),
    track(getSupplyMediumOptions(), "medium-options"),
    track(hasAnyLoads(session), "any-loads"),
  ])

  const reviewHref = revisionHref(filters)
  const excludedTotal = exclusions ? exclusions.km_per_liter + exclusions.liters_per_hour : null
  const unitsInStats = UNITS.filter((unit) => worksiteStats?.some((row) => row.unit === unit))

  return (
    <PageContainer>
      <PageHeader
        title={`Rendimiento · ${label}`}
        description="Promedio y dispersión por faena y por equipo, comparados con su modelo y su histórico."
        breadcrumb={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control", href: "/combustibles/control" }, { label: label }]}
      />
      <DegradedDataBanner degraded={failed} total={sources.length} />
      <ControlNav items={ctx.navItems} />
      <ControlFilters years={ctx.years} defaultYear={ctx.defaultYear} worksites={ctx.worksites} mandantes={ctx.mandantes} extraKeys={["unidad", "medio", "equipo"]}>
        <FamilyFilters media={media ?? []} vehicles={vehicles ?? []} />
      </ControlFilters>

      {anyLoads === false ? (
        <EmptyState
          icon={<GasPump size={24} aria-hidden />}
          title="Todavía no hay cargas de equipos para analizar"
          description="Los rendimientos se calculan con las lecturas de odómetro y horómetro de las cargas. Importa la planilla de cargas por transacción para empezar."
          action={canImport ? <Button asChild><Link href="/combustibles/control/importar">Importar planilla de cargas</Link></Button> : undefined}
        />
      ) : (
        <>
          <ViewSection
            id="por-faena"
            title="Rendimiento por faena"
            question="¿Qué faenas rinden mejor y en cuáles el rendimiento es más irregular?"
            actions={canExport && worksiteStats ? <ExportButton action={exportWorksiteStatsAction} filters={exportInput} label="Exportar Excel" /> : undefined}
          >
            {worksiteStats ? (
              <div className="grid gap-6">
                {unitsInStats.length > 0 ? (
                  <div className={unitsInStats.length > 1 ? "grid gap-6 xl:grid-cols-2" : undefined}>
                    {unitsInStats.map((unit) => (
                      <div key={unit}>
                        <h3 className="mb-1 text-h3 text-[var(--color-text)]">Promedio y desviación en {PERFORMANCE_UNIT_LABELS[unit]}</h3>
                        <PerformanceDispersionChart
                          unit={unit}
                          points={worksiteStats.filter((row) => row.unit === unit).map((row) => ({ name: row.worksiteName, n: row.n, mean: row.mean, sd: row.sd }))}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
                <WorksiteStatsTable rows={worksiteStats} />
                {excludedTotal !== null ? <ReviewExclusionNote count={excludedTotal} href={reviewHref} className="-mt-3" /> : null}
              </div>
            ) : (
              <SectionError what="el rendimiento por faena" />
            )}
          </ViewSection>

          <ViewSection
            id="por-equipo"
            title="Rendimiento por equipo"
            question="¿Qué equipos rinden peor que su modelo o que su propio historial?"
            actions={canExport && equipment ? <ExportButton action={exportEquipmentStatsAction} filters={exportInput} label="Exportar Excel" /> : undefined}
          >
            {equipment ? (
              <div className="grid gap-3">
                <EquipmentStatsTable rows={equipment.rows} />
                <ServerPagination pagination={equipment.pagination} hrefForPage={(page) => pageHref(sp, "pagina", page)} className="border-t-0 px-0" />
                {excludedTotal !== null ? <ReviewExclusionNote count={excludedTotal} href={reviewHref} /> : null}
              </div>
            ) : (
              <SectionError what="el rendimiento por equipo" />
            )}
          </ViewSection>

          <ViewSection
            id="detalle"
            title="Detalle de cargas"
            question={`¿Qué cargas componen estos números? Solo cargas de ${label.toLowerCase()}, de a ${DETAIL_PAGE_SIZE}.`}
            actions={canExport && detail ? <ExportButton action={exportLoadDetailAction} filters={exportInput} label="Exportar Excel" /> : undefined}
          >
            {detail ? (
              <div className="grid gap-3">
                <LoadDetailTable rows={detail.rows} canViewPersonal={canViewPersonal} />
                <ServerPagination pagination={detail.pagination} hrefForPage={(page) => pageHref(sp, "cargas", page)} className="border-t-0 px-0" />
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
