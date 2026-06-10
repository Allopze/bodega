import type { Metadata } from "next"
import type { Session } from "next-auth"
import type { ComponentType } from "react"
import Link from "next/link"
import { auth } from "@/lib/auth/auth"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
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
import { and, count, eq, inArray, sql } from "drizzle-orm"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"
import { cn } from "@/lib/utils"
import {
  ArrowRight,
  CheckCircle,
  CheckSquare,
  ClipboardText,
  Coins,
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

function formatCLP(amount: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
  }).format(amount)
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
  const stockAlertCount = getCriticalStockAlertCount()

  const approvalRate = data.summary.totalRequests > 0
    ? Math.round((data.summary.approvedRequests / data.summary.totalRequests) * 100)
    : 0

  return (
    <div className="space-y-10 animate-in fade-in duration-[var(--duration-default)]">
      <PageHeader
        eyebrow="Tablero"
        title="Trabajo de hoy"
        description={`Hola, ${session.user.name?.split(" ")[0] ?? "usuario"}. Estas son las acciones que mantienen los pedidos avanzando.`}
      />

      {/* ── Tareas ── */}
      <section>
        <header className="flex items-baseline justify-between border-b border-[var(--color-border)] pb-2 mb-4">
          <div>
            <p className="text-eyebrow">01 — Pendientes</p>
            <h2 className="text-h2 mt-1">Tareas</h2>
          </div>
          <p className="font-mono text-xs text-[var(--color-text-muted)] tabular-nums">
            {tasks.length} {tasks.length === 1 ? "tarea" : "tareas"}
          </p>
        </header>

        {visibleTasks.length === 0 ? (
          <EmptyState
            icon={<CheckCircle size={22} />}
            title="Sin tareas pendientes"
            description="No hay aprobaciones, órdenes de compra, recepciones o entregas que requieran acción en este momento."
          />
        ) : (
          <ol className="border border-[var(--color-border)] divide-y divide-[var(--color-border)] bg-[var(--color-surface)]">
            {visibleTasks.map((task, i) => (
              <li key={task.id}>
                <TaskRow task={task} index={i} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── Indicadores ── */}
      <section>
        <header className="flex items-baseline justify-between border-b border-[var(--color-border)] pb-2 mb-4">
          <div>
            <p className="text-eyebrow">02 — Indicadores</p>
            <h2 className="text-h2 mt-1">Resumen operativo</h2>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Carga, costos y alertas</p>
        </header>

        <dl className="grid grid-cols-1 md:grid-cols-3 border border-[var(--color-border)] divide-y md:divide-y-0 md:divide-x divide-[var(--color-border)] bg-[var(--color-surface)]">
          <MetricCell
            icon={Coins}
            label="Inversión en OC emitidas"
            value={formatCLP(data.summary.totalCosts)}
          />
          <MetricCell
            icon={ClipboardText}
            label="Solicitudes visibles"
            value={String(data.summary.totalRequests)}
          />
          <MetricCell
            icon={CheckCircle}
            label="Tasa de aprobación"
            value={`${approvalRate}%`}
          />
        </dl>

        <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 border border-[var(--color-border)] divide-x divide-[var(--color-border)] bg-[var(--color-surface)]">
          <QuickLink href="/aprobaciones" label="Pendientes de aprobación" value={data.metrics.pending_approvals} />
          <QuickLink href="/compras/nueva" label="Aprobados sin OC" value={data.metrics.approved_without_oc} />
          <QuickLink href="/recepcion" label="OC por recibir" value={data.metrics.orders_pending_receipt} />
          <QuickLink href="/bodega" label="Alertas de stock" value={stockAlertCount} />
        </div>
      </section>

      {/* ── Faenas ── */}
      <section>
        <header className="flex items-baseline justify-between border-b border-[var(--color-border)] pb-2 mb-4">
          <div>
            <p className="text-eyebrow">03 — Faenas</p>
            <h2 className="text-h2 mt-1">Actividad y costos por faena</h2>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Ordenado por OC emitida</p>
        </header>

        {data.worksitesBreakdown.length === 0 ? (
          <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
            <p className="text-sm text-[var(--color-text-subtle)]">No hay actividad registrada en las faenas visibles.</p>
          </div>
        ) : (
          <div className="border border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]" aria-label="Actividad y costos por faena">
              <thead>
                <tr className="border-b border-[var(--color-border-strong)] text-[var(--color-text-muted)]">
                  <th scope="col" className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Faena</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium text-xs uppercase tracking-wider">Solicitudes</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium text-xs uppercase tracking-wider">Pendientes</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium text-xs uppercase tracking-wider">Aprobadas</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium text-xs uppercase tracking-wider">Total OC</th>
                </tr>
              </thead>
              <tbody>
                {data.worksitesBreakdown.map((row, i) => (
                  <tr key={row.id} className={cn(
                    "transition-colors hover:bg-[var(--color-surface-2)]",
                    i > 0 && "border-t border-[var(--color-border)]",
                  )}>
                    <td className="px-4 py-3 font-medium text-[var(--color-text)]">{row.name}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--color-text-muted)]">{row.requestsCount}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {row.pendingCount > 0
                        ? <span className="font-semibold text-[var(--color-signal-ink)]">{row.pendingCount}</span>
                        : <span className="text-[var(--color-text-faint)]">0</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--color-text-muted)]">{row.approvedCount}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-[var(--color-text)]">{formatCLP(row.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function TaskRow({ task, index }: { task: WorkTask; index: number }) {
  const Icon = TASK_ICON[task.type]
  return (
    <Link
      href={task.href}
      className={cn(
        "group grid grid-cols-[2.25rem_1fr_auto] md:grid-cols-[3rem_2.5rem_1fr_auto] items-center gap-3 px-4 py-3",
        "transition-colors hover:bg-[var(--color-surface-2)]",
      )}
    >
      <span className="font-mono text-[11px] text-[var(--color-text-faint)] tabular-nums">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="hidden md:flex h-8 w-8 items-center justify-center text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]">
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-[13.5px] font-semibold text-[var(--color-text)]">{task.title}</h3>
          <PriorityTag priority={task.priority} />
        </div>
        <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{task.subtitle}</p>
        <p className="mt-1 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-faint)]">
          {task.statusLabel} · {formatShortDate(task.createdAt)}
        </p>
      </div>
      <div className="hidden md:flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]">
        {task.ctaLabel}
        <ArrowRight size={12} className="transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

function PriorityTag({ priority }: { priority: WorkPriority }) {
  if (priority === "critical") {
    return (
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-signal-ink)]">
        ● {PRIORITY_LABEL[priority]}
      </span>
    )
  }
  if (priority === "high") {
    return (
      <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--color-warning-ink)]">
        ● {PRIORITY_LABEL[priority]}
      </span>
    )
  }
  return (
    <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-faint)]">
      ● {PRIORITY_LABEL[priority]}
    </span>
  )
}

function MetricCell({
  icon: Icon,
  label,
  value,
}: {
  icon: IconComponent
  label: string
  value: string
}) {
  return (
    <div className="px-5 py-5">
      <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
        <Icon size={14} />
        <p className="text-eyebrow">{label}</p>
      </div>
      <p className="mt-3 font-serif text-[1.75rem] leading-none font-medium text-[var(--color-text)] tracking-tight">
        {value}
      </p>
    </div>
  )
}

function QuickLink({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <Link
      href={href}
      className="block px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]"
    >
      <p className="font-serif text-[1.5rem] font-medium leading-none text-[var(--color-text)] tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)]">{label}</p>
    </Link>
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
    orderItemCounts,
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
      .where(requestWorksiteFilter),

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
      .where(itemWorksiteFilter),

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
      .where(orderWorksiteFilter),

    db
      .select({
        purchaseOrderId: purchaseOrderItems.purchaseOrderId,
        total:           count(),
      })
      .from(purchaseOrderItems)
      .groupBy(purchaseOrderItems.purchaseOrderId),

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

  const itemCountByOrder = new Map(orderItemCounts.map((row) => [row.purchaseOrderId, row.total]))

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
    itemCount:       itemCountByOrder.get(order.id) ?? 0,
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

  const [requestRows, pendingItemRows, orderRows, worksiteRows] = await Promise.all([
    db
      .select({
        id: purchaseRequests.id,
        requesterId: purchaseRequests.requesterId,
        worksiteId: purchaseRequests.worksiteId,
        status: purchaseRequests.status,
      })
      .from(purchaseRequests)
      .where(requestWorksiteFilter),

    db
      .select({
        id: purchaseRequestItems.id,
        status: purchaseRequestItems.status,
        worksiteId: purchaseRequests.worksiteId,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(and(inArray(purchaseRequestItems.status, ["requested", "approved", "pending_purchase"]), itemWorksiteFilter)),

    db
      .select({
        id: purchaseOrders.id,
        worksiteId: purchaseOrders.worksiteId,
        status: purchaseOrders.status,
        totalAmount: purchaseOrders.totalAmount,
      })
      .from(purchaseOrders)
      .where(orderWorksiteFilter),

    db
      .select({
        id: worksites.id,
        name: worksites.name,
        isActive: worksites.isActive,
      })
      .from(worksites)
      .where(worksiteRowsFilter),
  ])

  const metrics: Record<MetricKey, number> = {
    my_requests: requestRows.filter((r) => r.requesterId === session.user.id && r.status !== "cancelled").length,
    pending_approvals: pendingItemRows.filter((i) => i.status === "requested").length,
    approved_without_oc: pendingItemRows.filter((i) => i.status === "approved" || i.status === "pending_purchase").length,
    orders_in_progress: orderRows.filter((o) => ["issued", "sent", "supplier_confirmed", "partially_received"].includes(o.status)).length,
    orders_pending_receipt: orderRows.filter((o) => o.status === "sent" || o.status === "partially_received").length,
  }

  const totalCosts = orderRows
    .filter((o) => o.status !== "cancelled" && o.status !== "draft")
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0)

  const totalRequests = requestRows.length
  const approvedRequests = requestRows.filter((r) =>
    ["approved", "closed", "in_purchasing"].includes(r.status)
  ).length

  const worksitesBreakdown = worksiteRows
    .map((w) => {
      const requests = requestRows.filter((r) => r.worksiteId === w.id)
      const orders = orderRows.filter((o) => o.worksiteId === w.id && o.status !== "cancelled" && o.status !== "draft")
      const items = pendingItemRows.filter((i) => i.worksiteId === w.id)

      const requestsCount = requests.length
      const pendingCount = items.filter((i) => i.status === "requested").length
      const approvedCount = requests.filter((r) => ["approved", "closed", "in_purchasing"].includes(r.status)).length
      const totalCost = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0)

      return {
        id: w.id,
        name: w.name,
        requestsCount,
        pendingCount,
        approvedCount,
        totalCost,
      }
    })
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
