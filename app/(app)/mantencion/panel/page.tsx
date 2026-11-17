import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { BoardExportButton } from "@/components/dashboard/board-export-button"
import { BoardHeaderActions } from "@/components/dashboard/board-scope"
import { Callout } from "@/components/ui/callout"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PeriodControl } from "@/components/ui/period-control"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { chartWindowCaption, DEFAULT_RANGE_LABEL, defaultIndicatorRange, indicatorPeriodLabel, resolveIndicatorPeriod } from "@/lib/indicators/period"
import { logger } from "@/lib/logger"
import { allWorksitesLabel } from "@/lib/auth/worksite-label"
import { equipmentScope, viewerFromSession } from "@/lib/services/mantencion/access"
import {
  loadOpenWorkOrdersByStatus,
  loadOutOfService,
  loadPautaState,
  loadRecordIndicators,
  loadTopRepairEquipment,
  loadWorkOrderPeriodStats,
  loadWorkOrderSeries,
  type MantIndicatorQuery,
} from "@/lib/services/mantencion/indicators"
import { countPendingReview, loadPanelWorksites } from "@/lib/services/mantencion/panel"
import { formatDate, todayInChile } from "@/lib/utils"
import { hasNoEquipmentInScope, PanelEmptyState } from "@/components/mantencion/jefatura/panel/panel-empty"
import { PanelToday } from "@/components/mantencion/jefatura/panel/panel-today"
import { countUnassignedWorkOrders } from "@/lib/services/mantencion/work-orders/query"
import { PautasSection, WorkOrdersSection } from "./indicators-sections"

export const metadata: Metadata = { title: "Panel de mantención" }
export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Panel de mantención: abre con la franja «Hoy» (lo pendiente ahora: órdenes sin mecánico,
 * equipos en taller, registros por revisar) y debajo los gráficos del período, que contestan
 * dos preguntas: ¿cómo avanza el trabajo de taller? (órdenes de trabajo) y ¿cómo están las
 * pautas y la disponibilidad de los equipos? Los Indicadores eran una página aparte hasta el
 * 2026-11-14; el usuario pidió que fueran el Panel (`/mantencion/indicadores` redirige acá).
 *
 * Gate: `mant:records:view_*`. «Órdenes de trabajo» sólo se consulta y se
 * pinta con `mant:ot:view_*`. Cada consulta degrada sola: si
 * una falla, su bloque no se pinta y el aviso de arriba lo dice, en vez de tumbar la página o
 * mostrar ceros que parecen datos.
 */
