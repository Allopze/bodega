import type { Metadata } from "next"
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
import { getOperationalPeriodMetrics, type OperationalPeriodMetric, type OperationalPeriodMetrics, type OperationalPeriodSpan } from "@/lib/services/operational-period-metrics"
import { getOperationalBacklogComparisons, getOperationalSnapshotHistory, type OperationalBacklogComparison, type OperationalSnapshotMetric } from "@/lib/services/operational-metric-snapshots"
import { QuickActions } from "./quick-actions"
import { RecentActivity } from "./recent-activity"
import { loadPdtpComplianceSummary, PdtpComplianceCard } from "./pdtp-compliance-card"
import { getActivePdtpProgram, listPdtpPrograms } from "@/lib/services/prevention-pdtp"
import { scopeToWorksiteIds } from "./dashboard-helpers"
import { listVisibleWorksites } from "@/lib/services/prevention-indicadores"
import {
  intersectWorksiteScope,
  parseDashboardScope,
  periodComparisonLabel,
  periodScopeLabel,
  scopedWorksiteId,
  type DashboardScope,
  type DashboardScopeSearchParams,
} from "./dashboard-scope"
import { DashboardDomainSections } from "./dashboard-domain-sections"
import { listEppCoverageGaps } from "@/lib/services/prevention-epp"
import { getCapaDashboardCounts } from "@/lib/services/prevention-capa"
import { getIncidentDashboardCounts } from "@/lib/services/prevention-incidents"
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

