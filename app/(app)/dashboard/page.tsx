import type { Metadata } from "next"
import Link from "next/link"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { formatCLP, formatDate } from "@/lib/utils"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Plus } from "@phosphor-icons/react/dist/ssr"
import type { WorkTaskType } from "@/lib/work-queue"
import { getCriticalStockAlertCount } from "@/lib/services/stock-alerts"
import { getDashboardData } from "@/lib/services/dashboard"
import { getOperationalWorkQueue, type OperationalModule } from "@/lib/services/operational-work-queue"
import { listOperationalActivity } from "@/lib/services/operational-activity"
import { getOperationalPeriodMetrics, type OperationalPeriodMetric, type OperationalPeriodMetrics } from "@/lib/services/operational-period-metrics"
import { getOperationalBacklogComparisons, type OperationalBacklogComparison } from "@/lib/services/operational-metric-snapshots"
import { QuickActions } from "./quick-actions"
import { RecentActivity } from "./recent-activity"
import { loadPdtpComplianceSummary, PdtpComplianceCard } from "./pdtp-compliance-card"
import { getActivePdtpProgram, listPdtpPrograms } from "@/lib/services/prevention-pdtp"
import { scopeToWorksiteIds } from "./dashboard-helpers"
import { WorksiteActivityChart } from "./dashboard-charts"
import { listEppCoverageGaps } from "@/lib/services/prevention-epp"
import { getCanonicalSafetyIndicatorYear, getMaterialEnvironmentalEvents } from "@/lib/services/prevention-indicadores"
import {
  DashboardControlCenter,
  type DashboardAlert,
  type DashboardMetric,
  type DashboardTask,
  type OperationalPeriodSummaryEntry,
} from "./dashboard-control-center"

export const metadata: Metadata = { title: "Dashboard" }

const MODULE_TO_TASK_TYPE: Record<OperationalModule, WorkTaskType> = {
  solicitudes: "request_followup",
  aprobaciones: "approval",
  compras: "purchase",
  recepciones: "receipt",
  entregas: "warehouse_delivery",
  pdtp: "pdtp",
  capa: "capa",
  inspecciones: "inspection",
  documentacion: "documentation",
  ppa: "ppa",
  sst: "sst",
}

