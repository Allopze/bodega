import Link from "next/link"
import { optionalBlock } from "../optional-block"
import type { Session } from "next-auth"
import { ArrowRight, Plus } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { can } from "@/lib/auth/can"
import type { WorksiteScope } from "@/lib/auth/scope"
import { formatCLP, formatDate, pluralize } from "@/lib/utils"
import { ORDERS_ISSUED_METRIC, ORDERS_SPEND_METRIC, ORDERS_SPEND_TREND_POLARITY } from "../dashboard-metric-definitions"
import { DASHBOARD_GLOSSARY } from "../dashboard-glossary"
import { getDashboardData } from "@/lib/services/dashboard"
import { listOperationalActivity } from "@/lib/services/operational-activity"
import {
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
import { listEppCoverageGaps } from "@/lib/services/prevention-epp"
import { getCapaDashboardCounts } from "@/lib/services/prevention-capa"
import { getIncidentDashboardCounts } from "@/lib/services/prevention-incidents"
import { getActivePdtpProgram, listPdtpPrograms } from "@/lib/services/prevention-pdtp"
import { getOperationalTrendHistory } from "@/lib/services/operational-trend-history"
import { getPdtpOperationalYears } from "@/lib/services/pdtp/operational-years"
import { loadPdtpComplianceSummary } from "../pdtp-compliance-card"
import { RecentActivity } from "../recent-activity"
import { ChartFrame } from "../charts/chart-frame"
import { RadialTickGauge } from "../charts/radial-tick-gauge"
import { groupConsecutiveActivity } from "../activity-groups"
import { OperationalTrendChart } from "../dashboard-domain-charts"
import {
  DashboardResumenBody,
  type DashboardAlert,
  type DashboardMetric,
  type OperationalPeriodSummaryEntry,
} from "../dashboard-control-center"
import {
  periodComparisonLabel,
  periodComparisonShortLabel,
  // DASH-002: `periodWindowHref` vivía acá y perdía la faena del alcance; se
  // mudó junto a `dashboardScopeHref`, que es donde se conserva el alcance.
  periodWindowHref,
  periodScopeLabel,
  scopedWorksiteId,
  type DashboardScope,
} from "../dashboard-scope"
import { pendientesHref, type TodayItem } from "../dashboard-today"

export interface ResumenViewProps {
  session: Session
  scope: DashboardScope
  worksiteScope: WorksiteScope
  /** Faenas del alcance ya resueltas a ids: varias funciones exigen `string[]`. */
  worksiteIds: string[]
  currentYear: number
  /** Total de la cola, ya consultado por la página para la cabecera. */
  queueTotal: number
  /** Resumen de la cola: alimenta las alertas del bloque "Hoy". */
  queueSummary: OperationalQueueResult["summary"]
  /** Las filas más urgentes de la cola, ya elegidas por la página (`pickTodayItems`). */
  todayItems: TodayItem[]
}

/** Movimientos que se piden a la bitácora para poder agrupar los repetidos. */
const ACTIVITY_FETCH_LIMIT = 24
/** Grupos que caben en el panel de "Actividad reciente". */
const ACTIVITY_GROUP_LIMIT = 6

/**
 * Vista de entrada: lo transversal, no un dominio. **"Hoy" arriba, panorama
 * abajo.**
 *
 * Hoy: las alertas accionables y las filas más urgentes de la cola, con un
 * enlace a `/pendientes`. Panorama: un KPI por ranura semántica (dinero ·
 * cumplimiento · riesgo), los gráficos, el flujo del período y el backlog
 * comparado. Los dominios completos viven cada uno en "Por área".
 */
export async function ResumenView({
  session,
  scope,
  worksiteScope,
  worksiteIds,
  currentYear,
  queueTotal,
  queueSummary,
  todayItems,
}: ResumenViewProps) {
  const canApprove = can(session, "approvals:approve")
  const canViewWork = can(session, "operations:view_work")
  const canViewRequests = can(session, "requests:view_own") || can(session, "requests:view_all")
  const canViewPurchasing = can(session, "purchasing:view")
  const canReceive = can(session, "receiving:view")
  const canDeliver = can(session, "deliveries:create")
  const canViewEpp = can(session, "prevention:epp:view")
  const canViewPdtp = can(session, "prevention:pdtp:view")
  const canViewCapa = can(session, "prevention:capa:view")
  const canViewIncidents = can(session, "prevention:incidents:view")
  const canManagePdtp = can(session, "prevention:pdtp:program:manage")
  // PREV-C03.7: el PDTP del resumen es el del año operativo, no el civil.
  const pdtpYear = canViewPdtp
    ? (await getPdtpOperationalYears().catch(() => null))?.primary ?? currentYear
    : currentYear
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
    data, activity, eppGapsCount, periodMetrics, backlogComparisons, snapshotHistory,
    pdtpSummary, activeProgram, allPrograms, capaCounts, incidentCounts, trend,
  ] = await Promise.all([
    getDashboardData(session, scopedWorksite),
    // 24 y no 6: el panel muestra hasta 6 **grupos**, y una carga masiva de un
    // mismo movimiento se come los seis renglones si se pide sólo esa cantidad.
    listOperationalActivity(session, ACTIVITY_FETCH_LIMIT),
    canViewEpp
      ? optionalBlock("brechas de EPP", listEppCoverageGaps({ userId: session.user.id, scope: worksiteScope, permissions: session.user.permissions })
          .then((gaps) => gaps.filter((gap) => gap.enforcement === "blocking").length), 0)
      : Promise.resolve(0),
    getOperationalPeriodMetrics(session, { period: scope.period, worksiteId: scopedWorksite }),
    optionalBlock("comparativas de backlog", getOperationalBacklogComparisons(session, new Date(), scopedWorksite), []),
    optionalBlock("histórico de indicadores", getOperationalSnapshotHistory(session, 30, new Date(), scopedWorksite), { backlog_requests: [], backlog_orders: [], backlog_capa: [], backlog_pdtp: [] }),
    /*
     * DASH-003: cada bloque opcional se degrada por su cuenta. Antes, un fallo
     * de PDTP —una columna que faltaba en una base desincronizada— rechazaba
     * este `Promise.all` y reemplazaba el tablero entero por el límite de error.
     */
    canViewPdtp
      ? optionalBlock("cumplimiento PDTP", loadPdtpComplianceSummary(worksiteIds), null)
      : Promise.resolve(null),
    canViewPdtp ? optionalBlock("programa PDTP vigente", getActivePdtpProgram(pdtpYear), null) : Promise.resolve(null),
    canViewPdtp ? optionalBlock("programas PDTP", listPdtpPrograms(), []) : Promise.resolve([]),
    // Las dos alimentan la ranura de Riesgo. Ambas hacen `requirePermission`
    // adentro, así que el gate va afuera y no en un `catch`.
    canViewCapa
      ? optionalBlock("acciones correctivas", getCapaDashboardCounts({ scope: worksiteScope, permissions: session.user.permissions }), { open: 0, overdue: 0, pendingVerification: 0, unreconciled: 0, immediateStop: 0 })
      : Promise.resolve({ open: 0, overdue: 0, pendingVerification: 0, unreconciled: 0 }),
    canViewIncidents
      ? optionalBlock("incidentes", getIncidentDashboardCounts({ ctx: { userId: session.user.id }, scope: worksiteScope, permissions: session.user.permissions }), { totalOpen: 0, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 })
      : Promise.resolve({ totalOpen: 0, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 }),
    // Transversal, no de un dominio: solicitudes, OC y recepciones en la misma
    // tendencia son el pulso de la operación completa.
    canSeeAnyTrend
      ? optionalBlock("tendencia operativa", getOperationalTrendHistory(session, 6, new Date(), scopedWorksite), [])
      : Promise.resolve([]),
  ])

  const hasNextYearProgram = allPrograms.some((p) => p.year === pdtpYear + 1)
  const shouldSuggestNextYear = activeProgram && !hasNextYearProgram && canManagePdtp

  const activeOrdersComparison = backlogComparisons.find((entry) => entry.metric === "backlog_orders")
  const metrics = buildOperationalMetrics({
    scope,
    ordersPendingReceipt: data.metrics.orders_pending_receipt,
    activeOrders: activeOrdersComparison?.current ?? 0,
    activeOrdersPrevious: activeOrdersComparison?.previous ?? null,
    activeOrdersSnapshotDate: activeOrdersComparison?.snapshotDate ?? null,
    periodSpend: periodMetrics.spend.current,
    periodSpendPrevious: periodMetrics.spend.previous,
    periodOrders: periodMetrics.ordersIssued.current,
    pdtpPercent: pdtpSummary?.percent ?? null,
    pdtpTarget: pdtpSummary?.target ?? 0.9,
    openIncidents: incidentCounts.totalOpen,
    fatalOrSeriousIncidents: incidentCounts.fatalOrSerious,
    overdueCapa: capaCounts.overdue,
    canReceive,
    canViewPurchasing,
    canCreateOrder: can(session, "purchasing:create_order"),
    canViewPdtp,
    canViewIncidents,
    canViewCapa,
  })
  // Lo que ya es tile del panorama no se repite como alerta de "Hoy" (A5).
  const shownAsTile = new Set(metrics.map((metric) => metric.key))
  const alerts = buildOperationalAlerts({
    scope,
    shownAsTile,
    criticalTasks: queueSummary.critical,
    overdueTasks: queueSummary.overdue,
    blockedTasks: queueSummary.blocked,
    pendingApprovals: data.metrics.pending_approvals,
    ordersPendingReceipt: data.metrics.orders_pending_receipt,
    deliveries: queueSummary.moduleCounts.entregas ?? 0,
    eppGaps: eppGapsCount,
    overdueCapa: capaCounts.overdue,
    canApprove,
    canReceive,
    canDeliver,
    canViewEpp,
    canViewCapa,
  })

  // La tendencia sólo entra a la fila cuando va a dibujar algo: el gráfico se
  // oculta solo con las tres series en cero, y el ancho del medidor depende de si
  // hay tendencia (8+4 o 12). Misma condición que `OperationalTrendChart`.
  const trendData = trend.map((point) => ({
    month: point.month,
    requests: canSeeRequestVolume ? point.requests : 0,
    orders: canViewPurchasing ? point.orders : 0,
    receipts: canReceive ? point.receipts : 0,
  }))
  const hasTrend = trendData.some((point) => point.requests + point.orders + point.receipts > 0)

  const pdtpTitle = "Cumplimiento PDTP"
  const pdtpDescription = `Avance acreditado · año ${pdtpYear}`

  return (
    <DashboardResumenBody
      scope={scope}
      metrics={metrics}
      alerts={alerts}
      todayItems={canViewWork ? todayItems : []}
      pendingTotal={queueTotal}
      pendientesHref={pendientesHref(scope)}
      queueVisible={canViewWork}
      periodSummary={buildOperationalPeriodSummary({ periodMetrics, scope, canViewRequests, canViewPurchasing, canReceive, canDeliver })}
      backlogSummary={buildOperationalBacklogSummary({ backlogComparisons, snapshotHistory, scope, canViewRequests, canViewPurchasing, canViewCapa, canViewPdtp })}
      /* Dos lecturas transversales, no un dominio: el pulso de la operación y el
         cumplimiento anual contra su meta. El detalle del PDTP —por faena, por
         actividad— vive en la pestaña de Prevención; A5 impide que la misma cifra
         tenga dos representaciones acá. */
      trendSlot={hasTrend ? <OperationalTrendChart data={trendData} /> : undefined}
      gaugeSlot={
        /* `percent === null` es "sin acreditación todavía", no 0%: dibujar un
           medidor en cero afirmaría un incumplimiento que nadie midió. */
        canViewPdtp && pdtpSummary?.percent != null ? (
          // El medidor no tiene tooltip ni ejes interactivos, así que envolverlo
          // en el enlace no le roba ningún gesto: sigue siendo un indicador
          // accionable, como exige A1.
          <Link
            href="/prevencion/pdtp"
            className="block h-full transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]"
          >
            <ChartFrame
              title={pdtpTitle}
              description={pdtpDescription}
              aside={
                <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-primary)]">
                  Detalle <ArrowRight size={13} weight="bold" aria-hidden />
                </span>
              }
            >
              {/* El medidor trabaja en 0-100; el resumen entrega fracciones. */}
              <RadialTickGauge
                percent={Math.round(pdtpSummary.percent * 100)}
                expectedPercent={pdtpSummary.expectedPercent === null ? null : Math.round(pdtpSummary.expectedPercent * 100)}
                targetPercent={Math.round(pdtpSummary.target * 100)}
              />
            </ChartFrame>
          </Link>
        ) : canViewPdtp ? (
          <ChartFrame title={pdtpTitle} description={pdtpDescription}>
            <EmptyState
              compact
              align="start"
              className="px-0 py-2"
              title={pdtpSummary
                ? `El programa ${pdtpYear} no tiene avance acreditado`
                : `No hay un programa activo para ${pdtpYear}`}
              description={pdtpSummary
                ? "El cumplimiento aparece cuando se acredite la primera actividad."
                : "Crea o activa un programa para visualizar el avance preventivo desde acá."}
              action={canManagePdtp && !pdtpSummary ? (
                <Button asChild size="sm">
                  <Link href="/prevencion/pdtp/nuevo">
                    <Plus size={13} />
                    {shouldSuggestNextYear ? `Preparar ${pdtpYear + 1}` : "Crear programa"}
                  </Link>
                </Button>
              ) : undefined}
            />
          </ChartFrame>
        ) : undefined
      }
      activitySlot={<RecentActivity groups={groupConsecutiveActivity(activity).slice(0, ACTIVITY_GROUP_LIMIT)} />}
    />
  )
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
  return `${difference > 0 ? "+" : ""}${Math.round(difference)} ${label}`
}