export default async function MantencionPanelPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all"])
  } catch {
    redirect("/forbidden")
  }
  const viewer = viewerFromSession(session)
  const params = await searchParams
  const today = todayInChile()
  const period = resolveIndicatorPeriod({ desde: params.desde, hasta: params.hasta }, today)
  const worksites = await loadPanelWorksites(viewer)
  // Una faena fuera del alcance (o inventada en la URL) se ignora: se mira todo lo visible.
  const requested = first(params.faena)
  const worksite = requested ? worksites.find((item) => item.id === requested) : undefined
  const worksiteId = worksite?.id ?? null

  const canViewOrders = can(session, "mant:ot:view_worksite") || can(session, "mant:ot:view_all")
  const canExport = can(session, "mant:export")

  const query: MantIndicatorQuery = {
    from: period.from,
    to: period.to,
    granularity: period.granularity,
    previous: period.previous,
    // Los gráficos de evolución miran los seis meses que terminan en el período cuando éste es corto.
    chart: period.chart,
    today,
    ...(worksiteId ? { worksiteId } : {}),
  }

  const degraded: string[] = []
  let tracked = 0
  function track<T>(promise: Promise<T>, label: string): Promise<T | null> {
    tracked++
    return promise.catch((error: unknown) => {
      logger.error(`[indicadores-mantencion] ${label} falló`, error)
      degraded.push(label)
      return null
    })
  }
  const none = <T,>(): Promise<T | null> => Promise.resolve(null)

  const [series, stats, byStatus, ranking, pautas, records, outOfService, unassignedOrders, pendingReview] = await Promise.all([
    canViewOrders ? track(loadWorkOrderSeries(viewer, query), "órdenes por período") : none<Awaited<ReturnType<typeof loadWorkOrderSeries>>>(),
    canViewOrders ? track(loadWorkOrderPeriodStats(viewer, query), "cifras de órdenes") : none<Awaited<ReturnType<typeof loadWorkOrderPeriodStats>>>(),
    canViewOrders ? track(loadOpenWorkOrdersByStatus(viewer, query.worksiteId), "órdenes abiertas por estado") : none<Awaited<ReturnType<typeof loadOpenWorkOrdersByStatus>>>(),
    canViewOrders ? track(loadTopRepairEquipment(viewer, query), "equipos con más reparaciones") : none<Awaited<ReturnType<typeof loadTopRepairEquipment>>>(),
    track(loadPautaState(viewer, query.worksiteId, today), "estado de las pautas"),
    track(loadRecordIndicators(viewer, query), "registros preventivos y correctivos"),
    track(loadOutOfService(viewer, query), "días fuera de servicio"),
    canViewOrders ? track(countUnassignedWorkOrders(viewer, query.worksiteId), "órdenes por asignar") : none<number>(),
    track(countPendingReview(viewer, query.worksiteId), "registros por revisar"),
  ])

  // Sin equipos, sin registros y sin órdenes en el alcance: el Panel entero estaría vacío por una sola causa.
  const noEquipment = hasNoEquipmentInScope({
    equipment: pautas?.total ?? null,
    inWorkshop: pautas?.inWorkshop ?? null,
    records: records ? records.points.reduce((sum, point) => sum + point.preventive + point.corrective, 0) : null,
    workOrders: series ? series.reduce((sum, point) => sum + point.created + point.closed + point.backlog, 0) : null,
  })

  // El alcance de los equipos de Mantención no es el de la sesión: `mant:records:view_all` abre todas.
  const allLabel = allWorksitesLabel(equipmentScope(viewer) === "all")
  const scopeName = worksite?.name ?? (worksites.length === 1 ? worksites[0]!.name : allLabel.toLowerCase())
  const datesOf = (range: { from: string; to: string }) => `${formatDate(range.from)} al ${formatDate(range.to)}`
  const scopeNote = `${datesOf(period)} · ${scopeName}`
  const common = {
    from: period.from,
    to: period.to,
    granularity: period.granularity,
    chart: period.chart,
    chartNote: `${chartWindowCaption(period.chart, datesOf)} · ${scopeName}`,
    worksiteId,
    scopeNote,
    canExport,
  }

  return (
    <PageContainer>
      <PageHeader
        title="Panel de mantención"
        description="Lo pendiente hoy y cómo avanzan las órdenes de trabajo, las pautas y la disponibilidad de los equipos."
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Panel" },
        ]} />}
        // Esqueleto común de los tableros: faena y período primero, después «Exportar Excel» (todas las
        // tablas «Ver datos» de la pantalla, una hoja por gráfico, con este período y esta faena).
        actions={
          <BoardHeaderActions
            worksites={worksites}
            worksiteId={worksiteId}
            allLabel={allLabel}
            period={<PeriodControl mode="range" from={period.requested.from} to={period.requested.to} defaultRange={{ ...defaultIndicatorRange(today), label: DEFAULT_RANGE_LABEL }} />}
          >
            {canExport ? (
              <BoardExportButton title="Panel de mantención" range={{ from: period.from, to: period.to }} scope={{ periodo: indicatorPeriodLabel(period.requested, datesOf), faena: worksite?.name ?? (worksites.length === 1 ? worksites[0]!.name : allLabel) }} />
            ) : null}
          </BoardHeaderActions>
        }
      />

      {period.invalid && (
        <Callout tone="warning" className="mb-4">El rango de fechas de la dirección no es válido: se muestra {DEFAULT_RANGE_LABEL}.</Callout>
      )}
      <DegradedDataBanner degraded={degraded} total={tracked} />

      {noEquipment ? (
        // Sin equipos ni registros en el alcance hay una sola causa y un solo aviso con su salida,
        // en vez de una franja en cero y secciones vacías. Otra faena del selector puede tener equipos.
        <PanelEmptyState canManage={can(session, "mant:equipment:manage")} />
      ) : (
        <>
          <PanelToday
            unassignedOrders={unassignedOrders}
            inWorkshop={pautas?.inWorkshop ?? null}
            inWorkshopByOrder={pautas?.inWorkshopByOrder ?? null}
            pendingReview={pendingReview}
            worksiteId={worksiteId}
          />
          <div className="space-y-8">
            {canViewOrders && <WorkOrdersSection {...common} series={series} stats={stats} byStatus={byStatus} />}
            <PautasSection {...common} pautas={pautas} records={records} outOfService={outOfService} ranking={ranking} showRanking={canViewOrders} />
          </div>
        </>
      )}
    </PageContainer>
  )
}
