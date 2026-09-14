import Link from "next/link"
import type { Session } from "next-auth"
import { Plus } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { can } from "@/lib/auth/can"
import type { WorksiteScope } from "@/lib/auth/scope"
import { formatCLP, formatDate } from "@/lib/utils"
import { getCriticalStockAlertCount } from "@/lib/services/stock-alerts"
import { getDashboardData } from "@/lib/services/dashboard"
import { listOperationalActivity } from "@/lib/services/operational-activity"
import {
  getOperationalCalendarBounds,
  getOperationalPeriodMetrics,
  type OperationalPeriodMetric,
  type OperationalPeriodMetrics,
  type OperationalPeriodSpan,
} from "@/lib/services/operational-period-metrics"
import {
  getOperationalBacklogComparisons,
  getOperationalSnapshotHistory,
  type OperationalBacklogComparison,
  type OperationalSnapshotMetric,
} from "@/lib/services/operational-metric-snapshots"
import type { OperationalQueueResult } from "@/lib/services/operational-work-queue"
import { OPERATIONAL_MODULE_LABELS, type OperationalModule } from "@/lib/work-queue"
import { listEppCoverageGaps } from "@/lib/services/prevention-epp"
import { getCapaDashboardCounts } from "@/lib/services/prevention-capa"
import { getIncidentDashboardCounts } from "@/lib/services/prevention-incidents"
import { getActivePdtpProgram, listPdtpPrograms } from "@/lib/services/prevention-pdtp"
import { getOperationalTrendHistory } from "@/lib/services/operational-trend-history"
import { loadPdtpComplianceSummary } from "../pdtp-compliance-card"
import { RecentActivity } from "../recent-activity"
import { OperationalTrendChart, RadialGaugeChart } from "../dashboard-domain-charts"
import {
  DashboardResumenBody,
  type DashboardAlert,
  type DashboardMetric,
  type OperationalPeriodSummaryEntry,
} from "../dashboard-control-center"
import {
  periodComparisonLabel,
  periodScopeLabel,
  scopedWorksiteId,
  type DashboardScope,
} from "../dashboard-scope"
import type { QueueShortcut } from "./trabajo-view"

export interface ResumenViewProps {
  session: Session
  scope: DashboardScope
  worksiteScope: WorksiteScope
  pdtpScope: string[] | "all"
  /** Faenas del alcance ya resueltas a ids: varias funciones exigen `string[]`. */
  worksiteIds: string[]
  currentYear: number
  /** Total de la cola, ya consultado por la página para la cabecera. */
  queueTotal: number
  /** Resumen de la cola: alimenta la ranura de trabajo y las alertas. */
  queueSummary: OperationalQueueResult["summary"]
}

/**
 * Vista de entrada: lo transversal, no un dominio.
 *
 * Cuatro KPIs por ranura semántica (dinero · cumplimiento · riesgo · trabajo),
 * las alertas que no son tile, el flujo del período y el backlog comparado. Los
 * dominios completos viven cada uno en su pestaña.
 */