export default async function DashboardPage({ searchParams }: { searchParams: Promise<DashboardScopeSearchParams> }) {
  const session = await auth()
  if (!session) return null

  const roleScope = resolveWorksiteScope(session)
  const canApprove = can(session, "approvals:approve")
  const canViewRequests = can(session, "requests:view_own") || can(session, "requests:view_all")
  const canViewPurchasing = can(session, "purchasing:view")
  const canReceive = can(session, "receiving:view")
  const canDeliver = can(session, "deliveries:create")
  const canViewStock = can(session, "warehouse:view_stock")
  const canViewEpp = can(session, "prevention:epp:view")
  const canViewPdtp = can(session, "prevention:pdtp:view")
  const canViewCapa = can(session, "prevention:capa:view")
  const canViewIncidents = can(session, "prevention:incidents:view")
  const canManagePdtp = can(session, "prevention:pdtp:program:manage")

  // Hora de Chile: el proceso corre en UTC y el 31 de diciembre por la tarde
  // este año saltaba al siguiente, consultando PDTP/SST del año equivocado.
  const currentYear = chileDateParts().year

  /*
   * El alcance global (faena + período) se resuelve **antes** del lote de
   * consultas porque todas lo reciben.
   *
   * `listVisibleWorksites` y no `queue.filterOptions.worksites`: esas son sólo
   * las faenas *con trabajo pendiente*, así que una faena sin tareas no era
   * seleccionable — y justamente para esa querría gerencia ver inversión o
   * cumplimiento. Es una consulta indexada sobre `worksites`, y la fase anterior
   * ya sacó dos del mismo lote.
   */
  const authorizedWorksites = await listVisibleWorksites(roleScope)
  const scope = parseDashboardScope(await searchParams, authorizedWorksites)
  const scopedWorksite = scopedWorksiteId(scope)
  const worksiteScope = intersectWorksiteScope(roleScope, scope)
  const pdtpScope = scopeToWorksiteIds(worksiteScope)

  // Un solo lote: el bloque de prevención no depende del operacional, y
  // encadenarlos duplicaba la latencia de red de la página (P-01).
  const [
    data, queue, activity, stockAlertCount, eppGapsCount, periodMetrics, backlogComparisons, snapshotHistory,
    pdtpSummary, activeProgram, allPrograms, capaCounts, incidentCounts,
  ] = await Promise.all([
    getDashboardData(session, scopedWorksite),
    getOperationalWorkQueue(session, { limit: QUEUE_PREVIEW_LIMIT, worksiteId: scope.worksiteId }),
    listOperationalActivity(session, 6),
    canViewStock
      ? getCriticalStockAlertCount(pdtpScope)
      : Promise.resolve(0),
    canViewEpp
      ? listEppCoverageGaps({ userId: session.user.id, scope: worksiteScope, permissions: session.user.permissions })
          .then((gaps) => gaps.filter((gap) => gap.enforcement === "blocking").length)
      : Promise.resolve(0),
    getOperationalPeriodMetrics(session, { period: scope.period, worksiteId: scopedWorksite }),
    getOperationalBacklogComparisons(session, new Date(), scopedWorksite),
    getOperationalSnapshotHistory(session, 30, new Date(), scopedWorksite),
    canViewPdtp
      ? loadPdtpComplianceSummary(pdtpScope)
      : Promise.resolve(null),
    canViewPdtp ? getActivePdtpProgram(currentYear) : Promise.resolve(null),
    canViewPdtp ? listPdtpPrograms() : Promise.resolve([]),
    // Las dos alimentan la ranura de Riesgo. Ambas hacen `requirePermission`
    // adentro, así que el gate va afuera y no en un `catch`.
    canViewCapa
      ? getCapaDashboardCounts({ scope: worksiteScope, permissions: session.user.permissions })
      : Promise.resolve({ open: 0, overdue: 0, pendingVerification: 0, unreconciled: 0 }),
    canViewIncidents
      ? getIncidentDashboardCounts({ ctx: { userId: session.user.id }, scope: worksiteScope, permissions: session.user.permissions })
      : Promise.resolve({ totalOpen: 0, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 }),
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
    scope,
    tasks: queue.total,
    overdueTasks: queue.summary.overdue,
    pendingApprovals: data.metrics.pending_approvals,
    ordersPendingReceipt: data.metrics.orders_pending_receipt,
    activeOrders: backlogComparisons.find((entry) => entry.metric === "backlog_orders")?.current ?? 0,
    stockAlerts: stockAlertCount,
    stockTrend: snapshotHistory.stock_alerts,
    periodSpend: periodMetrics.spend.current,
    pdtpPercent: pdtpSummary?.percent ?? null,
    pdtpTarget: pdtpSummary?.target ?? 0.9,
    openIncidents: incidentCounts.totalOpen,
    fatalOrSeriousIncidents: incidentCounts.fatalOrSerious,
    overdueCapa: capaCounts.overdue,
    canApprove,
    canReceive,
    canViewStock,
    canViewPurchasing,
    canViewPdtp,
    canViewIncidents,
    canViewCapa,
  })
  // Lo que ya está arriba no se repite en el aside (A5).
  const shownAsTile = new Set(metrics.map((metric) => metric.key))
  const alerts = buildOperationalAlerts({
    scope,
    shownAsTile,
    criticalTasks: criticalTaskCount,
    overdueTasks: queue.summary.overdue,
    blockedTasks: queue.summary.blocked,
    unassignedTasks: queue.summary.unassigned,
    pendingApprovals: data.metrics.pending_approvals,
    ordersPendingReceipt: data.metrics.orders_pending_receipt,
    deliveries: deliveryTaskCount,
    stockAlerts: stockAlertCount,
    eppGaps: eppGapsCount,
    overdueCapa: capaCounts.overdue,
    canApprove,
    canReceive,
    canDeliver,
    canViewStock,
    canViewEpp,
    canViewCapa,
  })
  /*
   * El rótulo declara el alcance **elegido**, que es lo que las cifras
   * responden. Antes describía la faena principal del usuario incluso cuando el
   * tablero mostraba todas — con un selector de faena arriba eso sería una
   * contradicción visible.
   */
  const contextLabel = scope.worksiteName
    ?? (roleScope.mode === "all" ? "Todas las faenas activas" : "Todas mis faenas autorizadas")

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
          queueShortcuts={buildQueueShortcuts({ queue, scope, canApprove, canReceive, canDeliver })}
          scope={scope}
          worksiteOptions={authorizedWorksites}
          canAssign={session.user.permissions.includes("operations:assign_work")}
          periodSummary={buildOperationalPeriodSummary({ periodMetrics, scope, canViewRequests, canViewPurchasing, canReceive, canDeliver })}
          backlogSummary={buildOperationalBacklogSummary({ backlogComparisons, snapshotHistory, scope, canViewRequests, canViewPurchasing, canViewCapa, canViewPdtp })}
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

        {/* ── Secciones por dominio ────────────────────────────────────────
            Reemplazan al bloque "Analítica y tendencias", que agrupaba 8
            gráficos en tres bloques sin enlace a ningún módulo (G-03) y cubría
            6 de ~19 dominios. Sus gráficos siguen vivos, repartidos entre
            Adquisiciones, Prevención y Flota.

            El `key` con el alcance es necesario: sin él, cambiar de faena
            reusaba el árbol suspendido y las secciones mostraban los datos de
            la faena anterior mientras las consultas nuevas resolvían. */}
        <DashboardDomainSections
          key={`${scope.worksiteId}:${scope.period}`}
          session={session}
          scope={scope}
          worksiteScope={worksiteScope}
          pdtpScope={pdtpScope}
          worksiteIds={scopedWorksite ? [scopedWorksite] : authorizedWorksites.map((worksite) => worksite.id)}
          currentYear={currentYear}
          moduleWorkload={moduleWorkload}
          queueTotal={queue.total}
          worksitesBreakdown={data.worksitesBreakdown}
        />
      </div>
    </PageContainer>
  )
}

