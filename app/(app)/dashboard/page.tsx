import type { Metadata } from "next"
import type { Session } from "next-auth"
import type { ComponentType } from "react"
import Link from "next/link"
import { auth } from "@/lib/auth/auth"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Stagger } from "@/components/ui/stagger"
import { db } from "@/db"
import {
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  suppliers,
  warehouseStock,
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
  Warning,
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

const PRIORITY_CLASS: Record<WorkPriority, string> = {
  critical: "border-[var(--color-danger)] bg-[var(--color-danger-50)] text-[var(--color-danger)]",
  high:     "border-[var(--color-warning-100)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  normal:   "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  low:      "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-subtle)]",
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
    <div className="space-y-8 animate-in fade-in duration-[var(--duration-default)]">
      <PageHeader
        title="Trabajo de hoy"
        description={`Hola, ${session.user.name?.split(" ")[0] ?? "usuario"}. Estas son las acciones que mantienen los pedidos avanzando.`}
      />

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">Tareas pendientes</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Ordenadas por urgencia y antigüedad. Cada tarjeta te lleva al siguiente paso.
            </p>
          </div>
          <span className="text-xs font-medium text-[var(--color-text-subtle)]">
            {tasks.length} tarea{tasks.length !== 1 ? "s" : ""}
          </span>
        </div>

        {visibleTasks.length === 0 ? (
          <EmptyState
            icon={<CheckCircle size={24} />}
            title="Sin tareas pendientes"
            description="No hay aprobaciones, compras, recepciones o entregas que requieran acción en este momento."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {visibleTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-h2 text-[var(--color-text)]">Resumen operativo</h2>
          <p className="mt-1 text-sub">
            Indicadores rápidos para mirar carga, costos y alertas.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <MetricCard
            icon={Coins}
            label="Inversión en OC emitidas"
            value={formatCLP(data.summary.totalCosts)}
          />
          <MetricCard
            icon={ClipboardText}
            label="Solicitudes visibles"
            value={String(data.summary.totalRequests)}
          />
          <MetricCard
            icon={CheckCircle}
            label="Tasa de aprobación"
            value={`${approvalRate}%`}
            tone="success"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <QuickLink href="/aprobaciones" label="Pendientes de aprobación" value={data.metrics.pending_approvals} />
          <QuickLink href="/compras/nueva" label="Aprobados sin OC" value={data.metrics.approved_without_oc} />
          <QuickLink href="/recepcion" label="OC por recibir" value={data.metrics.orders_pending_receipt} />
          <QuickLink href="/bodega" label="Alertas de stock" value={stockAlertCount} />
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-sm)]">
        <h2 className="text-h2">Actividad y costos por faena</h2>
        {data.worksitesBreakdown.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-[var(--color-text-subtle)]">No hay actividad registrada en las faenas visibles.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm" aria-label="Actividad y costos por faena">
              <thead>
                <tr className="border-b border-[var(--color-border-strong)] text-[var(--color-text-muted)]">
                  <th className="px-3 py-2.5 font-medium">Faena</th>
                  <th className="px-3 py-2.5 text-right font-medium">Solicitudes</th>
                  <th className="px-3 py-2.5 text-right font-medium">Pendientes aprob.</th>
                  <th className="px-3 py-2.5 text-right font-medium">Aprobadas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total OC emitidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.worksitesBreakdown.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-[var(--color-surface-2)]">
                    <td className="px-3 py-3 font-medium text-[var(--color-text)]">{row.name}</td>
                    <td className="px-3 py-3 text-right font-mono">{row.requestsCount}</td>
                    <td className="px-3 py-3 text-right font-mono">
                      <span className={cn(row.pendingCount > 0 ? "font-bold text-[var(--color-warning-700)]" : "text-[var(--color-text-subtle)]")}>
                        {row.pendingCount}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono">{row.approvedCount}</td>
                    <td className="px-3 py-3 text-right font-mono font-medium text-[var(--color-text)]">
                      {formatCLP(row.totalCost)}
                    </td>
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

function TaskCard({ task }: { task: WorkTask }) {
  const Icon = TASK_ICON[task.type]

  return (
    <Link
      href={task.href}
      className={cn(
        "group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4",
        "transition-[background-color,border-color,box-shadow,transform] duration-[var(--duration-default)] ease-[var(--ease-out)]",
        "hover:-translate-y-0.5 hover:border-[var(--color-primary-100)] hover:bg-[var(--color-primary-50)] hover:shadow-[var(--shadow-sm)] active:scale-[0.99]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] group-hover:bg-[var(--color-surface)] group-hover:text-[var(--color-primary)]">
        <Icon size={20} />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{task.title}</h3>
          <span className={cn("rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] font-medium", PRIORITY_CLASS[task.priority])}>
            {PRIORITY_LABEL[task.priority]}
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">{task.subtitle}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[var(--color-text-muted)]">
            {task.statusLabel}
          </span>
          <span className="text-[var(--color-text-subtle)]">{formatShortDate(task.createdAt)}</span>
        </div>
      </div>

      <div className="hidden items-center gap-1 text-sm font-medium text-[var(--color-primary)] sm:flex">
        {task.ctaLabel}
        <ArrowRight size={14} className="transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = "primary",
}: {
  icon: IconComponent
  label: string
  value: string
  tone?: "primary" | "success"
}) {
  return (
    <div className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
      <div className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)]",
        tone === "success" ? "bg-[var(--color-success-50)] text-[var(--color-success)]" : "bg-[var(--color-primary-50)] text-[var(--color-primary)]",
      )}>
        <Icon size={22} />
      </div>
      <div>
        <p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p>
        <p className="mt-0.5 text-xl font-bold text-[var(--color-text)]">{value}</p>
      </div>
    </div>
  )
}

function QuickLink({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <Link
      href={href}
      className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:border-[var(--color-primary-100)] hover:bg-[var(--color-primary-50)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
    >
      <p className="text-2xl font-bold leading-none text-[var(--color-text)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{label}</p>
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
        productId: warehouseStock.productId,
      })
      .from(warehouseStock)
      .where(sql`${warehouseStock.quantity} > 0`),
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