/**
 * Variación de un flujo del período contra el período anterior, para `<Delta>`.
 *
 * Solicitudes, OC emitidas, recepciones y entregas son **volúmenes**: que suban
 * no es bueno ni malo por sí solo (`neutral`), así que no se pintan de verde ni
 * de rojo. Sin período anterior comparable no hay variación (`null`): el texto
 * de respaldo ("Sin período comparable") la reemplaza.
 */
function periodDelta(metric: OperationalPeriodMetric, label: string): NonNullable<OperationalPeriodSummaryEntry["delta"]> {
  return {
    value: metric.previous === null ? null : metric.current - metric.previous,
    polarity: "neutral",
    format: "number",
    label,
  }
}

export function buildOperationalPeriodSummary(input: {
  periodMetrics: OperationalPeriodMetrics
  scope: DashboardScope
  canViewRequests: boolean
  canViewPurchasing: boolean
  canReceive: boolean
  canDeliver: boolean
  /** Sólo para fijar el rótulo "vs. sep" en las pruebas. */
  now?: Date
}): OperationalPeriodSummaryEntry[] {
  const compare = (metric: OperationalPeriodMetric) => periodComparison(metric, input.scope.period)
  const comparedTo = periodComparisonShortLabel(input.scope.period, input.now)
  const delta = (metric: OperationalPeriodMetric) => periodDelta(metric, comparedTo)
  const entries: Array<OperationalPeriodSummaryEntry | null> = [
    input.canViewRequests ? { key: "requests", label: "Solicitudes creadas", value: input.periodMetrics.requests.current, comparison: compare(input.periodMetrics.requests), delta: delta(input.periodMetrics.requests), href: periodWindowHref(input.scope, "/solicitudes") } : null,
    input.canViewPurchasing ? { key: "orders", label: ORDERS_ISSUED_METRIC.label, hint: ORDERS_ISSUED_METRIC.glossary, value: input.periodMetrics.ordersIssued.current, comparison: compare(input.periodMetrics.ordersIssued), delta: delta(input.periodMetrics.ordersIssued), href: periodWindowHref(input.scope, "/compras") } : null,
    input.canReceive ? { key: "receipts", label: "Recepciones", value: input.periodMetrics.receipts.current, comparison: compare(input.periodMetrics.receipts), delta: delta(input.periodMetrics.receipts), href: "/recepcion" } : null,
    input.canDeliver ? { key: "deliveries", label: "Entregas", value: input.periodMetrics.deliveries.current, comparison: compare(input.periodMetrics.deliveries), delta: delta(input.periodMetrics.deliveries), href: "/entregas" } : null,
    // El gasto en OC **no** va acá: ya es un tile del panorama (A5). Estaba en
    // el tile del hero y otra vez en esta lista, la misma cifra dos veces.
  ]
  return entries.filter((entry): entry is OperationalPeriodSummaryEntry => entry !== null)
}

