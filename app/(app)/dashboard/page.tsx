import type { Metadata } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { chileDateParts, formatCLP, formatDate } from "@/lib/utils"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Plus } from "@phosphor-icons/react/dist/ssr"
import { OPERATIONAL_MODULE_LABELS, type WorkTaskType } from "@/lib/work-queue"
import { getCriticalStockAlertCount } from "@/lib/services/stock-alerts"
import { getDashboardData } from "@/lib/services/dashboard"
import { getOperationalWorkQueue, type OperationalModule } from "@/lib/services/operational-work-queue"
import { listOperationalActivity } from "@/lib/services/operational-activity"
import { getOperationalPeriodMetrics, type OperationalPeriodMetric, type OperationalPeriodMetrics } from "@/lib/services/operational-period-metrics"
import { getOperationalBacklogComparisons, getOperationalSnapshotHistory, type OperationalBacklogComparison, type OperationalSnapshotMetric } from "@/lib/services/operational-metric-snapshots"
import { QuickActions } from "./quick-actions"
import { RecentActivity } from "./recent-activity"
import { loadPdtpComplianceSummary, PdtpComplianceCard } from "./pdtp-compliance-card"
import { getActivePdtpProgram, listPdtpPrograms } from "@/lib/services/prevention-pdtp"
import { scopeToWorksiteIds } from "./dashboard-helpers"
import { DashboardAnalytics, DashboardAnalyticsFallback } from "./dashboard-analytics"
import { listEppCoverageGaps } from "@/lib/services/prevention-epp"
import {
  DashboardControlCenter,
  type DashboardAlert,
  type DashboardMetric,
  type DashboardTask,
  type OperationalPeriodSummaryEntry,
  type QueueShortcut,
} from "./dashboard-control-center"

export const metadata: Metadata = { title: "Dashboard" }

/**
 * Tope de filas que baja a la cola del dashboard; el resto vive en /pendientes.
 *
 * 12 y no 50: con 50 la cola ocupaba tres pantallas de alto y dejaba la columna
 * lateral vacía a partir de la fila ~10 (lo destapó la pasada visual). Es un
 * top-N para decidir qué hacer ahora, no un sustituto de la cola completa —
 * el pie y el atajo "Todas" declaran el total.
 */