/**
 * Enlace a la cola completa que **conserva la faena** del alcance global.
 *
 * Sin esto, salir del dashboard con una faena elegida aterrizaba en
 * `/pendientes` sin filtro: el conteo del atajo y la lista de destino hablaban
 * de poblaciones distintas. `/pendientes` lee `worksiteId` de la URL
 * (`parseOperationalQueueFilters`), así que el filtro sobrevive al salto.
 */
function pendientesHref(scope: DashboardScope, params: Record<string, string> = {}) {
  const search = new URLSearchParams(params)
  const worksiteId = scopedWorksiteId(scope)
  if (worksiteId) search.set("worksiteId", worksiteId)
  const query = search.toString()
  return query ? `/pendientes?${query}` : "/pendientes"
}

/**
 * Atajos de la cola. Los conteos salen de `queue.summary` — población completa
 * del alcance vigente — y cada uno navega a `/pendientes` con el filtro
 * equivalente más la faena elegida.
 *
 * Antes eran chips que filtraban en cliente las 25 filas cargadas: mostraban
 * "Todas 25" bajo un saludo que decía "Tienes 200 tareas pendientes" (D-01).
 */
function buildQueueShortcuts(input: {
  queue: Awaited<ReturnType<typeof getOperationalWorkQueue>>
  scope: DashboardScope
  canApprove: boolean
  canReceive: boolean
  canDeliver: boolean
}): QueueShortcut[] {
  const { summary, total } = input.queue
  const href = (params?: Record<string, string>) => pendientesHref(input.scope, params)
  const moduleShortcut = (module: OperationalModule, allowed: boolean): QueueShortcut | null => {
    const count = summary.moduleCounts[module] ?? 0
    return allowed && count > 0
      ? { key: module, label: OPERATIONAL_MODULE_LABELS[module], count, href: href({ module }) }
      : null
  }
  const candidates: Array<QueueShortcut | null> = [
    { key: "all", label: "Todas", count: total, href: href() },
    summary.critical > 0 ? { key: "critical", label: "Críticas", count: summary.critical, href: href({ quick: "critical" }) } : null,
    summary.overdue > 0 ? { key: "overdue", label: "Vencidas", count: summary.overdue, href: href({ quick: "overdue" }) } : null,
    summary.unassigned > 0 ? { key: "unassigned", label: "Sin responsable", count: summary.unassigned, href: href({ quick: "unassigned" }) } : null,
    moduleShortcut("aprobaciones", input.canApprove),
    moduleShortcut("recepciones", input.canReceive),
    moduleShortcut("entregas", input.canDeliver),
  ]
  return candidates.filter((shortcut): shortcut is QueueShortcut => shortcut !== null).slice(0, 6)
}

/**
 * El rótulo del comparativo sigue al período elegido. Estaba escrito a mano como
 * "vs. mes anterior", así que al elegir trimestre habría dicho mes.
 */
function periodComparison(metric: OperationalPeriodMetric, period: OperationalPeriodSpan) {
  if (metric.previous === null) return "Sin período comparable"
  const label = periodComparisonLabel(period)
  const difference = metric.current - metric.previous
  if (difference === 0) return `Sin variación ${label}`
  return `${difference > 0 ? "+" : ""}${difference} ${label}`
}