/** "vs. 07-09": el corte mensual contra el que se compara el backlog, sin el año. */
function snapshotComparisonLabel(snapshotDate: string) {
  return `vs. ${formatDate(snapshotDate).slice(0, 5)}`
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

export function buildOperationalBacklogSummary(input: {
  backlogComparisons: OperationalBacklogComparison[]
  snapshotHistory: Record<OperationalSnapshotMetric, number[]>
  scope: DashboardScope
  canViewRequests: boolean
  canViewPurchasing: boolean
  canViewCapa: boolean
  canViewPdtp: boolean
}): OperationalPeriodSummaryEntry[] {
  const byMetric = new Map(input.backlogComparisons.map((comparison) => [comparison.metric, comparison]))
  const entry = (metric: OperationalBacklogComparison["metric"], label: string, href: string, hint?: string): OperationalPeriodSummaryEntry | null => {
    const comparison = byMetric.get(metric)
    return comparison
      ? {
          key: metric, label, value: comparison.current, comparison: backlogComparison(comparison), href, hint,
          sparkline: input.snapshotHistory[metric],
          // Backlog que sube es atraso que se acumula: `up-bad`. Sin corte
          // mensual previo no hay variación y se queda el texto de respaldo.
          delta: {
            value: comparison.previous === null || !comparison.snapshotDate ? null : comparison.current - comparison.previous,
            polarity: "up-bad",
            format: "number",
            label: comparison.snapshotDate ? snapshotComparisonLabel(comparison.snapshotDate) : undefined,
          },
        }
      : null
  }
  const href = (module: string) => pendientesHref(input.scope, { module })
  const entries: Array<OperationalPeriodSummaryEntry | null> = [
    input.canViewRequests ? entry("backlog_requests", "Solicitudes activas", href("solicitudes")) : null,
    input.canViewPurchasing ? entry("backlog_orders", "OC activas", href("compras")) : null,
    input.canViewCapa ? entry("backlog_capa", "CAPA abiertas", href("capa"), DASHBOARD_GLOSSARY.CAPA) : null,
    input.canViewPdtp ? entry("backlog_pdtp", "Obligaciones PDTP", href("pdtp"), DASHBOARD_GLOSSARY.PDTP) : null,
  ]
  return entries.filter((entry): entry is OperationalPeriodSummaryEntry => entry !== null)
}

/**
 * Los tiles accionables del panorama, uno por **ranura semántica**: dinero,
 * cumplimiento y riesgo.
 *
 * La ranura de **trabajo propio** (tareas vencidas · por aprobar · tareas
 * pendientes) se fue: esa urgencia es el bloque "Hoy" —que va antes en la
 * página— y su alerta, su lista y su enlace a `/pendientes`. Dejarla acá
 * repetía la misma cifra dos veces en una pantalla (A5).
 *
 * Antes era una lista de 8 candidatos en orden fijo cortada con `.slice(0, 4)`.
 * Para Jefatura eso entregaba **siempre** "Tareas pendientes · críticas ·
 * vencidas · Por aprobar" —tres de cuatro del mismo eje, cero cifras de
 * negocio— y dejaba "Inversión del mes" (candidato 8) y "Stock crítico" (7)
 * fuera **para todos los roles**: eran código inalcanzable, con sparkline
 * incluido.
 *
 * Cada ranura es una cascada: se muestra el primer candidato que el permiso
 * autoriza. Si ninguno califica, la ranura se cede y la fila queda con menos
 * tiles en vez de rellenarse con otro contador de tareas.
 *
 * Cada tile cambia su descripción en 0 (A1). La regla pide "la acción para dejar
 * de estarlo", pero estos contadores en cero son buenas noticias y no hay acción
 * que tomar: la copia correcta es confirmarlo, no inventar un CTA. La regla
 * apunta a tiles vacíos por falta de configuración, no a contadores en cero.
 */
/**
 * Variación porcentual de `current` contra `previous`, a un decimal. `null` si
 * no hay con qué comparar —sin período anterior, o con uno en cero, donde un
 * porcentaje no está definido—: una tendencia que no existe no se dibuja.
 */
function percentChange(current: number, previous: number | null | undefined) {
  if (previous === null || previous === undefined || previous === 0) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

/** "este mes" / "este trimestre" / "este año": completa "Sin OC emitidas …". */
const PERIOD_PHRASE: Record<OperationalPeriodSpan, string> = {
  mes: "este mes",
  trimestre: "este trimestre",
  anio: "este año",
}

export function buildOperationalMetrics(input: {
  scope: DashboardScope
  ordersPendingReceipt: number
  activeOrders: number
  /** Backlog de OC del último corte mensual; `null` sin corte comparable. */
  activeOrdersPrevious?: number | null
  /** Fecha del corte contra el que se compara `activeOrders` ("YYYY-MM-DD"). */
  activeOrdersSnapshotDate?: string | null
  periodSpend: number
  /** Gasto del período anterior; `null` sin período comparable. */
  periodSpendPrevious?: number | null
  /** OC emitidas en el período. Sin él, "sin OC" se deduce de un gasto en cero. */
  periodOrders?: number
  pdtpPercent: number | null
  pdtpTarget: number
  openIncidents: number
  fatalOrSeriousIncidents: number
  overdueCapa: number
  canReceive: boolean
  canViewPurchasing: boolean
  /** `purchasing:create_order`: sin él el tile vacío no ofrece "Emitir una OC". */
  canCreateOrder?: boolean
  canViewPdtp: boolean
  canViewIncidents: boolean
  canViewCapa: boolean
  /** Sólo para fijar el rótulo "vs. sep" en las pruebas. */
  now?: Date
}): DashboardMetric[] {
  const periodLabel = periodScopeLabel(input.scope.period).toLocaleLowerCase("es-CL")
  const href = (params?: Record<string, string>) => pendientesHref(input.scope, params)

  // Sin OC emitidas el tile no pinta "$0": dice qué pasa y, con permiso para
  // crearlas, cómo dejar de estar vacío (A1).
  const noOrders = (input.periodOrders ?? input.periodSpend) === 0
  const canStartOrder = noOrders && input.canCreateOrder === true

  const money: Array<DashboardMetric | null> = [
    input.canViewPurchasing ? { key: "spend", label: ORDERS_SPEND_METRIC.label, glossary: ORDERS_SPEND_METRIC.glossary, value: formatCLP(input.periodSpend),
      description: `${ORDERS_ISSUED_METRIC.label} · ${periodLabel}`, icon: "investment",
      href: canStartOrder ? "/compras/nueva" : periodWindowHref(input.scope, "/compras"),
      // Una variación de dinero que sube es MALA noticia (`up-bad`); contra el
      // período anterior, en porcentaje. Sin período anterior comparable, nada.
      trend: percentChange(input.periodSpend, input.periodSpendPrevious),
      trendPolarity: ORDERS_SPEND_TREND_POLARITY,
      trendFormat: "percent",
      trendLabel: periodComparisonShortLabel(input.scope.period, input.now),
      empty: noOrders
        ? { message: `Sin OC emitidas ${PERIOD_PHRASE[input.scope.period]}`, actionLabel: canStartOrder ? "Emitir una OC" : undefined }
        : undefined,
    } : null,
    input.canViewPurchasing ? {
      key: "orders", label: "OC activas", value: input.activeOrders,
      description: input.activeOrders > 0 ? "Órdenes en curso sin cerrar" : "Sin órdenes en curso",
      icon: "investment", href: href({ module: "compras" }),
      // Backlog: contra el último corte mensual, en unidades, y subir es atraso.
      trend: input.activeOrdersPrevious === null || input.activeOrdersPrevious === undefined || !input.activeOrdersSnapshotDate
        ? null
        : input.activeOrders - input.activeOrdersPrevious,
      trendPolarity: "up-bad",
      trendFormat: "number",
      trendLabel: input.activeOrdersSnapshotDate ? snapshotComparisonLabel(input.activeOrdersSnapshotDate) : undefined,
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
      // Nombre canónico (ADQ-10, `state-badge.tsx`): lo que espera al proveedor
      // es "Pendiente de recepción". "Por recibir" era uno de sus siete nombres
      // y "Por atender" es la cola de Recepción, otra cosa.
      key: "receipts", label: "Pendiente de recepción", value: input.ordersPendingReceipt,
      description: input.ordersPendingReceipt > 0 ? "Órdenes enviadas que aún no llegan" : "Ninguna orden a la espera",
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
      key: "capa", label: "CAPA vencidas", glossary: DASHBOARD_GLOSSARY.CAPA, value: input.overdueCapa,
      description: input.overdueCapa > 0 ? "Acciones correctivas fuera de plazo" : "Ninguna fuera de plazo",
      icon: "critical", href: href({ module: "capa" }),
      tone: input.overdueCapa > 0 ? "danger" : "neutral",
    } : null,
  ]

  return [money, compliance, risk]
    .map((cascade) => cascade.find((metric): metric is DashboardMetric => metric !== null))
    .filter((metric): metric is DashboardMetric => metric !== undefined)
}

/**
 * Alertas del bloque "Hoy" ("Requiere atención"): **lo que no es tile**.
 *
 * Regla A5: una cifra no puede ser tile y alerta a la vez. Antes "críticas",
 * "vencidas", "por aprobar", "stock" y "recepciones" aparecían en las dos partes
 * de la pantalla —y "críticas" además en el saludo y en su chip de atajo, cuatro
 * veces la misma cifra—. `shownAsTile` recibe las claves que el panorama ya
 * ocupó y las salta acá.
 *
 * Sin la alerta de "tareas asignables sin responsable": el sistema de
 * asignación se retira de la plataforma y Inicio ya no depende de
 * `summary.unassigned`.
 */
export function buildOperationalAlerts(input: {
  scope: DashboardScope
  shownAsTile: ReadonlySet<string>
  criticalTasks: number
  overdueTasks: number
  blockedTasks: number
  pendingApprovals: number
  ordersPendingReceipt: number
  deliveries: number
  eppGaps: number
  overdueCapa: number
  canApprove: boolean
  canReceive: boolean
  canDeliver: boolean
  canViewEpp: boolean
  canViewCapa: boolean
}): DashboardAlert[] {
  const href = (params?: Record<string, string>) => pendientesHref(input.scope, params)
  const alerts: Array<DashboardAlert | null> = [
    input.criticalTasks > 0 ? { key: "critical", title: pluralize(input.criticalTasks, "tarea crítica", "tareas críticas"), description: "Están marcadas como críticas en tus pendientes.", count: input.criticalTasks, severity: "critical", href: href({ quick: "critical" }) } : null,
    input.overdueTasks > 0 ? { key: "overdue", title: pluralize(input.overdueTasks, "tarea vencida", "tareas vencidas"), description: "Ya pasó su fecha de vencimiento.", count: input.overdueTasks, severity: "critical", href: href({ quick: "overdue" }) } : null,
    input.blockedTasks > 0 ? { key: "blocked", title: pluralize(input.blockedTasks, "proceso bloqueado", "procesos bloqueados"), description: "Hay una observación o detención que resolver antes de seguir.", count: input.blockedTasks, severity: "warning", href: href({ quick: "blocked" }) } : null,
    input.canViewCapa && input.overdueCapa > 0 ? { key: "capa", title: pluralize(input.overdueCapa, "acción correctiva vencida", "acciones correctivas vencidas"), description: "Ya pasó el plazo de cierre comprometido.", count: input.overdueCapa, severity: "critical", href: href({ module: "capa" }) } : null,
    input.canApprove && input.pendingApprovals > 0 ? { key: "approvals", title: pluralize(input.pendingApprovals, "ítem espera aprobación", "ítems esperan aprobación"), description: "Tu decisión desbloquea el siguiente paso de la compra.", count: input.pendingApprovals, severity: "warning", href: href({ module: "aprobaciones" }) } : null,
    input.canReceive && input.ordersPendingReceipt > 0 ? { key: "receipts", title: pluralize(input.ordersPendingReceipt, "orden pendiente de recepción", "órdenes pendientes de recepción"), description: "Registra la llegada para que la compra pueda avanzar.", count: input.ordersPendingReceipt, severity: "warning", href: href({ module: "recepciones" }) } : null,
    input.canDeliver && input.deliveries > 0 ? { key: "deliveries", title: pluralize(input.deliveries, "entrega por registrar", "entregas por registrar"), description: "Hay ítems en stock listos para entregar a trabajadores.", count: input.deliveries, severity: "info", href: href({ module: "entregas" }) } : null,
    input.canViewEpp && input.eppGaps > 0 ? { key: "epp", title: pluralize(input.eppGaps, "brecha preventiva de EPP", "brechas preventivas de EPP"), description: "Hay trabajadores sin el EPP que su cargo exige.", count: input.eppGaps, severity: "warning", href: "/prevencion/epp-preventivo" } : null,
  ]

  return alerts.filter((alert): alert is DashboardAlert => alert !== null && !input.shownAsTile.has(alert.key))
}
