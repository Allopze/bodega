import type { Metadata } from "next"
import type { Session } from "next-auth"
import type { ComponentType } from "react"
import Link from "next/link"
import { auth } from "@/lib/auth/auth"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { MetricBar } from "./metric-bar"
import { QuickActions } from "./quick-actions"
import { RecentActivity } from "./recent-activity"
import { db } from "@/db"
import {
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  suppliers,
  worksiteStock,
  worksites,
} from "@/db/schema"
import { and, count, desc, eq, inArray, sql } from "drizzle-orm"
import { can, isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"
import type { Permission } from "@/modules/permissions"
import { cn, formatCLP } from "@/lib/utils"
import {
  ArrowRight,
  CheckCircle,
  CheckSquare,
  ClipboardText,
  ShoppingCart,
  Truck,
  Warehouse,
} from "@phosphor-icons/react/dist/ssr"
import {
  buildWorkTasks,
  type WorkActor,
  type WorkItemRow,
  type WorkOrderRow,
  type WorkPriority,
  type WorkQueueSnapshot,
  type WorkRequestRow,
  type WorkTask,
  type WorkTaskType,
} from "@/lib/work-queue"
import { getCriticalStockAlertCount } from "@/lib/services/stock-alerts"

export const metadata: Metadata = { title: "Dashboard" }

type MetricKey =
  | "my_requests"
  | "pending_approvals"
  | "approved_without_oc"
  | "orders_in_progress"
  | "orders_pending_receipt"

type IconComponent = ComponentType<{ size: number; className?: string }>

const TASK_ICON: Record<WorkTaskType, IconComponent> = {
  request_followup:  ClipboardText,
  approval:          CheckSquare,
  purchase:          ShoppingCart,
  purchase_order:    ShoppingCart,
  receipt:           Truck,
  warehouse_delivery:Warehouse,
}

const PRIORITY_LABEL: Record<WorkPriority, string> = {
  critical: "Crítica",
  high:     "Alta",
  normal:   "Normal",
  low:      "Baja",
}

const TASK_TYPE_LABEL: Record<WorkTaskType, string> = {
  request_followup:   "Solicitud",
  approval:           "Aprobación",
  purchase:           "Compra",
  purchase_order:     "OC",
  receipt:            "Recepción",
  warehouse_delivery: "Entrega",
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value))
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session) return null

  const [data, snapshot] = await Promise.all([
    getDashboardData(session),
    getWorkQueueSnapshot(session),
  ])
  const tasks = buildWorkTasks(buildActor(session), snapshot)
  const visibleTasks = tasks.slice(0, 12)
  const stockAlertCount = await getCriticalStockAlertCount()
  const criticalTaskCount = tasks.filter((task) => task.priority === "critical").length
  const deliveryTaskCount = tasks.filter((task) => task.type === "warehouse_delivery").length
  const maxWorksiteCost = Math.max(...data.worksitesBreakdown.map((row) => row.totalCost), 1)

  const approvalRate = data.summary.totalRequests > 0
    ? Math.round((data.summary.approvedRequests / data.summary.totalRequests) * 100)
    : 0

  const firstName = session.user.name?.split(" ")[0] ?? "usuario"

  const signalDefs: Array<HeaderSignal & { perm: Permission }> = [
    { key: "approvals", label: "Por aprobar",   value: data.metrics.pending_approvals,      href: "/aprobaciones",  tone: "signal", perm: "approvals:approve" },
    { key: "no-oc",     label: "Sin OC",        value: data.metrics.approved_without_oc,    href: "/compras/nueva", tone: "signal", perm: "purchasing:create_order" },
    { key: "receive",   label: "Por recibir",   value: data.metrics.orders_pending_receipt, href: "/recepcion",                     perm: "receiving:view" },
    { key: "stock",     label: "Alertas stock", value: stockAlertCount,                     href: "/bodega",        tone: "signal", perm: "warehouse:view_stock" },
  ]
  const headerSignals: HeaderSignal[] = signalDefs.filter((s) => can(session, s.perm))

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        headerActions={<HeaderSignals signals={headerSignals} />}
      />
      <div className="animate-in fade-in duration-[var(--duration-default)]">

      {/* ── Cabecera: saludo + estado ── */}
      <header>
        <p className="text-eyebrow">Tablero</p>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-h1 text-[var(--color-text)]">Hola, {firstName}</h1>
            {tasks.length > 0 ? (
              <p className="mt-2 text-h2 text-[var(--color-text)]">
                Tienes{" "}
                <span className="text-[var(--color-primary)]">{tasks.length}</span>{" "}
                {tasks.length === 1 ? "tarea pendiente" : "tareas pendientes"} hoy.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="inline-flex items-center gap-2 text-display text-[var(--color-text)]">
                  <CheckCircle size={20} weight="fill" className="text-[var(--color-primary)]" />
                  Todo al día.
                </span>
                <span className="text-sub">Sin pendientes por ahora.</span>
              </div>
            )}
          </div>
          {tasks.length > 0 && (
            <Link
              href="/aprobaciones"
              data-pressable
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-2 self-start rounded-[var(--radius)] px-4 sm:self-end",
                "bg-[var(--color-primary)] text-[13px] font-semibold text-white",
                "transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-strong)]",
              )}
            >
              Ver tareas
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </header>

      {/* ── Tira de métricas (editorial, sin cajas, por permiso) ── */}
      <div className="mt-6">
        <MetricBar
          session={session}
          pendingTasks={tasks.length}
          criticalTasks={criticalTaskCount}
          pendingApprovals={data.metrics.pending_approvals}
          approvedWithoutOc={data.metrics.approved_without_oc}
          ordersPendingReceipt={data.metrics.orders_pending_receipt}
          deliveryTasks={deliveryTaskCount}
          stockAlerts={stockAlertCount}
          totalCosts={data.summary.totalCosts}
          approvalRate={approvalRate}
        />
      </div>

      {/* ── Accesos rápidos (toolbar de pills, por rol) ── */}
      <div className="mt-4">
        <QuickActions session={session} />
      </div>

      {/* ── Trabajo: cola con tareas, o actividad reciente sin pendientes ── */}
      {visibleTasks.length > 0 ? (
        <section className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-h2 text-[var(--color-text)]">Cola de trabajo</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {tasks.length} {tasks.length === 1 ? "tarea" : "tareas"}
            </p>
          </div>
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {visibleTasks.map((task, i) => (
              <li key={task.id}>
                <TaskRow task={task} index={i} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="mt-8">
          <RecentActivity
            requests={snapshot.requests}
            orders={snapshot.orders}
            viewerId={session.user.id}
            canViewAll={can(session, "requests:view_all")}
          />
        </div>
      )}

      {/* ── Actividad por faena ── */}
      {data.worksitesBreakdown.length > 0 && (
        <section className="mt-8">
          <h2 className="text-h2 text-[var(--color-text)] mb-3">Actividad por faena</h2>
          <div className="overflow-x-auto border-y border-[var(--color-border)]">
              <table className="w-full border-collapse text-left text-[13px]" aria-label="Actividad y costos por faena">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                    <th scope="col" className="px-5 py-3 font-semibold text-xs uppercase tracking-wider">Faena</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wider">Solicitudes</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wider">Pendientes</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wider">Aprobadas</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wider">Total OC</th>
                  </tr>
                </thead>
                <tbody>
                  {data.worksitesBreakdown.map((row, i) => (
                    <tr key={row.id} className={cn(
                      "transition-colors hover:bg-[var(--color-surface-2)]",
                      i > 0 && "border-t border-[var(--color-border)]",
                    )}>
                      <td className="px-5 py-3 font-medium text-[var(--color-text)]">{row.name}</td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums text-[var(--color-text-muted)]">{row.requestsCount}</td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums">
                        {row.pendingCount > 0
                          ? <span className="font-semibold text-[var(--color-signal-ink)]">{row.pendingCount}</span>
                          : <span className="text-[var(--color-text-faint)]">0</span>}
                      </td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums text-[var(--color-text-muted)]">{row.approvedCount}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="ml-auto flex max-w-[15rem] flex-col items-end gap-1.5">
                          <span className="font-mono font-medium tabular-nums text-[var(--color-text)]">{formatCLP(row.totalCost)}</span>
                          <span className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]" aria-hidden>
                            <span
                              className="block h-full rounded-full bg-[var(--color-primary)]"
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
      )}
      </div>
    </PageContainer>
  )
}

function TaskRow({ task, index }: { task: WorkTask; index: number }) {
  const Icon = TASK_ICON[task.type]
  return (
    <Link
      href={task.href}
      className={cn(
        "group grid grid-cols-[2.25rem_1fr] gap-3 px-4 py-3 sm:grid-cols-[2.75rem_2.25rem_minmax(0,1fr)_8rem_8.5rem_auto] sm:items-center sm:px-5",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-surface-2)]",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
      )}
    >
      <span className="font-mono text-[11px] text-[var(--color-text-faint)] tabular-nums">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="hidden h-8 w-8 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] group-hover:bg-[var(--color-primary-tint)] group-hover:text-[var(--color-primary)] transition-colors duration-[var(--duration-fast)] sm:flex">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-[13.5px] font-semibold text-[var(--color-text)]">{task.title}</h3>
          <span className="sm:hidden"><PriorityTag priority={task.priority} /></span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{task.subtitle}</p>
      </div>
      <div className="hidden sm:block">
        <PriorityTag priority={task.priority} />
      </div>
      <div className="hidden min-w-0 sm:block">
        <p className="truncate text-xs font-medium text-[var(--color-text)]">
          {TASK_TYPE_LABEL[task.type]} · {task.statusLabel}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-subtle)]">{formatShortDate(task.createdAt)}</p>
      </div>
      <div className="col-start-2 flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] sm:col-start-auto sm:justify-end">
        {task.ctaLabel}
        <ArrowRight size={12} className="transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

function PriorityTag({ priority }: { priority: WorkPriority }) {
  if (priority === "critical") {
    return (
      <Badge variant="signal" size="sm" dot>
        {PRIORITY_LABEL[priority]}
      </Badge>
    )
  }
  if (priority === "high") {
    return (
      <Badge variant="warning" size="sm" dot>
        {PRIORITY_LABEL[priority]}
      </Badge>
    )
  }
  // Normal/baja también se muestran: una celda vacía no distingue
  // "sin prioridad" de "prioridad normal".
  return (
    <Badge variant="default" size="sm">
      {PRIORITY_LABEL[priority]}
    </Badge>
  )
}

function buildActor(session: Session): WorkActor {
  return {
    userId:      session.user.id,
    permissions: session.user.permissions,
    worksiteIds: session.user.worksiteIds,
    isGlobal:    isGlobalRole(session),
  }
}

const ACTIVE_REQUEST_STATUSES_SNAPSHOT = [
  "draft", "submitted", "in_review", "partially_approved",
  "approved", "returned", "in_purchasing",
]
const ACTIVE_ITEM_STATUSES_SNAPSHOT = [
  "requested", "approved", "pending_purchase",
  "received", "partially_delivered",
]
const ACTIVE_ORDER_STATUSES_SNAPSHOT = [
  "draft", "issued", "sent", "supplier_confirmed",
  "partially_office_received", "office_received", "partially_received",
]
const SNAPSHOT_LIMIT = 200

async function getWorkQueueSnapshot(session: Session): Promise<WorkQueueSnapshot> {
  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const requestWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`1 = 0`)
  const itemWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`1 = 0`)
  const orderWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`1 = 0`)

  const [
    requestRows,
    itemRows,
    orderRows,
    stockRows,
  ] = await Promise.all([
    db
      .select({
        id:           purchaseRequests.id,
        code:         purchaseRequests.code,
        worksiteId:   purchaseRequests.worksiteId,
        worksiteName: worksites.name,
        requesterId:  purchaseRequests.requesterId,
        status:       purchaseRequests.status,
        urgency:      purchaseRequests.urgency,
        createdAt:    purchaseRequests.createdAt,
        submittedAt:  purchaseRequests.submittedAt,
      })
      .from(purchaseRequests)
      .innerJoin(worksites, eq(purchaseRequests.worksiteId, worksites.id))
      .where(and(
        requestWorksiteFilter,
        inArray(purchaseRequests.status, ACTIVE_REQUEST_STATUSES_SNAPSHOT),
      ))
      .orderBy(desc(purchaseRequests.createdAt))
      .limit(SNAPSHOT_LIMIT),

    db
      .select({
        id:              purchaseRequestItems.id,
        requestId:       purchaseRequestItems.requestId,
        requestCode:     purchaseRequests.code,
        worksiteId:      purchaseRequests.worksiteId,
        worksiteName:    worksites.name,
        requesterId:     purchaseRequests.requesterId,
        productName:     products.name,
        productNameFree: purchaseRequestItems.productNameFree,
        productId:       purchaseRequestItems.productId,
        status:          purchaseRequestItems.status,
        urgency:         purchaseRequestItems.urgency,
        createdAt:       purchaseRequestItems.createdAt,
        quantity:        purchaseRequestItems.quantity,
        unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .innerJoin(worksites, eq(purchaseRequests.worksiteId, worksites.id))
      .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
      .where(and(
        itemWorksiteFilter,
        inArray(purchaseRequestItems.status, ACTIVE_ITEM_STATUSES_SNAPSHOT),
      ))
      .limit(SNAPSHOT_LIMIT),

    db
      .select({
        id:           purchaseOrders.id,
        code:         purchaseOrders.code,
        worksiteId:   purchaseOrders.worksiteId,
        worksiteName: worksites.name,
        supplierName: suppliers.name,
        status:       purchaseOrders.status,
        createdAt:    purchaseOrders.createdAt,
        issuedAt:     purchaseOrders.issuedAt,
        sentAt:       purchaseOrders.sentAt,
        totalAmount:  purchaseOrders.totalAmount,
      })
      .from(purchaseOrders)
      .innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id))
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(and(
        orderWorksiteFilter,
        inArray(purchaseOrders.status, ACTIVE_ORDER_STATUSES_SNAPSHOT),
      ))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(SNAPSHOT_LIMIT),

    db
      .select({
        productId: worksiteStock.productId,
      })
      .from(worksiteStock)
      .where(sql`${worksiteStock.quantity} > 0`),
  ])

  const itemStatusesByRequest = new Map<string, string[]>()
  for (const item of itemRows) {
    const statuses = itemStatusesByRequest.get(item.requestId) ?? []
    statuses.push(item.status)
    itemStatusesByRequest.set(item.requestId, statuses)
  }

  const itemCountByRequest = new Map<string, number>()
  for (const item of itemRows) {
    itemCountByRequest.set(item.requestId, (itemCountByRequest.get(item.requestId) ?? 0) + 1)
  }

  const stockProductIds = new Set(stockRows.map((row) => row.productId))

  // Load order item counts only for visible orders
  const orderIds = orderRows.map((o) => o.id)
  const orderItemCounts = orderIds.length > 0
    ? await db
        .select({
          purchaseOrderId: purchaseOrderItems.purchaseOrderId,
          total:           count(),
        })
        .from(purchaseOrderItems)
        .where(inArray(purchaseOrderItems.purchaseOrderId, orderIds))
        .groupBy(purchaseOrderItems.purchaseOrderId)
    : []

  const orderItemCountMap = new Map(orderItemCounts.map((row) => [row.purchaseOrderId, row.total]))

  const requests: WorkRequestRow[] = requestRows.map((request) => ({
    ...request,
    itemCount:    itemCountByRequest.get(request.id) ?? 0,
    itemStatuses: itemStatusesByRequest.get(request.id) ?? [],
  }))

  const items: WorkItemRow[] = itemRows.map((item) => ({
    id:            item.id,
    requestId:     item.requestId,
    requestCode:   item.requestCode,
    worksiteId:    item.worksiteId,
    worksiteName:  item.worksiteName,
    requesterId:   item.requesterId,
    productName:   item.productName ?? item.productNameFree ?? "Ítem solicitado",
    status:        item.status,
    urgency:       item.urgency,
    createdAt:     item.createdAt,
    quantity:      item.quantity,
    unitOfMeasure: item.unitOfMeasure,
    hasStock:      item.productId ? stockProductIds.has(item.productId) : false,
  }))

  const orders: WorkOrderRow[] = orderRows.map((order) => ({
    ...order,
    itemCount:       orderItemCountMap.get(order.id) ?? 0,
  }))

  return { requests, items, orders }
}

