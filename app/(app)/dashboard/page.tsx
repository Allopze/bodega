import type { Metadata } from "next"
import type { Session } from "next-auth"
import type { ComponentType, ReactNode } from "react"
import Link from "next/link"
import { auth } from "@/lib/auth/auth"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
  ArrowUpRight,
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

const TASK_TYPE_LABEL: Record<WorkTaskType, string> = {
  request_followup:   "Solicitud",
  approval:           "Aprobación",
  purchase:           "Compra",
  purchase_order:     "OC",
  receipt:            "Recepción",
  warehouse_delivery: "Entrega",
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
  const stockAlertCount = await getCriticalStockAlertCount()
  const criticalTaskCount = tasks.filter((task) => task.priority === "critical").length
  const deliveryTaskCount = tasks.filter((task) => task.type === "warehouse_delivery").length
  const approvalTaskCount = tasks.filter((task) => task.type === "approval").length
  const nextTask = visibleTasks[0]
  const maxWorksiteCost = Math.max(...data.worksitesBreakdown.map((row) => row.totalCost), 1)

  const approvalRate = data.summary.totalRequests > 0
    ? Math.round((data.summary.approvedRequests / data.summary.totalRequests) * 100)
    : 0

  const firstName = session.user.name?.split(" ")[0] ?? "usuario"

  return (
    <PageContainer>
      <div className="space-y-5 animate-in fade-in duration-[var(--duration-default)]">

      {/* ── Header de saludo ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-eyebrow mb-1">Tablero</p>
          <h1 className="text-h1 text-[var(--color-text)]">Hola, {firstName}</h1>
          <p className="text-sub mt-1">
            {tasks.length > 0
              ? `Tienes ${tasks.length} tarea${tasks.length === 1 ? "" : "s"} pendiente${tasks.length === 1 ? "" : "s"} hoy.`
              : "No hay tareas pendientes. Todo al día."}
          </p>
        </div>
        {tasks.length > 0 && (
          <Link
            href="/aprobaciones"
            className={cn(
              "inline-flex items-center gap-2 self-start sm:self-center",
              "px-4 h-9 rounded-[var(--radius-full)]",
              "bg-[var(--color-primary)] text-white text-[13px] font-semibold",
              "transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:bg-[var(--color-primary-strong)] active:scale-[0.97]",
            )}
          >
            Ver tareas
            <ArrowRight size={14} />
          </Link>
        )}
      </div>

      {/* ── KPI tiles ── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <Card className="border border-[var(--color-border)]">
          <CardContent className="flex h-full min-h-[15rem] flex-col justify-between p-5 md:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
                    <CheckCircle size={17} weight="bold" />
                  </span>
                  <p className="text-eyebrow">Tareas pendientes</p>
                </div>
                <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
                  <p className={cn(
                    "font-mono text-[3.5rem] font-semibold leading-none tabular-nums tracking-tight",
                    tasks.length > 0 ? "text-[var(--color-primary)]" : "text-[var(--color-text)]",
                  )}>
                    {tasks.length}
                  </p>
                  <p className="pb-2 text-sm font-medium text-[var(--color-text-muted)]">
                    {tasks.length === 0 ? "sin trabajo pendiente" : "requieren acción"}
                  </p>
                </div>
              </div>

              <div className="grid w-full grid-cols-3 gap-2 sm:max-w-[18rem]">
                <HeroStat label="Críticas" value={criticalTaskCount} tone={criticalTaskCount > 0 ? "signal" : "neutral"} />
                <HeroStat label="Entregas" value={deliveryTaskCount} />
                <HeroStat label="Revisiones" value={approvalTaskCount} />
              </div>
            </div>

            {nextTask ? (
              <Link
                href={nextTask.href}
                className={cn(
                  "mt-5 flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-primary-line)] bg-[var(--color-primary-tint)] p-3.5",
                  "transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                  "hover:border-[var(--color-primary)] hover:bg-[var(--color-success-tint)] active:scale-[0.99]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
                  "sm:flex-row sm:items-center sm:justify-between",
                )}
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-primary-ink)]">Siguiente acción</p>
                  <p className="mt-1 truncate text-sm font-semibold text-[var(--color-text)]">{nextTask.title}</p>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{nextTask.subtitle}</p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--color-primary-ink)]">
                  {nextTask.ctaLabel}
                  <ArrowRight size={13} />
                </span>
              </Link>
            ) : (
              <div className="mt-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">Estado operativo</p>
                <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">Sin bloqueos abiertos</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">No hay aprobaciones, compras, recepciones o entregas pendientes.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <KpiCard
            label="Pendientes aprobación"
            value={data.metrics.pending_approvals}
            href="/aprobaciones"
            description="requieren revisión"
            highlight={data.metrics.pending_approvals > 0}
          />
          <KpiCard
            label="Aprobados sin OC"
            value={data.metrics.approved_without_oc}
            href="/compras/nueva"
            description="listos para compra"
            highlight={data.metrics.approved_without_oc > 0}
          />
          <KpiCard
            label="OC por recibir"
            value={data.metrics.orders_pending_receipt}
            href="/recepcion"
            description="esperan recepción"
            highlight={data.metrics.orders_pending_receipt > 0}
          />
        </div>
      </div>

      {/* ── Fila secondary: inversión + alertas + tasa ── */}
      <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <div className="grid grid-cols-1 divide-y divide-[var(--color-border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <MetricStripItem
            icon={<Coins size={14} />}
            label="Inversión OC emitidas"
            value={formatCLP(data.summary.totalCosts)}
          />
          <MetricStripItem
            href="/bodega"
            icon={<Warning size={14} />}
            label="Alertas de stock"
            value={stockAlertCount}
            signal={stockAlertCount > 0}
          />
          <MetricStripItem
            icon={<CheckCircle size={14} />}
            label="Tasa de aprobación"
            value={`${approvalRate}%`}
            progress={approvalRate}
          />
        </div>
      </div>

      {/* ── Cola de trabajo ── */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-h2 text-[var(--color-text)]">Cola de trabajo</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            {tasks.length} {tasks.length === 1 ? "tarea" : "tareas"}
          </p>
        </div>

        {visibleTasks.length === 0 ? (
          <Card className="border border-[var(--color-border)]">
            <CardContent className="py-8">
              <EmptyState
                icon={<CheckCircle size={22} />}
                title="Sin tareas pendientes"
                description="No hay aprobaciones, órdenes de compra, recepciones o entregas que requieran acción."
                compact
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-[var(--color-border)]">
              {visibleTasks.map((task, i) => (
                <li key={task.id} className={cn(
                  i === 0 && "rounded-t-[var(--radius-2xl)] overflow-hidden",
                  i === visibleTasks.length - 1 && "rounded-b-[var(--radius-2xl)] overflow-hidden",
                )}>
                  <TaskRow task={task} index={i} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* ── Actividad por faena ── */}
      {data.worksitesBreakdown.length > 0 && (
        <section>
          <h2 className="text-h2 text-[var(--color-text)] mb-3">Actividad por faena</h2>
          <Card>
            <div className="overflow-x-auto">
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
          </Card>
        </section>
      )}
      </div>
    </PageContainer>
  )
}

function KpiCard({
  label, value, href, highlight,
  description,
}: {
  label: string
  value: number
  href: string
  description: string
  highlight?: boolean
}) {
  return (
    <Link href={href} className="block group">
      <Card className="h-full transition-[background-color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-tint)] hover:shadow-[var(--shadow-md)] active:scale-[0.98]">
        <CardContent className="flex h-full items-center justify-between gap-4 p-4">
          <div>
            <p className="text-eyebrow mb-1 line-clamp-2">{label}</p>
            <p className={cn(
              "font-mono text-[1.85rem] font-semibold leading-none tabular-nums tracking-tight",
              highlight ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text)]",
            )}>
              {value}
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{description}</p>
          </div>
          <ArrowUpRight
            size={16}
            className="shrink-0 text-[var(--color-text-faint)] group-hover:text-[var(--color-primary)] transition-colors duration-[var(--duration-fast)]"
          />
        </CardContent>
      </Card>
    </Link>
  )
}

function HeroStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: number
  tone?: "neutral" | "signal"
}) {
  return (
    <div className={cn(
      "rounded-[var(--radius)] border px-3 py-2.5",
      tone === "signal"
        ? "border-[var(--color-signal-line)] bg-[var(--color-signal-tint)]"
        : "border-[var(--color-border)] bg-[var(--color-surface-2)]",
    )}>
      <p className={cn(
        "font-mono text-lg font-semibold leading-none tabular-nums",
        tone === "signal" ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text)]",
      )}>
        {value}
      </p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">{label}</p>
    </div>
  )
}

