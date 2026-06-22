import type { ReactNode } from "react"
import type { Session } from "next-auth"
import Link from "next/link"
import { canAny } from "@/lib/auth/can"
import type { Permission } from "@/modules/permissions"
import { cn, formatCLP } from "@/lib/utils"
import {
  ChartLineUp,
  CheckCircle,
  CheckSquare,
  Coins,
  ShoppingCart,
  Truck,
  Warehouse,
  Warning,
} from "@phosphor-icons/react/dist/ssr"

interface MetricBarProps {
  session:              Session
  pendingTasks:         number
  criticalTasks:        number
  pendingApprovals:     number
  approvedWithoutOc:    number
  ordersPendingReceipt: number
  deliveryTasks:        number
  stockAlerts:          number
  totalCosts:           number
  approvalRate:         number
}

interface Stat {
  key:          string
  label:        string
  value:        string | number
  icon:         ReactNode
  href?:        string
  /** ANY-of: stat shows if the user holds at least one. Empty = always. */
  permissions?: Permission[]
  /** "signal" turns orange only when the value is > 0 (alerts / criticals). */
  tone?:        "signal"
  /** Mini progress bar (0–100), used by the approval-rate stat. */
  progress?:    number
  /** Inline critical-count tag (only on the tasks stat). */
  critical?:    number
}

/**
 * Tira editorial de métricas. Sin tarjetas: una banda acotada por reglas hairline
 * con divisores verticales/horizontales (truco de margen negativo) que adapta a
 * cualquier ancho. Cada stat se muestra solo si el usuario tiene permiso. Los
 * ceros se atenúan; las alertas/críticas >0 usan el naranja "signal".
 */
export function MetricBar({
  session,
  pendingTasks,
  criticalTasks,
  pendingApprovals,
  approvedWithoutOc,
  ordersPendingReceipt,
  deliveryTasks,
  stockAlerts,
  totalCosts,
  approvalRate,
}: MetricBarProps) {
  const allStats: Stat[] = [
    { key: "tasks",      label: "Tareas",        value: pendingTasks,         icon: <CheckCircle size={13} weight="bold" />, tone: "signal", critical: criticalTasks },
    { key: "approvals",  label: "Por aprobar",   value: pendingApprovals,     icon: <CheckSquare size={13} />, href: "/aprobaciones",  permissions: ["approvals:approve"] },
    { key: "no-oc",      label: "Sin OC",        value: approvedWithoutOc,    icon: <ShoppingCart size={13} />, href: "/compras/nueva", permissions: ["purchasing:create_order"] },
    { key: "to-receive", label: "Por recibir",   value: ordersPendingReceipt, icon: <Truck size={13} />, href: "/recepcion",      permissions: ["receiving:view"] },
    { key: "deliveries", label: "Entregas",      value: deliveryTasks,        icon: <Warehouse size={13} />, href: "/entregas",      permissions: ["warehouse:register_movement"] },
    { key: "stock",      label: "Alertas stock", value: stockAlerts,          icon: <Warning size={13} />, href: "/bodega",         permissions: ["warehouse:view_stock"], tone: "signal" },
    { key: "investment", label: "Inversión",     value: formatCLP(totalCosts),icon: <Coins size={13} />, permissions: ["purchasing:view", "reports:view"] },
    { key: "rate",       label: "Tasa aprob.",   value: `${approvalRate}%`,   icon: <ChartLineUp size={13} />, permissions: ["approvals:approve", "reports:view"], progress: approvalRate },
  ]

  const stats = allStats.filter(
    (stat) => !stat.permissions || stat.permissions.length === 0 || canAny(session, ...stat.permissions),
  )
  if (stats.length === 0) return null

  return (
    <div className="overflow-hidden border-y border-[var(--color-border)]">
      <div className="-ml-px -mt-px flex flex-wrap">
        {stats.map((stat) => (
          <StatCell key={stat.key} stat={stat} />
        ))}
      </div>
    </div>
  )
}

function StatCell({ stat }: { stat: Stat }) {
  const numeric = typeof stat.value === "number" ? stat.value : Number.parseFloat(String(stat.value)) || 0
  const isZero = typeof stat.value === "number" && stat.value === 0
  const signalActive = stat.tone === "signal" && numeric > 0

  const body = (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "shrink-0 transition-colors duration-[var(--duration-fast)]",
            signalActive ? "text-[var(--color-signal)]" : "text-[var(--color-text-faint)]",
            stat.href && "group-hover:text-[var(--color-primary)]",
          )}
        >
          {stat.icon}
        </span>
        <span
          className={cn(
            "text-eyebrow truncate transition-colors duration-[var(--duration-fast)]",
            stat.href && "group-hover:text-[var(--color-primary)]",
          )}
        >
          {stat.label}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span
          className={cn(
            "font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight",
            signalActive
              ? "text-[var(--color-signal-ink)]"
              : isZero
                ? "text-[var(--color-text-faint)]"
                : "text-[var(--color-text)]",
          )}
        >
          {stat.value}
        </span>
        {typeof stat.critical === "number" && stat.critical > 0 && (
          <span className="mb-0.5 font-mono text-[11px] font-semibold tabular-nums text-[var(--color-signal-ink)]">
            {stat.critical} crít.
          </span>
        )}
        {typeof stat.progress === "number" && (
          <div className="mb-1.5 h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out)]"
              style={{ width: `${stat.progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )

  const cellClass = "group flex-1 min-w-[8.5rem] border-l border-t border-[var(--color-border)]"

  if (stat.href) {
    return (
      <Link
        href={stat.href}
        data-pressable
        className={cn(
          cellClass,
          "block hover:bg-[var(--color-primary-tint)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
        )}
      >
        {body}
      </Link>
    )
  }

  return <div className={cellClass}>{body}</div>
}