const QUEUE_PREVIEW_LIMIT = 12

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

  const canViewIndicators = can(session, "prevention:indicadores:view")
  // Hora de Chile: el proceso corre en UTC y el 31 de diciembre por la tarde
  // este año saltaba al siguiente, consultando PDTP/SST del año equivocado.
  const currentYear = chileDateParts().year

  // Un solo lote: el bloque de prevención no depende del operacional, y
  // encadenarlos duplicaba la latencia de red de la página (P-01).
  const [
    data, queue, activity, stockAlertCount, eppGapsCount, periodMetrics, backlogComparisons, snapshotHistory,
    pdtpSummary, activeProgram, allPrograms,
  ] = await Promise.all([
    getDashboardData(session),
    getOperationalWorkQueue(session, { limit: QUEUE_PREVIEW_LIMIT }),
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
    getOperationalSnapshotHistory(session, 30),
    canViewPdtp
      ? loadPdtpComplianceSummary(pdtpScope)
      : Promise.resolve(null),
    canViewPdtp ? getActivePdtpProgram(currentYear) : Promise.resolve(null),
    canViewPdtp ? listPdtpPrograms() : Promise.resolve([]),
  ])
  const tasks = queue.items.map(toDashboardTask)
  const criticalTaskCount = queue.summary.critical
  const deliveryTaskCount = queue.summary.moduleCounts.entregas ?? 0

  const firstName = session.user.name?.split(" ")[0] ?? "usuario"
  // Se serializa una vez desde el Server Component; el cliente no recalcula la
  // hora durante la hidratación.
  const refreshedAt = new Date().toISOString()

  const hasNextYearProgram = allPrograms.some((p) => p.year === currentYear + 1)
  const shouldSuggestNextYear = activeProgram && !hasNextYearProgram && canManagePdtp

  const metrics = buildOperationalMetrics({
    tasks: queue.total,
    criticalTasks: criticalTaskCount,
    overdueTasks: queue.summary.overdue,
    pendingApprovals: data.metrics.pending_approvals,
    ordersPendingReceipt: data.metrics.orders_pending_receipt,
    deliveries: deliveryTaskCount,
    stockAlerts: stockAlertCount,
    stockTrend: snapshotHistory.stock_alerts,
    monthSpend: periodMetrics.spend.current,
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

  // Población completa, no las filas cargadas en la cola (D-02).
  const moduleWorkload = Object.entries(queue.summary.moduleCounts)
    .map(([module, count]) => ({ module: OPERATIONAL_MODULE_LABELS[module as OperationalModule] ?? module, count: count ?? 0 }))
    .filter((entry) => entry.count > 0)
  return (
    <PageContainer>
      <PageHeader title="Dashboard" actions={<QuickActions session={session} />} />
      <div className="animate-in fade-in duration-[var(--duration-default)]">

        {/* ── Control Center: KPIs + Cola de trabajo + Aside (prioridad de carga) ── */}
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
          queueShortcuts={buildQueueShortcuts({ queue, canApprove, canReceive, canDeliver })}
          worksiteOptions={queue.filterOptions.worksites}
          canAssign={session.user.permissions.includes("operations:assign_work")}
          periodSummary={buildOperationalPeriodSummary({ periodMetrics, canViewRequests, canViewPurchasing, canReceive, canDeliver })}
          backlogSummary={buildOperationalBacklogSummary({ backlogComparisons, snapshotHistory, canViewRequests, canViewPurchasing, canViewCapa, canViewPdtp })}
          metrics={metrics}
          alerts={alerts}
          mainSlot={
            <>
              <RecentActivity entries={activity} />
            </>
          }
          asideSlot={
            canViewPdtp ? (
              <section>
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                  {/* Misma escala que "Requiere atención" y "Flujo del mes": son hermanos en el aside (L-05). */}
                  <h2 className="text-h3 text-[var(--color-text)]">Programa de Trabajo Preventivo</h2>
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

        {/* ── Analítica y tendencias: sus consultas no bloquean al Centro de Control ── */}
        <Suspense fallback={<DashboardAnalyticsFallback />}>
          <DashboardAnalytics
            session={session}
            worksiteScope={worksiteScope}
            currentYear={currentYear}
            canViewIndicators={canViewIndicators}
            moduleWorkload={moduleWorkload}
            queueTotal={queue.total}
            worksitesBreakdown={data.worksitesBreakdown}
          />
        </Suspense>
      </div>
    </PageContainer>
  )
}

/**
 * Atajos de la cola. Los conteos salen de `queue.summary` — población completa
 * autorizada — y cada uno navega a `/pendientes` con el filtro equivalente.
 *
 * Antes eran chips que filtraban en cliente las 25 filas cargadas: mostraban
 * "Todas 25" bajo un saludo que decía "Tienes 200 tareas pendientes" (D-01).
 */
function buildQueueShortcuts(input: {
  queue: Awaited<ReturnType<typeof getOperationalWorkQueue>>
  canApprove: boolean
  canReceive: boolean
  canDeliver: boolean
}): QueueShortcut[] {
  const { summary, total } = input.queue
  const moduleShortcut = (module: OperationalModule, allowed: boolean): QueueShortcut | null => {
    const count = summary.moduleCounts[module] ?? 0
    return allowed && count > 0
      ? { key: module, label: OPERATIONAL_MODULE_LABELS[module], count, href: `/pendientes?module=${module}` }
      : null
  }
  const candidates: Array<QueueShortcut | null> = [
    { key: "all", label: "Todas", count: total, href: "/pendientes" },
    summary.critical > 0 ? { key: "critical", label: "Críticas", count: summary.critical, href: "/pendientes?quick=critical" } : null,
    summary.overdue > 0 ? { key: "overdue", label: "Vencidas", count: summary.overdue, href: "/pendientes?quick=overdue" } : null,
    summary.unassigned > 0 ? { key: "unassigned", label: "Sin responsable", count: summary.unassigned, href: "/pendientes?quick=unassigned" } : null,
    moduleShortcut("aprobaciones", input.canApprove),
    moduleShortcut("recepciones", input.canReceive),
    moduleShortcut("entregas", input.canDeliver),
  ]
  return candidates.filter((shortcut): shortcut is QueueShortcut => shortcut !== null).slice(0, 6)
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
  // "Sin corte mensual" y no "sin snapshot": la comparación mira el último corte
  // completo **anterior al mes en curso**, mientras el sparkline de la misma fila
  // muestra los últimos 30 días. Con la copia anterior una fila podía decir "sin
  // snapshot previo" y dibujar una tendencia al lado — parecía contradicción.
  if (comparison.previous === null || !comparison.snapshotDate) return "Sin corte mensual comparable"
  const difference = comparison.current - comparison.previous
  if (difference === 0) return `Sin variación vs. ${formatDate(comparison.snapshotDate)}`
  return `${difference > 0 ? "+" : ""}${difference} vs. ${formatDate(comparison.snapshotDate)}`
}

function buildOperationalBacklogSummary(input: {
  backlogComparisons: OperationalBacklogComparison[]
  snapshotHistory: Record<OperationalSnapshotMetric, number[]>
  canViewRequests: boolean
  canViewPurchasing: boolean
  canViewCapa: boolean
  canViewPdtp: boolean
}): OperationalPeriodSummaryEntry[] {
  const byMetric = new Map(input.backlogComparisons.map((comparison) => [comparison.metric, comparison]))
  const entry = (metric: OperationalBacklogComparison["metric"], label: string, href: string): OperationalPeriodSummaryEntry | null => {
    const comparison = byMetric.get(metric)
    return comparison
      ? { key: metric, label, value: comparison.current, comparison: backlogComparison(comparison), href, sparkline: input.snapshotHistory[metric] }
      : null
  }
  const entries: Array<OperationalPeriodSummaryEntry | null> = [
    input.canViewRequests ? entry("backlog_requests", "Solicitudes activas", "/pendientes?module=solicitudes") : null,
    input.canViewPurchasing ? entry("backlog_orders", "OC activas", "/pendientes?module=compras") : null,
    input.canViewCapa ? entry("backlog_capa", "CAPA abiertas", "/pendientes?module=capa") : null,
    input.canViewPdtp ? entry("backlog_pdtp", "Obligaciones PDTP", "/pendientes?module=pdtp") : null,
  ]
  return entries.filter((entry): entry is OperationalPeriodSummaryEntry => entry !== null)
}

/**
 * Máximo 4 tiles accionables (A1). Todos navegan a la vista que los explica.
 *
 * "Inversión acumulada" (SUM histórico de OC) y "Tasa de aprobación" (ratio de
 * toda la historia) ocupaban dos de los cuatro slots con cifras que no cambian
 * de un día a otro ni informan una decisión operativa (P-03). Las reemplazan
 * "Tareas vencidas" —que sí exige acción hoy— y la inversión **del mes**, que
 * ya viene con su comparación contra el mes anterior.
 *
 * Cada tile cambia su descripción en 0 (A1). La regla pide "la acción para dejar
 * de estarlo", pero estos contadores en cero son buenas noticias y no hay acción
 * que tomar: la copia correcta es confirmarlo, no inventar un CTA. La regla
 * apunta a tiles vacíos por falta de configuración, no a contadores en cero.
 */
function buildOperationalMetrics(input: {
  tasks: number
  criticalTasks: number
  overdueTasks: number
  pendingApprovals: number
  ordersPendingReceipt: number
  deliveries: number
  stockAlerts: number
  /** Serie diaria real de `stock_alerts`; la única de los tiles que existe. */
  stockTrend: number[]
  monthSpend: number
  canApprove: boolean
  canReceive: boolean
  canDeliver: boolean
  canViewStock: boolean
  canViewPurchasing: boolean
}): DashboardMetric[] {
  const candidates: Array<DashboardMetric | null> = [
    { key: "tasks", label: "Tareas pendientes", value: input.tasks, description: input.tasks > 0 ? "Acciones disponibles para tu rol" : "Nada pendiente por ahora", icon: "tasks", href: "/pendientes", tone: input.tasks > 0 ? "signal" : "neutral" },
    { key: "critical", label: "Tareas críticas", value: input.criticalTasks, description: input.criticalTasks > 0 ? "Requieren revisión prioritaria" : "Sin prioridad crítica", icon: "critical", href: "/pendientes?quick=critical", tone: input.criticalTasks > 0 ? "danger" : "neutral" },
    { key: "overdue", label: "Tareas vencidas", value: input.overdueTasks, description: input.overdueTasks > 0 ? "Su plazo comprometido ya venció" : "Nada fuera de plazo", icon: "critical", href: "/pendientes?quick=overdue", tone: input.overdueTasks > 0 ? "danger" : "neutral" },
    input.canApprove ? { key: "approvals", label: "Por aprobar", value: input.pendingApprovals, description: input.pendingApprovals > 0 ? "Ítems esperando una decisión" : "Nada esperando decisión", icon: "approvals", href: "/pendientes?module=aprobaciones", tone: input.pendingApprovals > 0 ? "signal" : "neutral" } : null,
    input.canReceive ? { key: "receipts", label: "Por recibir", value: input.ordersPendingReceipt, description: input.ordersPendingReceipt > 0 ? "Órdenes con recepción pendiente" : "Sin recepciones pendientes", icon: "receipts", href: "/pendientes?module=recepciones", tone: input.ordersPendingReceipt > 0 ? "signal" : "neutral" } : null,
    input.canDeliver ? { key: "deliveries", label: "Entregas pendientes", value: input.deliveries, description: input.deliveries > 0 ? "Ítems listos para registrar entrega" : "Sin entregas por registrar", icon: "deliveries", href: "/pendientes?module=entregas", tone: input.deliveries > 0 ? "signal" : "neutral" } : null,
    input.canViewStock ? { key: "stock", label: "Stock crítico", value: input.stockAlerts, description: input.stockAlerts > 0 ? "Productos bajo su mínimo definido" : "Todo sobre el mínimo definido", icon: "stock", href: "/bodega", tone: input.stockAlerts > 0 ? "danger" : "neutral", sparkline: input.stockTrend } : null,
    input.canViewPurchasing ? { key: "spend", label: "Inversión del mes", value: formatCLP(input.monthSpend), description: "OC emitidas en el mes en curso", icon: "investment", href: "/compras" } : null,
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
