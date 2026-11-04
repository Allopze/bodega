import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  listPpa, countPpa, getPpaStats, getPpaMonthlySeries, getPpaDetentionByWorksite, listScopedWorksites, ppaWorksiteAccessQuery,
} from "@/lib/services/ppa"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { PPA_STOP_REASON_LABELS, tipoTrabajoLabel, type PpaStopReason } from "@/lib/ppa/types"
import { PpaMetricBar } from "./ppa-metric-bar"
import { PpaList } from "./ppa-list"
import { PpaAccessPanel } from "./ppa-access-panel"
import { PpaExportButton } from "./ppa-export-button"
import { scopeToIds } from "@/lib/ppa/utils"
import { shapePpaMonthly, shapeWorksiteRanking } from "@/lib/ppa/detention-rate"
import { windowStartDay } from "@/lib/prevention/monthly-series"
import { todayInChile } from "@/lib/utils"
import { PpaCountRankingSection, PpaTrendSection, PpaWorksiteRateSection } from "./ppa-charts-section"
import { buildPpaListFilters, readPpaListFilterState, readPpaListPage, type PpaListQuery } from "./list-filters"

export const metadata: Metadata = { title: "Para, Piensa y Actúa" }

const PAGE_SIZE = 20

export default async function PpaPanelPage({ searchParams }: { searchParams: Promise<PpaListQuery> }) {
  let session
  try { session = await requirePermission("ppa:view") }
  catch { redirect("/forbidden") }

  const query = await searchParams
  const initialFilterState = readPpaListFilterState(query)
  const page = readPpaListPage(query)
  const filters = buildPpaListFilters(initialFilterState)
  const worksiteIds = scopeToIds(resolveWorksiteScope(session))
  const today = todayInChile()
  const since = windowStartDay(today)
  const [rows, total, stats, worksiteOptions, monthlyRows, worksiteRows] = await Promise.all([
    listPpa({ worksiteIds, ...filters }, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    countPpa({ worksiteIds, ...filters }),
    getPpaStats(worksiteIds),
    listScopedWorksites(worksiteIds),
    // CHART-011: la serie mensual y la tasa por faena, agregadas en SQL sobre los
    // últimos 12 meses y con el alcance de la sesión.
    getPpaMonthlySeries(worksiteIds, { since }),
    getPpaDetentionByWorksite(worksiteIds, { since }),
  ])
  const monthlyPoints = shapePpaMonthly(monthlyRows, today)
  const worksiteRanking = shapeWorksiteRanking(worksiteRows)
  const canReview = can(session, "ppa:review")
  const canExport = can(session, "ppa:manage")

  return (
    <PageContainer>
      <PageHeader
        title="Para, Piensa y Actúa"
        description="PPA: evaluaciones preventivas, trabajos detenidos e indicadores."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Para, Piensa y Actúa" },
          ]} />
        }
        actions={
          <>
            {/*
              PPA-001: el enlace de cada faena se firma acá, en el servidor. El
              panel es un componente de cliente y no puede derivar el HMAC.
            */}
            <PpaAccessPanel worksites={worksiteOptions.map((worksite) => ({
              ...worksite,
              accessQuery: ppaWorksiteAccessQuery(worksite.id),
            }))} />
            <PpaExportButton worksites={worksiteOptions} canExport={canExport} />
          </>
        }
      />

      <div className="flex flex-col gap-8">
        <PpaMetricBar stats={stats} />

        <PpaTrendSection points={monthlyPoints} />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <PpaWorksiteRateSection ranking={worksiteRanking} />
          <PpaCountRankingSection
            title="Motivos de alerta más frecuentes"
            ariaLabel="Motivos de alerta más frecuentes"
            items={stats.topReasons.map((r) => ({
              key: r.reason,
              label: PPA_STOP_REASON_LABELS[r.reason as PpaStopReason] ?? r.reason,
              value: r.count,
            }))}
          />
        </div>

        <PpaList
          initialRows={rows}
          total={total}
          pageSize={PAGE_SIZE}
          initialFilterState={initialFilterState}
          initialPage={page}
          worksiteOptions={worksiteOptions}
          canReview={canReview}
          stats={stats}
        />

        <PpaCountRankingSection
          title="Tareas con más PPA"
          ariaLabel="Tareas con más PPA"
          items={stats.topTareas.map((t) => ({ key: t.tipoTrabajo, label: tipoTrabajoLabel(t.tipoTrabajo), value: t.count }))}
        />
      </div>
    </PageContainer>
  )
}
