import type { Session } from "next-auth"
import { BoardHeaderActions } from "@/components/dashboard/board-scope"
import { Callout } from "@/components/ui/callout"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PeriodControl } from "@/components/ui/period-control"
import { can } from "@/lib/auth/can"
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
import {
  loadFindingsWithoutWork,
  loadMaintenanceWork,
  loadPanelEquipment,
  loadScheduleCompliance,
  resolvePanelEquipment,
  summarizeMaintenanceWork,
} from "@/lib/services/mantencion/maintenance-work"
import { countPendingReview, loadPanelWorksites } from "@/lib/services/mantencion/panel"
import { loadReporteEquipos } from "@/lib/services/mantencion/reporte-equipos"
import { formatDate, todayInChile } from "@/lib/utils"
import { hasNoEquipmentInScope, PanelEmptyState } from "@/components/mantencion/jefatura/panel/panel-empty"
import { PanelEquipmentFilter } from "@/components/mantencion/jefatura/panel/panel-equipment-filter"
import { PanelExcelButton, PanelPdfLink } from "@/components/mantencion/jefatura/panel/panel-export"
import { PanelToday } from "@/components/mantencion/jefatura/panel/panel-today"
import { PanelTabs } from "@/components/mantencion/panel/looker/panel-tabs"
import { countUnassignedWorkOrders } from "@/lib/services/mantencion/work-orders/query"
import { PautasSection, WorkOrdersSection } from "./indicators-sections"
import { ReporteEquiposSection } from "./reporte-equipos-section"
import { FormsIndicatorsSection, MaintenanceWorkSection } from "./trinorma-sections"

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * El Panel operativo de siempre: la franja «Hoy» (lo pendiente ahora) y los gráficos del
 * período. Es la pestaña `hoy`, la que abre el Panel sin parámetros; las tres pestañas nuevas
 * (Planificación, Camiones, Máquinas) viven en `planificacion-tab.tsx` y `work-tab.tsx`.
 *
 * Se devuelve el árbol directamente (no un componente) para que las pruebas del Panel sigan
 * viendo las secciones que la página monta, sin un nivel extra que las oculte.
 */
