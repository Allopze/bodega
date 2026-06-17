import type { Metadata } from "next"
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
import { can } from "@/lib/auth/can"
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
  type WorkPriority,
  type WorkTask,
  type WorkTaskType,
} from "@/lib/work-queue"
import { getCriticalStockAlertCount } from "@/lib/services/stock-alerts"
import { getDashboardData, getWorkQueueSnapshot, buildActor } from "@/lib/services/dashboard"

export const metadata: Metadata = { title: "Dashboard" }

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
        "group grid grid-cols-[2.25rem_1fr] gap-3 px-4 py-3 sm:grid-cols-[2.75rem_2.25rem_minmax(0,1fr)_8rem_8.5rem_10rem] sm:items-center sm:px-5",
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
      <div className="col-start-2 flex items-center gap-1 whitespace-nowrap text-xs font-medium text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] sm:col-start-auto sm:justify-end">
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


