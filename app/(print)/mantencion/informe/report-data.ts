import type { Session } from "next-auth"
import { can } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { allWorksitesLabel } from "@/lib/auth/worksite-label"
import { chartWindowCaption, indicatorPeriodLabel, resolveIndicatorPeriod, type IndicatorPeriod } from "@/lib/indicators/period"
import { equipmentScope, viewerFromSession } from "@/lib/services/mantencion/access"
import {
  loadOpenWorkOrdersByStatus,
  loadOutOfService,
  loadPautaState,
  loadWorkOrderPeriodStats,
  type MantIndicatorQuery,
  type OutOfServiceIndicators,
  type PautaState,
  type WorkOrderPeriodStats,
} from "@/lib/services/mantencion/indicators"
import {
  loadFindingsWithoutWork,
  loadMaintenanceWork,
  loadScheduleCompliance,
  resolvePanelEquipment,
  summarizeMaintenanceWork,
  type FindingsWithoutWork,
  type MaintenanceWorkSummary,
  type PanelEquipment,
  type ScheduleComplianceStats,
} from "@/lib/services/mantencion/maintenance-work"
import { loadPanelWorksites } from "@/lib/services/mantencion/panel"
import type { OtStatus } from "@/lib/mantencion/work-order-states"
import { formatDate, todayInChile } from "@/lib/utils"

/**
 * Datos del informe PDF del Panel de mantención: los mismos cargadores que el Panel, con el mismo alcance,
 * faena y período, ensamblados para una hoja impresa. Cada consulta degrada sola: si falla, su bloque dice
 * «No disponible» en el documento en vez de imprimir un cero.
 */

export const REPORT_PERMISSION = "mant:export"
export type ReportSearchParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export interface PanelReportData {
  today: string
  issuedOn: string
  period: IndicatorPeriod
  periodLabel: string
  worksiteName: string
  worksiteId: string | null
  equipment: PanelEquipment | null
  work: { summary: MaintenanceWorkSummary; includesOrders: boolean } | null
  pautas: PautaState | null
  compliance: ScheduleComplianceStats | null
  findings: FindingsWithoutWork | null
  outOfService: OutOfServiceIndicators | null
  orderStats: WorkOrderPeriodStats | null
  openOrders: Array<{ status: OtStatus; count: number }> | null
  canViewOrders: boolean
  chartCaption: string
  degraded: string[]
  /** Nombre de archivo sugerido (sin extensión). */
  filenameBase: string
}

function slug(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "todas"
}

export async function loadPanelReport(session: Session, params: ReportSearchParams): Promise<PanelReportData> {
  const viewer = viewerFromSession(session)
  const today = todayInChile()
  const period = resolveIndicatorPeriod({ desde: params.desde, hasta: params.hasta }, today)
  const worksites = await loadPanelWorksites(viewer)
  const requested = first(params.faena)
  const worksite = requested ? worksites.find((item) => item.id === requested) : undefined
  const worksiteId = worksite?.id ?? null
  const equipment = await resolvePanelEquipment(viewer, worksiteId ?? undefined, first(params.equipo))
  const canViewOrders = can(session, "mant:ot:view_worksite") || can(session, "mant:ot:view_all")

  const query: MantIndicatorQuery = {
    from: period.from,
    to: period.to,
    granularity: period.granularity,
    previous: period.previous,
    chart: period.chart,
    today,
    ...(worksiteId ? { worksiteId } : {}),
    ...(equipment ? { vehicleId: equipment.id } : {}),
  }
  const degraded: string[] = []
  const track = <T,>(promise: Promise<T>, label: string): Promise<T | null> =>
    promise.catch((error: unknown) => {
      logger.error(`[informe-mantencion] ${label} falló`, error)
      degraded.push(label)
      return null
    })
  // Los trabajos se piden sobre la unión de la ventana del gráfico y el período (la ventana ya lo contiene).
  const workRange = { from: period.chart.from < period.from ? period.chart.from : period.from, to: period.chart.to > period.to ? period.chart.to : period.to }
  const base = { from: period.from, to: period.to, today, ...(worksiteId ? { worksiteId } : {}), ...(equipment ? { vehicleId: equipment.id } : {}) }

  const [work, pautas, compliance, findings, outOfService, orderStats, openOrders] = await Promise.all([
    track(loadMaintenanceWork(viewer, { ...base, ...workRange }).then((result) => ({
      summary: summarizeMaintenanceWork(result.rows, { from: period.from, to: period.to, chart: period.chart, today }),
      includesOrders: result.includesOrders,
    })), "trabajos de mantención"),
    track(loadPautaState(viewer, worksiteId ?? undefined, today, equipment?.id), "estado de las pautas"),
    track(loadScheduleCompliance(viewer, base), "checklist de pautas de formularios"),
    track(loadFindingsWithoutWork(viewer, base), "hallazgos sin trabajo"),
    track(loadOutOfService(viewer, query), "días fuera de servicio"),
    canViewOrders ? track(loadWorkOrderPeriodStats(viewer, query), "cifras de órdenes") : Promise.resolve(null),
    canViewOrders ? track(loadOpenWorkOrdersByStatus(viewer, worksiteId ?? undefined, equipment?.id), "órdenes abiertas") : Promise.resolve(null),
  ])

  const datesOf = (range: { from: string; to: string }) => `${formatDate(range.from)} al ${formatDate(range.to)}`
  const allLabel = allWorksitesLabel(equipmentScope(viewer) === "all")
  const worksiteName = worksite?.name ?? (worksites.length === 1 ? worksites[0]!.name : allLabel)
  const periodLabel = indicatorPeriodLabel(period.requested, datesOf)
  return {
    today,
    issuedOn: formatDate(today),
    period,
    periodLabel,
    worksiteName,
    worksiteId,
    equipment,
    work,
    pautas,
    compliance,
    findings,
    outOfService,
    orderStats,
    openOrders,
    canViewOrders,
    chartCaption: chartWindowCaption(period.chart, datesOf),
    degraded,
    filenameBase: `panel-mantencion-${slug(worksiteName)}${equipment ? `-${slug(equipment.label)}` : ""}-${period.from}_${period.to}`,
  }
}