async function getDashboardData(session: Session) {
  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const requestWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`1 = 0`)
  const itemWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`1 = 0`)
  const orderWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`1 = 0`)
  const worksiteRowsFilter = isGlobal ? eq(worksites.isActive, true) : (wsIds.length > 0 ? and(eq(worksites.isActive, true), inArray(worksites.id, wsIds)) : sql`1 = 0`)

  // SQL-level aggregations for metrics
  const [
    [myRequestsRow],
    [pendingApprovalsRow],
    [approvedWithoutOcRow],
    [ordersInProgressRow],
    [ordersPendingReceiptRow],
    [totalCostsRow],
    [totalRequestsRow],
    [approvedRequestsRow],
    worksiteBreakdownRows,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(purchaseRequests)
      .where(and(
        requestWorksiteFilter,
        eq(purchaseRequests.requesterId, session.user.id),
        sql`${purchaseRequests.status} != 'cancelled'`,
      )),

    db
      .select({ n: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(and(
        itemWorksiteFilter,
        eq(purchaseRequestItems.status, "requested"),
      )),

    db
      .select({ n: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(and(
        itemWorksiteFilter,
        sql`${purchaseRequestItems.status} IN ('approved', 'pending_purchase')`,
      )),

    db
      .select({ n: count() })
      .from(purchaseOrders)
      .where(and(
        orderWorksiteFilter,
        sql`${purchaseOrders.status} IN ('issued', 'sent', 'supplier_confirmed', 'partially_office_received', 'office_received', 'partially_received')`,
      )),

    db
      .select({ n: count() })
      .from(purchaseOrders)
      .where(and(
        orderWorksiteFilter,
        sql`${purchaseOrders.status} IN ('sent', 'partially_office_received', 'office_received', 'partially_received')`,
      )),

    db
      .select({ n: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` })
      .from(purchaseOrders)
      .where(and(
        orderWorksiteFilter,
        sql`${purchaseOrders.status} NOT IN ('cancelled', 'draft')`,
      )),

    db
      .select({ n: count() })
      .from(purchaseRequests)
      .where(requestWorksiteFilter),

    db
      .select({ n: count() })
      .from(purchaseRequests)
      .where(and(
        requestWorksiteFilter,
        sql`${purchaseRequests.status} IN ('approved', 'closed', 'in_purchasing')`,
      )),

    // Worksites breakdown — aggregated in SQL
    db
      .select({
        id:             worksites.id,
        name:           worksites.name,
        requestsCount:  count(purchaseRequests.id),
      })
      .from(worksites)
      .leftJoin(purchaseRequests, eq(purchaseRequests.worksiteId, worksites.id))
      .where(and(
        worksiteRowsFilter,
        requestWorksiteFilter,
      ))
      .groupBy(worksites.id, worksites.name)
      .orderBy(desc(count(purchaseRequests.id))),
  ])

  const metrics: Record<MetricKey, number> = {
    my_requests:            myRequestsRow?.n ?? 0,
    pending_approvals:      pendingApprovalsRow?.n ?? 0,
    approved_without_oc:    approvedWithoutOcRow?.n ?? 0,
    orders_in_progress:     ordersInProgressRow?.n ?? 0,
    orders_pending_receipt: ordersPendingReceiptRow?.n ?? 0,
  }

  const totalCosts = totalCostsRow?.n ?? 0
  const totalRequests = totalRequestsRow?.n ?? 0
  const approvedRequests = approvedRequestsRow?.n ?? 0

  // Enrich worksites breakdown with cost and status counts
  const worksiteIds = worksiteBreakdownRows.map((w) => w.id)
  const [orderCostRows, pendingItemRows, approvedRequestRows] = await Promise.all([
    worksiteIds.length > 0
      ? db
          .select({
            worksiteId: purchaseOrders.worksiteId,
            totalCost:  sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`,
          })
          .from(purchaseOrders)
          .where(and(
            inArray(purchaseOrders.worksiteId, worksiteIds),
            sql`${purchaseOrders.status} NOT IN ('cancelled', 'draft')`,
          ))
          .groupBy(purchaseOrders.worksiteId)
      : Promise.resolve([]),

    worksiteIds.length > 0
      ? db
          .select({
            worksiteId: purchaseRequests.worksiteId,
            n:          count(),
          })
          .from(purchaseRequestItems)
          .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
          .where(and(
            inArray(purchaseRequests.worksiteId, worksiteIds),
            eq(purchaseRequestItems.status, "requested"),
          ))
          .groupBy(purchaseRequests.worksiteId)
      : Promise.resolve([]),

    worksiteIds.length > 0
      ? db
          .select({
            worksiteId: purchaseRequests.worksiteId,
            n:          count(),
          })
          .from(purchaseRequests)
          .where(and(
            inArray(purchaseRequests.worksiteId, worksiteIds),
            sql`${purchaseRequests.status} IN ('approved', 'closed', 'in_purchasing')`,
          ))
          .groupBy(purchaseRequests.worksiteId)
      : Promise.resolve([]),
  ])

  const costMap = new Map(orderCostRows.map((r) => [r.worksiteId, r.totalCost]))
  const pendingMap = new Map(pendingItemRows.map((r) => [r.worksiteId, r.n]))
  const approvedMap = new Map(approvedRequestRows.map((r) => [r.worksiteId, r.n]))

  const worksitesBreakdown = worksiteBreakdownRows
    .map((w) => ({
      id:            w.id,
      name:          w.name,
      requestsCount: w.requestsCount,
      pendingCount:  pendingMap.get(w.id) ?? 0,
      approvedCount: approvedMap.get(w.id) ?? 0,
      totalCost:     costMap.get(w.id) ?? 0,
    }))
    .filter((w) => w.requestsCount > 0 || w.totalCost > 0)
    .sort((a, b) => b.totalCost - a.totalCost)

  return {
    metrics,
    summary: {
      totalCosts,
      totalRequests,
      approvedRequests,
    },
    worksitesBreakdown,
  }
}