function toDashboardTask(item: Awaited<ReturnType<typeof getOperationalWorkQueue>>["items"][number]): DashboardTask {
  return {
    id: item.id,
    type: MODULE_TO_TASK_TYPE[item.module],
    title: item.title,
    subtitle: item.assignee ? `${item.subtitle} · ${item.assignee.name}` : item.subtitle,
    worksiteId: item.worksiteId,
    worksiteName: item.worksiteName,
    statusLabel: item.blocked ? `Bloqueada · ${item.statusLabel}` : item.statusLabel,
    priority: item.priority,
    createdAt: item.createdAt,
    href: item.href,
    ctaLabel: item.ctaLabel,
    operationalItem: item,
  }
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session) return null

  const worksiteScope = resolveWorksiteScope(session)
  const pdtpScope = scopeToWorksiteIds(worksiteScope)
  const canApprove = can(session, "approvals:approve")
  const canViewRequests = can(session, "requests:view_own") || can(session, "requests:view_all")
  const canViewPurchasing = can(session, "purchasing:view")
  const canReceive = can(session, "receiving:view")
  const canDeliver = can(session, "deliveries:create")
  const canViewStock = can(session, "warehouse:view_stock")
  const canViewEpp = can(session, "prevention:epp:view")
  const canViewPdtp = can(session, "prevention:pdtp:view")
  const canViewCapa = can(session, "prevention:capa:view")
  const canManagePdtp = can(session, "prevention:pdtp:program:manage")

  const [data, queue, activity, stockAlertCount, eppGapsCount, periodMetrics, backlogComparisons] = await Promise.all([
    getDashboardData(session),
    getOperationalWorkQueue(session, { limit: 25 }),
    listOperationalActivity(session, 6),
    canViewStock
      ? getCriticalStockAlertCount(pdtpScope)
      : Promise.resolve(0),
    canViewEpp
      ? listEppCoverageGaps({ userId: session.user.id, scope: worksiteScope, permissions: session.user.permissions })
          .then((gaps) => gaps.filter((gap) => gap.enforcement === "blocking").length)
      : Promise.resolve(0),
    getOperationalPeriodMetrics(session),
    getOperationalBacklogComparisons(session),
  ])
  const tasks = queue.items.map(toDashboardTask)
  const criticalTaskCount = queue.summary.critical
  const deliveryTaskCount = queue.summary.moduleCounts.entregas ?? 0
  const maxWorksiteCost = Math.max(...data.worksitesBreakdown.map((row) => row.totalCost), 1)

  const approvalRate = data.summary.totalRequests > 0
    ? Math.round((data.summary.approvedRequests / data.summary.totalRequests) * 100)
    : 0

  const firstName = session.user.name?.split(" ")[0] ?? "usuario"
  // Se serializa una vez desde el Server Component; el cliente no recalcula la
  // hora durante la hidratación.
  const refreshedAt = new Date().toISOString()

  const canViewIndicators = can(session, "prevention:indicadores:view")
  const currentYear = new Date().getFullYear()

  const [pdtpSummary, activeProgram, allPrograms, sstYearView, envEventsData] = await Promise.all([
    canViewPdtp
      ? loadPdtpComplianceSummary(pdtpScope)
      : Promise.resolve(null),
    canViewPdtp ? getActivePdtpProgram(currentYear) : Promise.resolve(null),
    canViewPdtp ? listPdtpPrograms() : Promise.resolve([]),
    canViewIndicators
      ? getCanonicalSafetyIndicatorYear(currentYear, worksiteScope).catch(() => null)
      : Promise.resolve(null),
    canViewIndicators
      ? getMaterialEnvironmentalEvents(currentYear, worksiteScope).catch(() => null)
      : Promise.resolve(null),
  ])
  const hasNextYearProgram = allPrograms.some((p) => p.year === currentYear + 1)
  const shouldSuggestNextYear = activeProgram && !hasNextYearProgram && canManagePdtp

  const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
  const sstPoints = sstYearView?.groups.find((g) => g.worksiteId === "total")?.monthly.map((m, i) => {
    return {
      month: MONTH_LABELS[i] ?? `M${i + 1}`,
      tasaFrecuencia: m.confirmed.frequencyRate ?? 0,
      tasaGravedad: m.confirmed.severityRate ?? 0,
      accConTiempoPerdido: m.confirmed.accidents ?? 0,
      accSinTiempoPerdido: m.provisional.accidents ?? 0,
    }
  }) || []

  const materialEnvPoints = envEventsData?.eventData.find((e) => e.worksiteId === "total")?.monthly.map((m) => ({
    month: MONTH_LABELS[m.month - 1] ?? `M${m.month}`,
    dangerousIncidents: m.dangerousIncidents,
    materialDamage: m.materialDamage,
    environmentalSpills: m.environmentalSpills,
  })) || []

  const metrics = buildOperationalMetrics({
    tasks: queue.total,
    criticalTasks: criticalTaskCount,
    pendingApprovals: data.metrics.pending_approvals,
    ordersPendingReceipt: data.metrics.orders_pending_receipt,
    deliveries: deliveryTaskCount,
    stockAlerts: stockAlertCount,
    totalCosts: data.summary.totalCosts,
    approvalRate,
    canApprove,
    canReceive,
    canDeliver,
    canViewStock,
    canViewPurchasing,
  })
  const alerts = buildOperationalAlerts({
    criticalTasks: criticalTaskCount,
    overdueTasks: queue.summary.overdue,
    blockedTasks: queue.summary.blocked,
    unassignedTasks: queue.summary.unassigned,
    pendingApprovals: data.metrics.pending_approvals,
    ordersPendingReceipt: data.metrics.orders_pending_receipt,
    deliveries: deliveryTaskCount,
    stockAlerts: stockAlertCount,
    eppGaps: eppGapsCount,
    canApprove,
    canReceive,
    canDeliver,
    canViewStock,
    canViewEpp,
  })
  const contextLabel = session.user.primaryWorksiteId
    ? data.worksitesBreakdown.find((worksite) => worksite.id === session.user.primaryWorksiteId)?.name ?? "Faena asignada"
    : worksiteScope.mode === "all"
      ? "Todas las faenas autorizadas"
      : "Faenas autorizadas"

  return (
    <PageContainer>
      <PageHeader title="Dashboard" actions={<QuickActions session={session} />} />
      <div className="animate-in fade-in duration-[var(--duration-default)]">
        <DashboardControlCenter
          firstName={firstName}
          contextLabel={contextLabel}
          refreshedAt={refreshedAt}
          tasks={tasks}
          queueSummary={{
            total: queue.total,
            critical: queue.summary.critical,
            overdue: queue.summary.overdue,
            deliveries: queue.summary.moduleCounts.entregas ?? 0,
          }}
          canAssign={session.user.permissions.includes("operations:assign_work")}
          periodSummary={buildOperationalPeriodSummary({ periodMetrics, canViewRequests, canViewPurchasing, canReceive, canDeliver })}
          backlogSummary={buildOperationalBacklogSummary({ backlogComparisons, canViewRequests, canViewPurchasing, canViewCapa, canViewPdtp })}
          metrics={metrics}
          alerts={alerts}
          periodMetrics={periodMetrics}
          sstPoints={sstPoints}
          materialEnvPoints={materialEnvPoints}
          mainSlot={
            <>
              <RecentActivity entries={activity} />

              {/* ── Actividad por faena (Gráfico + Tabla) ── */}
              {data.worksitesBreakdown.length > 0 && (
                <div className="space-y-6">
                  <WorksiteActivityChart worksites={data.worksitesBreakdown} />
                  <section className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-xs" aria-labelledby="actividad-por-faena">
                    <h2 id="actividad-por-faena" className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3 mb-4">Detalle por faena</h2>
                    <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white">
                      <table className="w-full border-collapse text-left text-[13px]" aria-label="Actividad y costos por faena">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            <th scope="col" className="px-5 py-3">Faena</th>
                            <th scope="col" className="px-5 py-3 text-right">Solicitudes</th>
                            <th scope="col" className="px-5 py-3 text-right">Pendientes</th>
                            <th scope="col" className="px-5 py-3 text-right">Aprobadas</th>
                            <th scope="col" className="px-5 py-3 text-right">Total OC</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.worksitesBreakdown.map((row) => (
                            <tr key={row.id} className="transition-colors hover:bg-slate-50/80">
                              <td className="px-5 py-3.5 font-semibold text-slate-800">{row.name}</td>
                              <td className="px-5 py-3.5 text-right font-mono tabular-nums text-slate-600">{row.requestsCount}</td>
                              <td className="px-5 py-3.5 text-right font-mono tabular-nums">
                                {row.pendingCount > 0
                                  ? <span className="font-semibold text-blue-600">{row.pendingCount}</span>
                                  : <span className="text-slate-400">0</span>}
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono tabular-nums text-slate-600">{row.approvedCount}</td>
                              <td className="px-5 py-3.5 text-right">
                                <div className="ml-auto flex max-w-[15rem] flex-col items-end gap-1.5">
                                  <span className="font-mono font-bold tabular-nums text-slate-900">{formatCLP(row.totalCost)}</span>
                                  <span className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
                                    <span
                                      className="block h-full rounded-full bg-blue-600"
                                      style={{ width: `${Math.max(4, Math.round((row.totalCost / maxWorksiteCost) * 100))}%` }}
                                    />
                                  </span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              )}
            </>
          }
          asideSlot={
            canViewPdtp ? (
              <section>
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                  <h2 className="text-h2 text-[var(--color-text)]">Programa de Trabajo Preventivo</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    {shouldSuggestNextYear && (
                      <Button asChild size="sm" variant="secondary">
                        <Link href="/prevencion/pdtp/nuevo"><Plus size={13} />Preparar {currentYear + 1}</Link>
                      </Button>
                    )}
                    {!activeProgram && allPrograms.length === 0 && canManagePdtp && (
                      <Button asChild size="sm"><Link href="/prevencion/pdtp/nuevo"><Plus size={13} />Crear programa</Link></Button>
                    )}
                  </div>
                </div>
                {pdtpSummary ? <PdtpComplianceCard {...pdtpSummary} /> : (
                  <EmptyState
                    compact
                    align="start"
                    title={`No hay un programa activo para ${currentYear}`}
                    description="Crea o activa un programa para visualizar avance preventivo desde este centro de control."
                    action={canManagePdtp ? <Button asChild size="sm"><Link href="/prevencion/pdtp/nuevo">Crear programa</Link></Button> : undefined}
                  />
                )}
              </section>
            ) : undefined
          }
        />
      </div>
    </PageContainer>
  )
}

function periodComparison(metric: OperationalPeriodMetric) {
  if (metric.previous === null) return "Sin período comparable"
  const difference = metric.current - metric.previous
  if (difference === 0) return "Sin variación vs. mes anterior"
  return `${difference > 0 ? "+" : ""}${difference} vs. mes anterior`
}

function buildOperationalPeriodSummary(input: {
  periodMetrics: OperationalPeriodMetrics
  canViewRequests: boolean
  canViewPurchasing: boolean
  canReceive: boolean
  canDeliver: boolean
}): OperationalPeriodSummaryEntry[] {
  const entries: Array<OperationalPeriodSummaryEntry | null> = [
    input.canViewRequests ? { key: "requests", label: "Solicitudes creadas", value: input.periodMetrics.requests.current, comparison: periodComparison(input.periodMetrics.requests), href: "/solicitudes" } : null,
    input.canViewPurchasing ? { key: "orders", label: "OC emitidas", value: input.periodMetrics.ordersIssued.current, comparison: periodComparison(input.periodMetrics.ordersIssued), href: "/compras" } : null,
    input.canReceive ? { key: "receipts", label: "Recepciones", value: input.periodMetrics.receipts.current, comparison: periodComparison(input.periodMetrics.receipts), href: "/recepcion" } : null,
    input.canDeliver ? { key: "deliveries", label: "Entregas", value: input.periodMetrics.deliveries.current, comparison: periodComparison(input.periodMetrics.deliveries), href: "/entregas" } : null,
    input.canViewPurchasing ? { key: "spend", label: "Inversión emitida", value: formatCLP(input.periodMetrics.spend.current), comparison: periodComparison(input.periodMetrics.spend), href: "/compras" } : null,
  ]
  return entries.filter((entry): entry is OperationalPeriodSummaryEntry => entry !== null)
}

function backlogComparison(comparison: OperationalBacklogComparison) {
  if (comparison.previous === null || !comparison.snapshotDate) return "Sin snapshot completo previo"
  const difference = comparison.current - comparison.previous
  if (difference === 0) return `Sin variación vs. ${formatDate(comparison.snapshotDate)}`
  return `${difference > 0 ? "+" : ""}${difference} vs. ${formatDate(comparison.snapshotDate)}`
}

function buildOperationalBacklogSummary(input: {
  backlogComparisons: OperationalBacklogComparison[]
  canViewRequests: boolean
  canViewPurchasing: boolean
  canViewCapa: boolean
  canViewPdtp: boolean
}): OperationalPeriodSummaryEntry[] {
  const byMetric = new Map(input.backlogComparisons.map((comparison) => [comparison.metric, comparison]))
  const entry = (metric: OperationalBacklogComparison["metric"], label: string, href: string): OperationalPeriodSummaryEntry | null => {
    const comparison = byMetric.get(metric)
    return comparison ? { key: metric, label, value: comparison.current, comparison: backlogComparison(comparison), href } : null
  }
  const entries: Array<OperationalPeriodSummaryEntry | null> = [
    input.canViewRequests ? entry("backlog_requests", "Solicitudes activas", "/pendientes?module=solicitudes") : null,
    input.canViewPurchasing ? entry("backlog_orders", "OC activas", "/pendientes?module=compras") : null,
    input.canViewCapa ? entry("backlog_capa", "CAPA abiertas", "/pendientes?module=capa") : null,
    input.canViewPdtp ? entry("backlog_pdtp", "Obligaciones PDTP", "/pendientes?module=pdtp") : null,
  ]
  return entries.filter((entry): entry is OperationalPeriodSummaryEntry => entry !== null)
}

function buildOperationalMetrics(input: {
  tasks: number
  criticalTasks: number
  pendingApprovals: number
  ordersPendingReceipt: number
  deliveries: number
  stockAlerts: number
  totalCosts: number
  approvalRate: number
  canApprove: boolean
  canReceive: boolean
  canDeliver: boolean
  canViewStock: boolean
  canViewPurchasing: boolean
}): DashboardMetric[] {
  const candidates: Array<DashboardMetric | null> = [
    { key: "tasks", label: "Tareas pendientes", value: input.tasks, description: "Acciones disponibles para tu rol", icon: "tasks", href: "/pendientes", tone: input.tasks > 0 ? "signal" : "neutral" },
    { key: "critical", label: "Tareas críticas", value: input.criticalTasks, description: input.criticalTasks > 0 ? "Requieren revisión prioritaria" : "Sin prioridad crítica", icon: "critical", href: "/pendientes?quick=critical", tone: input.criticalTasks > 0 ? "danger" : "neutral" },
    input.canApprove ? { key: "approvals", label: "Por aprobar", value: input.pendingApprovals, description: "Ítems esperando una decisión", icon: "approvals", href: "/pendientes?module=aprobaciones", tone: input.pendingApprovals > 0 ? "signal" : "neutral" } : null,
    input.canReceive ? { key: "receipts", label: "Por recibir", value: input.ordersPendingReceipt, description: "Órdenes con recepción pendiente", icon: "receipts", href: "/pendientes?module=recepciones", tone: input.ordersPendingReceipt > 0 ? "signal" : "neutral" } : null,
    input.canDeliver ? { key: "deliveries", label: "Entregas pendientes", value: input.deliveries, description: "Ítems listos para registrar entrega", icon: "deliveries", href: "/pendientes?module=entregas", tone: input.deliveries > 0 ? "signal" : "neutral" } : null,
    input.canViewStock ? { key: "stock", label: "Stock crítico", value: input.stockAlerts, description: "Productos bajo su mínimo definido", icon: "stock", href: "/bodega", tone: input.stockAlerts > 0 ? "danger" : "neutral" } : null,
    input.canViewPurchasing ? { key: "investment", label: "Inversión acumulada", value: formatCLP(input.totalCosts), description: "Órdenes vigentes fuera de borrador", icon: "investment" } : null,
    input.canApprove ? { key: "rate", label: "Tasa de aprobación", value: `${input.approvalRate}%`, description: "Solicitudes aprobadas en el alcance actual", icon: "rate" } : null,
  ]

  return candidates.filter((metric): metric is DashboardMetric => metric !== null).slice(0, 4)
}

function buildOperationalAlerts(input: {
  criticalTasks: number
  overdueTasks: number
  blockedTasks: number
  unassignedTasks: number
  pendingApprovals: number
  ordersPendingReceipt: number
  deliveries: number
  stockAlerts: number
  eppGaps: number
  canApprove: boolean
  canReceive: boolean
  canDeliver: boolean
  canViewStock: boolean
  canViewEpp: boolean
}): DashboardAlert[] {
  const alerts: Array<DashboardAlert | null> = [
    input.criticalTasks > 0 ? { key: "critical", title: "tareas críticas", description: "Hay acciones marcadas como críticas dentro de tu cola autorizada.", count: input.criticalTasks, severity: "critical", href: "/pendientes?quick=critical" } : null,
    input.overdueTasks > 0 ? { key: "overdue", title: "tareas vencidas", description: "Su fecha nativa o compromiso complementario ya venció.", count: input.overdueTasks, severity: "critical", href: "/pendientes?quick=overdue" } : null,
    input.blockedTasks > 0 ? { key: "blocked", title: "procesos bloqueados", description: "Requieren resolver una observación, detención o condición previa.", count: input.blockedTasks, severity: "warning", href: "/pendientes?quick=blocked" } : null,
    input.unassignedTasks > 0 ? { key: "unassigned", title: "tareas sin responsable", description: "No tienen una asignación complementaria ni un responsable nativo.", count: input.unassignedTasks, severity: "warning", href: "/pendientes?quick=unassigned" } : null,
    input.canViewStock && input.stockAlerts > 0 ? { key: "stock", title: "productos con stock crítico", description: "El nivel actual está por debajo del mínimo definido para la faena.", count: input.stockAlerts, severity: "critical", href: "/bodega" } : null,
    input.canApprove && input.pendingApprovals > 0 ? { key: "approvals", title: "ítems esperan aprobación", description: "Una decisión de aprobación desbloquea el siguiente paso de compra.", count: input.pendingApprovals, severity: "warning", href: "/pendientes?module=aprobaciones" } : null,
    input.canReceive && input.ordersPendingReceipt > 0 ? { key: "receipts", title: "órdenes pendientes de recepción", description: "Registra la llegada para que la operación pueda avanzar.", count: input.ordersPendingReceipt, severity: "warning", href: "/pendientes?module=recepciones" } : null,
    input.canDeliver && input.deliveries > 0 ? { key: "deliveries", title: "entregas por registrar", description: "Hay ítems disponibles para confirmar entrega a faena o trabajador.", count: input.deliveries, severity: "info", href: "/pendientes?module=entregas" } : null,
    input.canViewEpp && input.eppGaps > 0 ? { key: "epp", title: "brechas preventivas de EPP", description: "Existen brechas bloqueantes que requieren gestión preventiva.", count: input.eppGaps, severity: "warning", href: "/prevencion/epp-preventivo" } : null,
  ]

  return alerts.filter((alert): alert is DashboardAlert => alert !== null)
}