export async function renderHoyTab(session: Session, params: SearchParams) {
  const viewer = viewerFromSession(session)
  const today = todayInChile()
  const period = resolveIndicatorPeriod({ desde: params.desde, hasta: params.hasta }, today)
  const worksites = await loadPanelWorksites(viewer)
  // Una faena fuera del alcance (o inventada en la URL) se ignora: se mira todo lo visible.
  const requested = first(params.faena)
  const worksite = requested ? worksites.find((item) => item.id === requested) : undefined
  const worksiteId = worksite?.id ?? null
  // El equipo de la URL vale sólo dentro del alcance (y de la faena elegida); uno ajeno o inventado se ignora.
  const equipment = await resolvePanelEquipment(viewer, worksiteId ?? undefined, first(params.equipo)).catch((error: unknown) => {
    logger.error("[indicadores-mantencion] equipo elegido falló", error)
    return null
  })
  const equipmentOptions = await loadPanelEquipment(viewer, worksiteId ?? undefined).catch((error: unknown) => {
    logger.error("[indicadores-mantencion] opciones de equipo fallaron", error)
    return []
  })

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
    ...(equipment ? { vehicleId: equipment.id } : {}),
  }
  // Con un equipo elegido el Panel muestra sólo lo que se mide por equipo: los registros firmados, el ranking,
  // lo de «Hoy» y los reportes de turno se miden por faena y no se acotan a un equipo.
  const byFleet = !equipment
  // Los trabajos se piden sobre la unión de la ventana del gráfico y el período (la ventana ya lo contiene).
  const workQuery = {
    from: period.chart.from < period.from ? period.chart.from : period.from,
    to: period.chart.to > period.to ? period.chart.to : period.to,
    today,
    ...(worksiteId ? { worksiteId } : {}),
    ...(equipment ? { vehicleId: equipment.id } : {}),
  }
  const periodQuery = { ...workQuery, from: period.from, to: period.to }

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

  const [series, stats, byStatus, ranking, pautas, records, outOfService, unassignedOrders, pendingReview, reporteEquipos, work, compliance, findings] = await Promise.all([
    canViewOrders ? track(loadWorkOrderSeries(viewer, query), "órdenes por período") : none<Awaited<ReturnType<typeof loadWorkOrderSeries>>>(),
    canViewOrders ? track(loadWorkOrderPeriodStats(viewer, query), "cifras de órdenes") : none<Awaited<ReturnType<typeof loadWorkOrderPeriodStats>>>(),
    canViewOrders ? track(loadOpenWorkOrdersByStatus(viewer, query.worksiteId, query.vehicleId), "órdenes abiertas por estado") : none<Awaited<ReturnType<typeof loadOpenWorkOrdersByStatus>>>(),
    canViewOrders && byFleet ? track(loadTopRepairEquipment(viewer, query), "equipos con más reparaciones") : none<Awaited<ReturnType<typeof loadTopRepairEquipment>>>(),
    track(loadPautaState(viewer, query.worksiteId, today, query.vehicleId), "estado de las pautas"),
    byFleet ? track(loadRecordIndicators(viewer, query), "registros preventivos y correctivos") : none<Awaited<ReturnType<typeof loadRecordIndicators>>>(),
    track(loadOutOfService(viewer, query), "días fuera de servicio"),
    canViewOrders && byFleet ? track(countUnassignedWorkOrders(viewer, query.worksiteId), "órdenes por asignar") : none<number>(),
    byFleet ? track(countPendingReview(viewer, query.worksiteId), "registros por revisar") : none<number>(),
    byFleet ? track(loadReporteEquipos(viewer, query), "reportes de equipos") : none<Awaited<ReturnType<typeof loadReporteEquipos>>>(),
    track(
      loadMaintenanceWork(viewer, workQuery).then((result) => ({
        summary: summarizeMaintenanceWork(result.rows, { from: period.from, to: period.to, chart: period.chart, today }),
        includesOrders: result.includesOrders,
      })),
      "trabajos de mantención",
    ),
    track(loadScheduleCompliance(viewer, periodQuery), "checklist de pautas de formularios"),
    track(loadFindingsWithoutWork(viewer, periodQuery), "hallazgos en mal estado sin trabajo"),
  ])

  // Sin equipos, sin registros, sin órdenes ni trabajos, hallazgos o reportes en el alcance: el Panel entero estaría vacío por una sola causa.
  const noEquipment = byFleet && hasNoEquipmentInScope({
    equipment: pautas?.total ?? null,
    inWorkshop: pautas?.inWorkshop ?? null,
    records: records ? records.points.reduce((sum, point) => sum + point.preventive + point.corrective, 0) : null,
    workOrders: series ? series.reduce((sum, point) => sum + point.created + point.closed + point.backlog, 0) : null,
    // Aunque no haya equipos activos, el alcance puede tener trabajos del historial, hallazgos o reportes de turno.
    work: work ? work.summary.total + work.summary.series.reduce((sum, point) => sum + point.preventiva + point.correctiva + point.predictiva + point.sin_clasificar, 0) : null,
    findings: findings ? findings.total + findings.unlinked : null,
    reports: reporteEquipos ? (reporteEquipos.hasRuns ? 1 : 0) : null,
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
    equipmentId: equipment?.id ?? null,
    scopeNote,
    canExport,
  }
  const trinorma = {
    ...common,
    equipment,
    baseParams: { desde: first(params.desde), hasta: first(params.hasta), faena: worksiteId ?? undefined, equipo: equipment?.id },
  }
  const exportScope = { periodo: indicatorPeriodLabel(period.requested, datesOf), faena: worksite?.name ?? (worksites.length === 1 ? worksites[0]!.name : allLabel), ...(equipment ? { equipo: equipment.label } : {}) }

  return (
    <PageContainer>
      <PageHeader
        title="Panel de mantención"
        description="Lo pendiente hoy y cómo avanzan las órdenes de trabajo, las pautas, la disponibilidad y los reportes de turno de los equipos."
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Panel" },
        ]} />}
        // Esqueleto común de los tableros: faena y período primero, después las exportaciones: «Exportar Excel»
        // (las tablas «Ver datos» de la pantalla, una hoja por gráfico, más la hoja «Trabajos») y «Exportar PDF»
        // (el informe del Panel), ambas con este período y esta faena.
        actions={
          <BoardHeaderActions
            worksites={worksites}
            worksiteId={worksiteId}
            allLabel={allLabel}
            period={<PeriodControl mode="range" from={period.requested.from} to={period.requested.to} defaultRange={{ ...defaultIndicatorRange(today), label: DEFAULT_RANGE_LABEL }} />}
          >
            {canExport ? (
              <>
                <PanelExcelButton title="Panel de mantención" range={{ from: period.from, to: period.to }} scope={exportScope} faena={worksiteId} equipo={equipment?.id ?? null} />
                <PanelPdfLink from={period.from} to={period.to} faena={worksiteId} equipo={equipment?.id ?? null} />
              </>
            ) : null}
          </BoardHeaderActions>
        }
      />

      {/* Sin este menú, desde «Hoy» no se llega a Planificación, Camiones ni Máquinas sin escribir la URL. */}
      <PanelTabs active="hoy" />

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
          <PanelEquipmentFilter options={equipmentOptions.map((item) => ({ id: item.id, label: item.label }))} value={equipment?.id ?? null} />
          {byFleet && (
            <PanelToday
              unassignedOrders={unassignedOrders}
              inWorkshop={pautas?.inWorkshop ?? null}
              inWorkshopByOrder={pautas?.inWorkshopByOrder ?? null}
              pendingReview={pendingReview}
              worksiteId={worksiteId}
            />
          )}
          {equipment && (
            <Callout tone="info" className="mb-4">
              Con {equipment.label} elegido, el Panel muestra sólo lo que se mide por equipo. Para ver los registros firmados, los reportes de turno y «Hoy», quita el equipo.
            </Callout>
          )}
          <div className="space-y-8">
            {canViewOrders && <WorkOrdersSection {...common} series={series} stats={stats} byStatus={byStatus} />}
            <MaintenanceWorkSection {...trinorma} summary={work?.summary ?? null} includesOrders={work?.includesOrders ?? canViewOrders} />
            {byFleet && <PautasSection {...common} pautas={pautas} records={records} outOfService={outOfService} ranking={ranking} showRanking={canViewOrders} />}
            <FormsIndicatorsSection {...trinorma} compliance={compliance} findings={findings} />
            {byFleet && <ReporteEquiposSection {...common} data={reporteEquipos} canViewInspections={can(session, "prevention:inspections:view")} />}
          </div>
        </>
      )}
    </PageContainer>
  )
}