function MetricStripItem({
  icon,
  label,
  value,
  href,
  signal = false,
  progress,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  href?: string
  signal?: boolean
  progress?: number
}) {
  const content = (
    <div className={cn(
      "group flex min-h-[5.75rem] flex-col justify-between gap-3 p-4 md:p-5",
      href && "transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-tint)] active:scale-[0.99]",
    )}>
      <div className="flex items-center gap-2">
        <span className={cn(
          "text-[var(--color-text-muted)] transition-colors duration-[var(--duration-fast)]",
          signal && "text-[var(--color-signal)]",
          href && "group-hover:text-[var(--color-primary)]",
        )}>
          {icon}
        </span>
        <p className="text-eyebrow">{label}</p>
      </div>
      <div className="flex items-end gap-3">
        <p className={cn(
          "font-mono text-[1.55rem] font-semibold leading-none tabular-nums tracking-tight",
          signal ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text)]",
        )}>
          {value}
        </p>
        {typeof progress === "number" && (
          <div className="mb-1 flex-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div
                className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out)]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="block focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]"
      >
        {content}
      </Link>
    )
  }

  return content
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
    orders_in_progress: orderRows.filter((o) => ["issued", "sent", "supplier_confirmed", "partially_office_received", "office_received", "partially_received"].includes(o.status)).length,
    orders_pending_receipt: orderRows.filter((o) => ["sent", "partially_office_received", "office_received", "partially_received"].includes(o.status)).length,
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