function buildOperationalPeriodSummary(input: {
  periodMetrics: OperationalPeriodMetrics
  scope: DashboardScope
  canViewRequests: boolean
  canViewPurchasing: boolean
  canReceive: boolean
  canDeliver: boolean
}): OperationalPeriodSummaryEntry[] {
  const compare = (metric: OperationalPeriodMetric) => periodComparison(metric, input.scope.period)
  const entries: Array<OperationalPeriodSummaryEntry | null> = [
    input.canViewRequests ? { key: "requests", label: "Solicitudes creadas", value: input.periodMetrics.requests.current, comparison: compare(input.periodMetrics.requests), href: "/solicitudes" } : null,
    input.canViewPurchasing ? { key: "orders", label: "OC emitidas", value: input.periodMetrics.ordersIssued.current, comparison: compare(input.periodMetrics.ordersIssued), href: "/compras" } : null,
    input.canReceive ? { key: "receipts", label: "Recepciones", value: input.periodMetrics.receipts.current, comparison: compare(input.periodMetrics.receipts), href: "/recepcion" } : null,
    input.canDeliver ? { key: "deliveries", label: "Entregas", value: input.periodMetrics.deliveries.current, comparison: compare(input.periodMetrics.deliveries), href: "/entregas" } : null,
    input.canViewPurchasing ? { key: "spend", label: "Inversión emitida", value: formatCLP(input.periodMetrics.spend.current), comparison: compare(input.periodMetrics.spend), href: "/compras" } : null,
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
  scope: DashboardScope
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
  const href = (module: string) => pendientesHref(input.scope, { module })
  const entries: Array<OperationalPeriodSummaryEntry | null> = [
    input.canViewRequests ? entry("backlog_requests", "Solicitudes activas", href("solicitudes")) : null,
    input.canViewPurchasing ? entry("backlog_orders", "OC activas", href("compras")) : null,
    input.canViewCapa ? entry("backlog_capa", "CAPA abiertas", href("capa")) : null,
    input.canViewPdtp ? entry("backlog_pdtp", "Obligaciones PDTP", href("pdtp")) : null,
  ]
  return entries.filter((entry): entry is OperationalPeriodSummaryEntry => entry !== null)
}

/**
 * Cuatro tiles accionables (A1), uno por **ranura semántica**: dinero,
 * cumplimiento, riesgo y trabajo propio.
 *
 * Antes era una lista de 8 candidatos en orden fijo cortada con `.slice(0, 4)`.
 * Para Jefatura eso entregaba **siempre** "Tareas pendientes · críticas ·
 * vencidas · Por aprobar" —tres de cuatro del mismo eje, cero cifras de
 * negocio— y dejaba "Inversión del mes" (candidato 8) y "Stock crítico" (7)
 * fuera **para todos los roles**: eran código inalcanzable, con sparkline
 * incluido.
 *
 * Cada ranura es una cascada: se muestra el primer candidato que el permiso
 * autoriza. Si ninguno califica, la ranura se cede y la fila queda con menos de
 * cuatro tiles en vez de rellenarse con otro contador de tareas.
 *
 * Cada tile cambia su descripción en 0 (A1). La regla pide "la acción para dejar
 * de estarlo", pero estos contadores en cero son buenas noticias y no hay acción
 * que tomar: la copia correcta es confirmarlo, no inventar un CTA. La regla
 * apunta a tiles vacíos por falta de configuración, no a contadores en cero.
 */
export function buildOperationalMetrics(input: {
  scope: DashboardScope
  tasks: number
  overdueTasks: number
  pendingApprovals: number
  ordersPendingReceipt: number
  activeOrders: number
  stockAlerts: number
  /** Serie diaria real de `stock_alerts`; la única de los tiles que existe. */
  stockTrend: number[]
  periodSpend: number
  pdtpPercent: number | null
  pdtpTarget: number
  openIncidents: number
  fatalOrSeriousIncidents: number
  overdueCapa: number
  canApprove: boolean
  canReceive: boolean
  canViewStock: boolean
  canViewPurchasing: boolean
  canViewPdtp: boolean
  canViewIncidents: boolean
  canViewCapa: boolean
}): DashboardMetric[] {
  const periodLabel = periodScopeLabel(input.scope.period).toLocaleLowerCase("es-CL")
  const href = (params?: Record<string, string>) => pendientesHref(input.scope, params)

  const money: Array<DashboardMetric | null> = [
    input.canViewPurchasing ? {
      key: "spend", label: "Inversión", value: formatCLP(input.periodSpend),
      description: `OC emitidas · ${periodLabel}`, icon: "investment", href: "/compras",
    } : null,
    input.canViewPurchasing ? {
      key: "orders", label: "OC activas", value: input.activeOrders,
      description: input.activeOrders > 0 ? "Órdenes en curso sin cerrar" : "Sin órdenes en curso",
      icon: "investment", href: href({ module: "compras" }),
    } : null,
  ]

  const compliance: Array<DashboardMetric | null> = [
    input.canViewPdtp && input.pdtpPercent !== null ? {
      key: "pdtp", label: "Cumplimiento PDTP", value: `${Math.round(input.pdtpPercent * 100)}%`,
      description: `Meta anual ${Math.round(input.pdtpTarget * 100)}%`,
      icon: "rate", href: "/prevencion/pdtp",
      tone: input.pdtpPercent < input.pdtpTarget ? "signal" : "neutral",
    } : null,
    input.canReceive ? {
      key: "receipts", label: "Por recibir", value: input.ordersPendingReceipt,
      description: input.ordersPendingReceipt > 0 ? "Órdenes con recepción pendiente" : "Sin recepciones pendientes",
      icon: "receipts", href: href({ module: "recepciones" }),
      tone: input.ordersPendingReceipt > 0 ? "signal" : "neutral",
    } : null,
  ]

  const risk: Array<DashboardMetric | null> = [
    input.canViewIncidents ? {
      key: "incidents", label: "Incidentes abiertos", value: input.openIncidents,
      description: input.fatalOrSeriousIncidents > 0
        ? `${input.fatalOrSeriousIncidents} fatal${input.fatalOrSeriousIncidents === 1 ? "" : "es"} o grave${input.fatalOrSeriousIncidents === 1 ? "" : "s"}`
        : input.openIncidents > 0 ? "Ninguno fatal ni grave" : "Sin incidentes abiertos",
      icon: "critical", href: "/prevencion/incidentes",
      tone: input.fatalOrSeriousIncidents > 0 ? "danger" : input.openIncidents > 0 ? "signal" : "neutral",
    } : null,
    input.canViewCapa ? {
      key: "capa", label: "CAPA vencidas", value: input.overdueCapa,
      description: input.overdueCapa > 0 ? "Acciones correctivas fuera de plazo" : "Ninguna fuera de plazo",
      icon: "critical", href: href({ module: "capa" }),
      tone: input.overdueCapa > 0 ? "danger" : "neutral",
    } : null,
    input.canViewStock ? {
      key: "stock", label: "Stock crítico", value: input.stockAlerts,
      description: input.stockAlerts > 0 ? "Productos bajo su mínimo definido" : "Todo sobre el mínimo definido",
      icon: "stock", href: "/bodega",
      tone: input.stockAlerts > 0 ? "danger" : "neutral", sparkline: input.stockTrend,
    } : null,
  ]

  const work: Array<DashboardMetric | null> = [
    input.overdueTasks > 0 ? {
      key: "overdue", label: "Tareas vencidas", value: input.overdueTasks,
      description: "Su plazo comprometido ya venció", icon: "critical",
      href: href({ quick: "overdue" }), tone: "danger",
    } : null,
    input.canApprove ? {
      key: "approvals", label: "Por aprobar", value: input.pendingApprovals,
      description: input.pendingApprovals > 0 ? "Ítems esperando una decisión" : "Nada esperando decisión",
      icon: "approvals", href: href({ module: "aprobaciones" }),
      tone: input.pendingApprovals > 0 ? "signal" : "neutral",
    } : null,
    {
      key: "tasks", label: "Tareas pendientes", value: input.tasks,
      description: input.tasks > 0 ? "Acciones disponibles para tu rol" : "Nada pendiente por ahora",
      icon: "tasks", href: href(), tone: input.tasks > 0 ? "signal" : "neutral",
    },
  ]

  return [money, compliance, risk, work]
    .map((cascade) => cascade.find((metric): metric is DashboardMetric => metric !== null))
    .filter((metric): metric is DashboardMetric => metric !== undefined)
}

/**
 * Alertas del aside: **lo que no es tile**.
 *
 * Regla nueva (A5): una cifra no puede ser tile y alerta a la vez. Antes
 * "críticas", "vencidas", "por aprobar", "stock" y "recepciones" aparecían en
 * las dos partes de la pantalla —y "críticas" además en el saludo y en su chip
 * de atajo, cuatro veces la misma cifra—. `shownAsTile` recibe las claves que la
 * fila superior ya ocupó y las salta acá.
 */
export function buildOperationalAlerts(input: {
  scope: DashboardScope
  shownAsTile: ReadonlySet<string>
  criticalTasks: number
  overdueTasks: number
  blockedTasks: number
  unassignedTasks: number
  pendingApprovals: number
  ordersPendingReceipt: number
  deliveries: number
  stockAlerts: number
  eppGaps: number
  overdueCapa: number
  canApprove: boolean
  canReceive: boolean
  canDeliver: boolean
  canViewStock: boolean
  canViewEpp: boolean
  canViewCapa: boolean
}): DashboardAlert[] {
  const href = (params?: Record<string, string>) => pendientesHref(input.scope, params)
  const alerts: Array<DashboardAlert | null> = [
    input.criticalTasks > 0 ? { key: "critical", title: "tareas críticas", description: "Hay acciones marcadas como críticas dentro de tu cola autorizada.", count: input.criticalTasks, severity: "critical", href: href({ quick: "critical" }) } : null,
    input.overdueTasks > 0 ? { key: "overdue", title: "tareas vencidas", description: "Su fecha nativa o compromiso complementario ya venció.", count: input.overdueTasks, severity: "critical", href: href({ quick: "overdue" }) } : null,
    input.blockedTasks > 0 ? { key: "blocked", title: "procesos bloqueados", description: "Requieren resolver una observación, detención o condición previa.", count: input.blockedTasks, severity: "warning", href: href({ quick: "blocked" }) } : null,
    input.unassignedTasks > 0 ? { key: "unassigned", title: "tareas sin responsable", description: "No tienen una asignación complementaria ni un responsable nativo.", count: input.unassignedTasks, severity: "warning", href: href({ quick: "unassigned" }) } : null,
    input.canViewStock && input.stockAlerts > 0 ? { key: "stock", title: "productos con stock crítico", description: "El nivel actual está por debajo del mínimo definido para la faena.", count: input.stockAlerts, severity: "critical", href: "/bodega" } : null,
    input.canViewCapa && input.overdueCapa > 0 ? { key: "capa", title: "acciones correctivas vencidas", description: "Su plazo de cierre comprometido ya venció.", count: input.overdueCapa, severity: "critical", href: href({ module: "capa" }) } : null,
    input.canApprove && input.pendingApprovals > 0 ? { key: "approvals", title: "ítems esperan aprobación", description: "Una decisión de aprobación desbloquea el siguiente paso de compra.", count: input.pendingApprovals, severity: "warning", href: href({ module: "aprobaciones" }) } : null,
    input.canReceive && input.ordersPendingReceipt > 0 ? { key: "receipts", title: "órdenes pendientes de recepción", description: "Registra la llegada para que la operación pueda avanzar.", count: input.ordersPendingReceipt, severity: "warning", href: href({ module: "recepciones" }) } : null,
    input.canDeliver && input.deliveries > 0 ? { key: "deliveries", title: "entregas por registrar", description: "Hay ítems disponibles para confirmar entrega a faena o trabajador.", count: input.deliveries, severity: "info", href: href({ module: "entregas" }) } : null,
    input.canViewEpp && input.eppGaps > 0 ? { key: "epp", title: "brechas preventivas de EPP", description: "Existen brechas bloqueantes que requieren gestión preventiva.", count: input.eppGaps, severity: "warning", href: "/prevencion/epp-preventivo" } : null,
  ]

  return alerts.filter((alert): alert is DashboardAlert => alert !== null && !input.shownAsTile.has(alert.key))
}
