import Link from "next/link"
import type { ComponentType } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import {
  CheckSquare,
  ClipboardText,
  ShoppingCart,
  Truck,
  Warehouse,
} from "@phosphor-icons/react/dist/ssr"
import type { WorkPriority, WorkTask, WorkTaskType } from "@/lib/work-queue"

type IconComponent = ComponentType<{ size: number; className?: string }>

export const TASK_ICON: Record<WorkTaskType, IconComponent> = {
  request_followup:  ClipboardText,
  approval:          CheckSquare,
  purchase:          ShoppingCart,
  purchase_order:    ShoppingCart,
  receipt:           Truck,
  warehouse_delivery: Warehouse,
}

export const PRIORITY_LABEL: Record<WorkPriority, string> = {
  critical: "Crítico",
  high:     "Alta",
  normal:   "Normal",
  low:      "Baja",
}

export const TASK_TYPE_LABEL: Record<WorkTaskType, string> = {
  request_followup:   "Solicitud",
  approval:           "Aprobación",
  purchase:           "Compra",
  purchase_order:     "OC",
  receipt:            "Recepción",
  warehouse_delivery: "Entrega",
}

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("es-CL", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Santiago",
})

export function formatShortDate(value: string) {
  return SHORT_DATE_FORMAT.format(new Date(value))
}

export function TaskRow({ task, index }: { task: WorkTask; index: number }) {
  const Icon = TASK_ICON[task.type]
  return (
    <Link
      href={task.href}
      className={cn(
        "group grid grid-cols-[2.25rem_1fr] gap-3 px-4 py-3 sm:grid-cols-[2.75rem_2.25rem_minmax(0,1fr)_8rem_8.5rem_10rem] sm:items-center sm:px-5",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-tint)]",
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

export function PriorityTag({ priority }: { priority: WorkPriority }) {
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
  return (
    <Badge variant="default" size="sm">
      {PRIORITY_LABEL[priority]}
    </Badge>
  )
}