export async function ResumenView({
  session,
  scope,
  worksiteScope,
  pdtpScope,
  worksiteIds,
  currentYear,
  queueTotal,
  queueSummary,
}: ResumenViewProps) {
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
  /*
   * DASH-001 (auditoría 2026-09-14): la tendencia operativa —solicitudes, OC y
   * recepciones de toda la faena— se cargaba y dibujaba para cualquier sesión
   * autenticada. `requests:view_own` significa "sólo las mías": una curva con
   * el volumen de todos es exactamente lo que esa capacidad no concede, y las
   * otras dos series pertenecen a Compras y a Recepción.
   *
   * Cada serie sale sólo con su permiso; el gráfico se oculta solo cuando las
   * tres quedan en cero, que es su comportamiento de siempre.
   */
  const canSeeRequestVolume = can(session, "requests:view_all")
  const canSeeAnyTrend = canSeeRequestVolume || canViewPurchasing || canReceive

  const scopedWorksite = scopedWorksiteId(scope)

  // Un solo lote: el bloque de prevención no depende del operacional, y
  // encadenarlos duplicaba la latencia de red de la página (P-01).
  const [
    data, activity, stockAlertCount, eppGapsCount, periodMetrics, backlogComparisons, snapshotHistory,
    pdtpSummary, activeProgram, allPrograms, capaCounts, incidentCounts, trend,
  ] = await Promise.all([
    getDashboardData(session, scopedWorksite),
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
      ? loadPdtpComplianceSummary(worksiteIds)
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
    // Transversal, no de un dominio: solicitudes, OC y recepciones en la misma
    // tendencia son el pulso de la operación completa.
    canSeeAnyTrend
      ? getOperationalTrendHistory(session, 6, new Date(), scopedWorksite)
      : Promise.resolve([]),
  ])

  const hasNextYearProgram = allPrograms.some((p) => p.year === currentYear + 1)
  const shouldSuggestNextYear = activeProgram && !hasNextYearProgram && canManagePdtp

  const metrics = buildOperationalMetrics({
    scope,
    tasks: queueTotal,
    overdueTasks: queueSummary.overdue,
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
    criticalTasks: queueSummary.critical,
    overdueTasks: queueSummary.overdue,
    blockedTasks: queueSummary.blocked,
    unassignedTasks: queueSummary.unassigned,
    pendingApprovals: data.metrics.pending_approvals,
    ordersPendingReceipt: data.metrics.orders_pending_receipt,
    deliveries: queueSummary.moduleCounts.entregas ?? 0,
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

  return (
    <DashboardResumenBody
      scope={scope}
      metrics={metrics}
      alerts={alerts}
      periodSummary={buildOperationalPeriodSummary({ periodMetrics, scope, canViewRequests, canViewPurchasing, canReceive, canDeliver })}
      backlogSummary={buildOperationalBacklogSummary({ backlogComparisons, snapshotHistory, scope, canViewRequests, canViewPurchasing, canViewCapa, canViewPdtp })}
      mainSlot={
        <>
          {/* Dos lecturas transversales, no un dominio: el cumplimiento anual
              contra su meta y el pulso de la operación. El detalle del PDTP
              —por faena, por actividad— vive en la pestaña de Prevención; A5
              impide que la misma cifra tenga dos representaciones acá. */}
          <div className="grid gap-6 xl:grid-cols-2">
            {/* `percent === null` es "sin acreditación todavía", no 0%: dibujar
                un arco vacío afirmaría un incumplimiento que nadie midió. */}
            {canViewPdtp && pdtpSummary?.percent != null ? (
              // El medidor no tiene tooltip ni ejes interactivos, así que
              // envolverlo en el enlace no le roba ningún gesto: sigue siendo un
              // indicador accionable, como exige A1.
              <Link href="/prevencion/pdtp" className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                <RadialGaugeChart
                  title="Cumplimiento PDTP"
                  description={`Avance acreditado · año ${currentYear}`}
                  percent={Math.round(pdtpSummary.percent * 100)}
                  targetPercent={Math.round(pdtpSummary.target * 100)}
                />
              </Link>
            ) : canViewPdtp ? (
              <EmptyState
                compact
                align="start"
                title={pdtpSummary
                  ? `El programa ${currentYear} no tiene avance acreditado`
                  : `No hay un programa activo para ${currentYear}`}
                description={pdtpSummary
                  ? "El cumplimiento aparece cuando se acredite la primera actividad."
                  : "Crea o activa un programa para visualizar el avance preventivo desde acá."}
                action={canManagePdtp && !pdtpSummary ? (
                  <Button asChild size="sm">
                    <Link href="/prevencion/pdtp/nuevo">
                      <Plus size={13} />
                      {shouldSuggestNextYear ? `Preparar ${currentYear + 1}` : "Crear programa"}
                    </Link>
                  </Button>
                ) : undefined}
              />
            ) : null}
            <OperationalTrendChart
              data={trend.map((point) => ({
                month: point.month,
                requests: canSeeRequestVolume ? point.requests : 0,
                orders: canViewPurchasing ? point.orders : 0,
                receipts: canReceive ? point.receipts : 0,
              }))}
            />
          </div>
          <RecentActivity entries={activity} />
        </>
      }
    />
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
 * Ventana calendario [desde, hasta) del período del alcance, en claves de
 * fecha (YYYY-MM-DD). Alimenta los destinos de lista que pueden reproducir lo
 * que la cifra cuenta (p.ej. "Inversión · mes" → `/compras?desde=…&hasta=…`).
 */
function periodWindowHref(scope: DashboardScope, path: string) {
  const bounds = getOperationalCalendarBounds(new Date(), scope.period)
  const search = new URLSearchParams()
  search.set("desde", bounds.currentStart.slice(0, 10))
  search.set("hasta", bounds.currentEnd.slice(0, 10))
  return `${path}?${search.toString()}`
}

/**
 * Atajos de la cola. Los conteos salen de `queue.summary` — población completa
 * del alcance vigente — y cada uno navega a `/pendientes` con el filtro
 * equivalente más la faena elegida.
 *
 * Antes eran chips que filtraban en cliente las 25 filas cargadas: mostraban
 * "Todas 25" bajo un saludo que decía "Tienes 200 tareas pendientes" (D-01).
 *
 * Vive acá aunque la consuma la vista Mi trabajo: comparte `pendientesHref` con
 * las métricas y las alertas, y sacarla a un módulo propio sería un archivo de
 * tres funciones para evitar un import.
 */
export function buildQueueShortcuts(input: {
  queue: Pick<OperationalQueueResult, "summary" | "total">
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
    input.canViewRequests ? { key: "requests", label: "Solicitudes creadas", value: input.periodMetrics.requests.current, comparison: compare(input.periodMetrics.requests), href: periodWindowHref(input.scope, "/solicitudes") } : null,
    input.canViewPurchasing ? { key: "orders", label: "OC emitidas", value: input.periodMetrics.ordersIssued.current, comparison: compare(input.periodMetrics.ordersIssued), href: periodWindowHref(input.scope, "/compras") } : null,
    input.canReceive ? { key: "receipts", label: "Recepciones", value: input.periodMetrics.receipts.current, comparison: compare(input.periodMetrics.receipts), href: "/recepcion" } : null,
    input.canDeliver ? { key: "deliveries", label: "Entregas", value: input.periodMetrics.deliveries.current, comparison: compare(input.periodMetrics.deliveries), href: "/entregas" } : null,
    input.canViewPurchasing ? { key: "spend", label: "Inversión emitida", value: formatCLP(input.periodMetrics.spend.current), comparison: compare(input.periodMetrics.spend), href: periodWindowHref(input.scope, "/compras") } : null,
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
 * Cuatro tiles accionables, uno por **ranura semántica**: dinero, cumplimiento,
 * riesgo y trabajo propio.
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
    input.canViewPurchasing ? { key: "spend", label: "Inversión", value: formatCLP(input.periodSpend),
      description: `OC emitidas · ${periodLabel}`, icon: "investment", href: periodWindowHref(input.scope, "/compras"),
    } : null,
    input.canViewPurchasing ? {
      key: "orders", label: "OC activas", value: input.activeOrders,
      description: input.activeOrders > 0 ? "Órdenes en curso sin cerrar" : "Sin órdenes en curso",
      icon: "investment", href: href({ module: "compras" }),
    } : null,
  ]

  /*
   * La ranura de cumplimiento **ya no incluye el PDTP**: esa cifra la carga el
   * medidor radial de más abajo, que además dibuja la meta. Tenerla en los dos
   * sitios era la misma cifra dos veces en la misma pantalla (A5) — el defecto
   * que esta fila existe para evitar.
   */
  const compliance: Array<DashboardMetric | null> = [
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
      icon: "critical", href: "/prevencion/incidentes?quick=open",
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
      icon: "stock", href: "/bodega?stock=low",
      tone: input.stockAlerts > 0 ? "danger" : "neutral", sparkline: input.stockTrend,
    } : null,
  ]

  const work: Array<DashboardMetric | null> = [
    input.overdueTasks > 0 ? {
      key: "overdue", label: "Tareas vencidas", value: input.overdueTasks,
      description: "Plazo comprometido vencido", icon: "critical",
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
 * Regla A5: una cifra no puede ser tile y alerta a la vez. Antes "críticas",
 * "vencidas", "por aprobar", "stock" y "recepciones" aparecían en las dos partes
 * de la pantalla —y "críticas" además en el saludo y en su chip de atajo, cuatro
 * veces la misma cifra—. `shownAsTile` recibe las claves que la fila superior ya
 * ocupó y las salta acá.
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
    input.unassignedTasks > 0 ? { key: "unassigned", title: "tareas sin responsable", description: "No tienen un responsable propio en su módulo de origen.", count: input.unassignedTasks, severity: "warning", href: href({ quick: "unassigned" }) } : null,
    input.canViewStock && input.stockAlerts > 0 ? { key: "stock", title: "productos con stock crítico", description: "El nivel actual está por debajo del mínimo definido para la faena.", count: input.stockAlerts, severity: "critical", href: "/bodega?stock=low" } : null,
    input.canViewCapa && input.overdueCapa > 0 ? { key: "capa", title: "acciones correctivas vencidas", description: "Su plazo de cierre comprometido ya venció.", count: input.overdueCapa, severity: "critical", href: href({ module: "capa" }) } : null,
    input.canApprove && input.pendingApprovals > 0 ? { key: "approvals", title: "ítems esperan aprobación", description: "Una decisión de aprobación desbloquea el siguiente paso de compra.", count: input.pendingApprovals, severity: "warning", href: href({ module: "aprobaciones" }) } : null,
    input.canReceive && input.ordersPendingReceipt > 0 ? { key: "receipts", title: "órdenes pendientes de recepción", description: "Registra la llegada para que la operación pueda avanzar.", count: input.ordersPendingReceipt, severity: "warning", href: href({ module: "recepciones" }) } : null,
    input.canDeliver && input.deliveries > 0 ? { key: "deliveries", title: "entregas por registrar", description: "Hay ítems disponibles para confirmar entrega a trabajadores desde stock físico.", count: input.deliveries, severity: "info", href: href({ module: "entregas" }) } : null,
    input.canViewEpp && input.eppGaps > 0 ? { key: "epp", title: "brechas preventivas de EPP", description: "Existen brechas bloqueantes que requieren gestión preventiva.", count: input.eppGaps, severity: "warning", href: "/prevencion/epp-preventivo" } : null,
  ]

  return alerts.filter((alert): alert is DashboardAlert => alert !== null && !input.shownAsTile.has(alert.key))
}
