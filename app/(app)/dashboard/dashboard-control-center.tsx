"use client"

import * as React from "react"
import Link from "next/link"
import {
  CheckCircle,
  CheckSquare,
  ClipboardText,
  ClockCounterClockwise,
  Package,
  FileText,
  ShoppingCart,
  Truck,
  WarningCircle,
  Warehouse,
} from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn, formatDateTime } from "@/lib/utils"
import type { WorkPriority, WorkTask, WorkTaskType } from "@/lib/work-queue"
import type { OperationalWorkItem } from "@/lib/services/operational-work-queue"
import { WorkAssignmentControl } from "../pendientes/work-assignment-control"

export type DashboardQueuePreset = "all" | "critical" | "approval" | "receipt" | "delivery"

export interface DashboardMetric {
  key: string
  label: string
  value: string | number
  description: string
  icon: "tasks" | "critical" | "approvals" | "receipts" | "deliveries" | "stock" | "investment" | "rate"
  tone?: "neutral" | "signal" | "danger"
  href?: string
  preset?: DashboardQueuePreset
}

export interface DashboardAlert {
  key: string
  title: string
  description: string
  count: number
  severity: "critical" | "warning" | "info"
  href?: string
  preset?: DashboardQueuePreset
}

export interface OperationalPeriodSummaryEntry {
  key: string
  label: string
  value: string | number
  comparison: string
  href: string
}

export type DashboardTask = WorkTask & {
  operationalItem?: OperationalWorkItem
}

interface DashboardControlCenterProps {
  firstName: string
  contextLabel: string
  refreshedAt: string
  tasks: DashboardTask[]
  /** Resumen de toda la cola autorizada; tasks sólo contiene la vista previa. */
  queueSummary: {
    total: number
    critical: number
    overdue: number
    deliveries: number
  }
  canAssign: boolean
  periodSummary: OperationalPeriodSummaryEntry[]
  backlogSummary: OperationalPeriodSummaryEntry[]
  metrics: DashboardMetric[]
  alerts: DashboardAlert[]
  children?: React.ReactNode
}

type ModuleFilter = "all" | WorkTaskType
type SortOption = "priority" | "oldest" | "newest"

const MODULE_META: Record<WorkTaskType, { label: string; Icon: typeof ClipboardText }> = {
  request_followup:   { label: "Solicitudes",  Icon: ClipboardText },
  approval:           { label: "Aprobaciones", Icon: CheckSquare },
  purchase:           { label: "Compras",      Icon: ShoppingCart },
  purchase_order:     { label: "Órdenes de compra", Icon: ShoppingCart },
  receipt:            { label: "Recepciones", Icon: Truck },
  warehouse_delivery: { label: "Entregas",     Icon: Warehouse },
  pdtp:               { label: "PDTP",         Icon: ClipboardText },
  capa:               { label: "CAPA",         Icon: WarningCircle },
  inspection:         { label: "Inspecciones", Icon: ClipboardText },
  documentation:      { label: "Documentación", Icon: FileText },
  ppa:                { label: "PPA",          Icon: WarningCircle },
  sst:                { label: "SST",          Icon: CheckSquare },
}

const METRIC_ICON = {
  tasks:      CheckCircle,
  critical:   WarningCircle,
  approvals:  CheckSquare,
  receipts:   Truck,
  deliveries: Warehouse,
  stock:      Package,
  investment: ShoppingCart,
  rate:       CheckCircle,
} as const

const PRIORITY_RANK: Record<WorkPriority, number> = {
  critical: 0,
  high:     1,
  normal:   2,
  low:      3,
}

const SEVERITY_META = {
  critical: { label: "Crítica", variant: "danger" as const },
  warning:  { label: "Atención", variant: "warning" as const },
  info:     { label: "Pendiente", variant: "info" as const },
}

/**
 * Capa interactiva deliberadamente pequeña: recibe únicamente tareas y
 * métricas ya autorizadas por el Server Component. Los filtros no realizan
 * nuevas consultas ni amplían el alcance de faenas del usuario.
 */
export function DashboardControlCenter({
  firstName,
  contextLabel,
  refreshedAt,
  tasks,
  queueSummary,
  canAssign,
  periodSummary,
  backlogSummary,
  metrics,
  alerts,
  children,
}: DashboardControlCenterProps) {
  const { searchQuery } = useSafeShellHeader()
  const [preset, setPreset] = React.useState<DashboardQueuePreset>("all")
  const [module, setModule] = React.useState<ModuleFilter>("all")
  const [worksiteId, setWorksiteId] = React.useState("all")
  const [priority, setPriority] = React.useState<"all" | WorkPriority>("all")
  const [status, setStatus] = React.useState("all")
  const [sort, setSort] = React.useState<SortOption>("priority")

  const worksites = React.useMemo(
    () => [...new Map(tasks.map((task) => [task.worksiteId, task.worksiteName])).entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "es")),
    [tasks],
  )
  const statuses = React.useMemo(
    () => [...new Set(tasks.map((task) => task.statusLabel))].sort((left, right) => left.localeCompare(right, "es")),
    [tasks],
  )

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filteredTasks = React.useMemo(() => {
    const result = tasks.filter((task) => {
      if (preset === "critical" && task.priority !== "critical") return false
      if (preset === "approval" && task.type !== "approval") return false
      if (preset === "receipt" && task.type !== "receipt") return false
      if (preset === "delivery" && task.type !== "warehouse_delivery") return false
      if (module !== "all" && task.type !== module) return false
      if (worksiteId !== "all" && task.worksiteId !== worksiteId) return false
      if (priority !== "all" && task.priority !== priority) return false
      if (status !== "all" && task.statusLabel !== status) return false
      if (!normalizedSearch) return true

      return [task.title, task.subtitle, task.worksiteName, task.statusLabel, MODULE_META[task.type].label]
        .join(" ")
        .toLocaleLowerCase("es-CL")
        .includes(normalizedSearch)
    })

    return result.sort((left, right) => {
      if (sort === "priority") {
        const priorityDifference = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
        if (priorityDifference !== 0) return priorityDifference
      }
      const dateDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      return sort === "newest" ? -dateDifference : dateDifference
    })
  }, [module, normalizedSearch, preset, priority, sort, status, tasks, worksiteId])

  const quickFilters: Array<{ value: DashboardQueuePreset; label: string; count: number }> = [
    { value: "all", label: "Todas", count: tasks.length },
    { value: "critical", label: "Críticas", count: tasks.filter((task) => task.priority === "critical").length },
    { value: "approval", label: "Aprobaciones", count: tasks.filter((task) => task.type === "approval").length },
    { value: "receipt", label: "Recepciones", count: tasks.filter((task) => task.type === "receipt").length },
    { value: "delivery", label: "Entregas", count: tasks.filter((task) => task.type === "warehouse_delivery").length },
  ]

  function applyPreset(nextPreset: DashboardQueuePreset) {
    setPreset(nextPreset)
    document.getElementById("cola-de-trabajo")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    })
  }

  function clearFilters() {
    setPreset("all")
    setModule("all")
    setWorksiteId("all")
    setPriority("all")
    setStatus("all")
  }

  const activeFilterCount = [preset !== "all", module !== "all", worksiteId !== "all", priority !== "all", status !== "all"].filter(Boolean).length

  return (
    <>
      <header className="border-b border-[var(--color-border)] pb-5">
        <p className="text-eyebrow hidden lg:block">Centro de control</p>
        <div className="mt-1 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-h1 text-[var(--color-text)]">Hola, {firstName}</h2>
            <p className="mt-1.5 max-w-[70ch] text-sm text-[var(--color-text-muted)]">
              {buildOperationalSummary(queueSummary)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-subtle)]">
            <span className="font-medium text-[var(--color-text-muted)]">{contextLabel}</span>
            <span aria-hidden>·</span>
            <time dateTime={refreshedAt}>Actualizado {formatDateTime(refreshedAt)}</time>
          </div>
        </div>
      </header>

      {metrics.length > 0 && (
        <section className="mt-5" aria-labelledby="indicadores-operacionales">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="indicadores-operacionales" className="text-h2 text-[var(--color-text)]">Indicadores operacionales</h2>
            <span className="text-xs text-[var(--color-text-subtle)]">Selecciona un indicador para actuar</span>
          </div>
          <div className="grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <OperationalMetric key={metric.key} metric={metric} onSelect={applyPreset} />
            ))}
          </div>
        </section>
      )}

      {periodSummary.length > 0 && (
        <section className="mt-3" aria-labelledby="flujo-mensual">
          <div className="flex flex-col gap-2 border-y border-[var(--color-border)] py-3 sm:flex-row sm:items-baseline sm:gap-5">
            <h2 id="flujo-mensual" className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">Flujo del mes</h2>
            <div className="flex min-w-0 flex-wrap gap-x-5 gap-y-2">
              {periodSummary.map((entry) => (
                <Link key={entry.key} href={entry.href} className="group text-sm text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                  <span className="font-medium text-[var(--color-text)] group-hover:text-[var(--color-primary-ink)]">{entry.label}: {entry.value}</span>
                  <span className="ml-1 text-xs text-[var(--color-text-subtle)]">{entry.comparison}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {backlogSummary.length > 0 && (
        <section className="mt-3" aria-labelledby="backlog-comparado">
          <div className="flex flex-col gap-2 border-b border-[var(--color-border)] pb-3 sm:flex-row sm:items-baseline sm:gap-5">
            <h2 id="backlog-comparado" className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">Backlog comparado</h2>
            <div className="flex min-w-0 flex-wrap gap-x-5 gap-y-2">
              {backlogSummary.map((entry) => (
                <Link key={entry.key} href={entry.href} className="group text-sm text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                  <span className="font-medium text-[var(--color-text)] group-hover:text-[var(--color-primary-ink)]">{entry.label}: {entry.value}</span>
                  <span className="ml-1 text-xs text-[var(--color-text-subtle)]">{entry.comparison}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="mt-6" aria-labelledby="alertas-operacionales">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="alertas-operacionales" className="text-h2 text-[var(--color-text)]">Requiere atención</h2>
          {alerts.length > 0 && <span className="text-xs text-[var(--color-text-subtle)]">{alerts.length} situación{alerts.length === 1 ? "" : "es"} activa{alerts.length === 1 ? "" : "s"}</span>}
        </div>
        {alerts.length > 0 ? (
          <div className="grid gap-2 xl:grid-cols-2">
            {alerts.map((alert) => <OperationalAlert key={alert.key} alert={alert} onSelect={applyPreset} />)}
          </div>
        ) : (
          <div className="border-y border-[var(--color-border)]">
            <EmptyState
              compact
              align="start"
              icon={<CheckCircle size={20} weight="fill" />}
              tone="success"
              title="No hay alertas operacionales activas"
              description="No se detectaron pendientes críticos en los módulos que puedes revisar desde este dashboard."
            />
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <Button asChild size="sm" variant="secondary"><Link href="/pendientes">Abrir cola completa</Link></Button>
        </div>
      </section>

      {children && <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">{children}</div>}

      <section id="cola-de-trabajo" className="mt-8 scroll-mt-4" aria-labelledby="titulo-cola-trabajo">
        <div className="flex flex-col gap-3 border-b border-[var(--color-border)] pb-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="titulo-cola-trabajo" className="text-h2 text-[var(--color-text)]">Cola de trabajo</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Acciones disponibles en tus faenas autorizadas. El texto se filtra desde la búsqueda de la cabecera.
            </p>
          </div>
          <p aria-live="polite" className="text-sm text-[var(--color-text-subtle)]">
            {filteredTasks.length} de {tasks.length} tarea{tasks.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto pb-1" aria-label="Filtros rápidos de la cola">
          {quickFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={preset === filter.value}
              onClick={() => setPreset(filter.value)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius)] px-3 text-sm font-semibold",
                "transition-[background-color,color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] motion-safe:active:scale-[0.97]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
                preset === filter.value
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-primary-tint)] hover:text-[var(--color-primary-ink)]",
              )}
            >
              {filter.label}
              <span className="font-mono text-xs tabular-nums opacity-80">{filter.count}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2 border-y border-[var(--color-border)] py-3 sm:grid-cols-2 xl:grid-cols-5">
          <FilterSelect label="Módulo" value={module} onValueChange={(value) => setModule(value as ModuleFilter)}>
            <SelectItem value="all">Todos los módulos</SelectItem>
            {Object.entries(MODULE_META).map(([value, item]) => <SelectItem key={value} value={value}>{item.label}</SelectItem>)}
          </FilterSelect>
          <FilterSelect label="Faena" value={worksiteId} onValueChange={setWorksiteId}>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}
          </FilterSelect>
          <FilterSelect label="Prioridad" value={priority} onValueChange={(value) => setPriority(value as "all" | WorkPriority)}>
            <SelectItem value="all">Todas las prioridades</SelectItem>
            <SelectItem value="critical">Crítico</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
          </FilterSelect>
          <FilterSelect label="Estado" value={status} onValueChange={setStatus}>
            <SelectItem value="all">Todos los estados</SelectItem>
            {statuses.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </FilterSelect>
          <FilterSelect label="Ordenar por" value={sort} onValueChange={(value) => setSort(value as SortOption)}>
            <SelectItem value="priority">Prioridad</SelectItem>
            <SelectItem value="oldest">Más antigua</SelectItem>
            <SelectItem value="newest">Más reciente</SelectItem>
          </FilterSelect>
          {activeFilterCount > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="justify-self-start xl:col-span-5">
              Limpiar filtros ({activeFilterCount})
            </Button>
          )}
        </div>

        {filteredTasks.length > 0 ? (
          <div className="mt-3 overflow-x-auto border-y border-[var(--color-border)]" data-sticky-col="true">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[7rem_minmax(15rem,1.6fr)_9rem_10rem_9rem_8rem_10rem] gap-3 border-b border-[var(--color-border)] px-4 py-2.5 text-left th-type">
                <span>Prioridad</span>
                <span>Tarea</span>
                <span>Módulo</span>
                <span>Faena</span>
                <span>Estado</span>
                <span>Antigüedad</span>
                <span className="text-right">Acción</span>
              </div>
              <ul className="divide-y divide-[var(--color-border)]">
                {filteredTasks.map((task) => <WorkQueueRow key={task.id} task={task} refreshedAt={refreshedAt} canAssign={canAssign} />)}
              </ul>
            </div>
          </div>
        ) : (
          <div className="mt-3 border-y border-[var(--color-border)]">
            <EmptyState
              compact
              icon={<ClockCounterClockwise size={20} />}
              title="No hay tareas con estos filtros"
              description={normalizedSearch ? "Prueba otra búsqueda desde la cabecera o ajusta los filtros estructurados." : "Quita uno o más filtros para volver a ver las acciones disponibles."}
              action={activeFilterCount > 0 ? <Button type="button" size="sm" variant="secondary" onClick={clearFilters}>Limpiar filtros</Button> : undefined}
            />
          </div>
        )}
      </section>
    </>
  )
}

function OperationalMetric({ metric, onSelect }: { metric: DashboardMetric; onSelect: (preset: DashboardQueuePreset) => void }) {
  const Icon = METRIC_ICON[metric.icon]
  const toneClass = metric.tone === "danger"
    ? "text-[var(--color-danger-ink)]"
    : metric.tone === "signal"
      ? "text-[var(--color-signal-ink)]"
      : "text-[var(--color-text)]"
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-eyebrow text-[var(--color-text-muted)]">{metric.label}</span>
        <Icon size={17} className="text-[var(--color-text-faint)]" aria-hidden />
      </div>
      <span className={cn("mt-4 block font-mono text-2xl font-semibold leading-none tabular-nums tracking-tight", toneClass)}>{metric.value}</span>
      <span className="mt-2 block text-xs leading-5 text-[var(--color-text-muted)]">{metric.description}</span>
    </>
  )
  const className = "group min-h-32 bg-[var(--color-surface)] p-4 text-left transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)] motion-safe:active:scale-[0.99]"

  if (metric.href) return <Link href={metric.href} data-pressable className={className}>{content}</Link>
  if (metric.preset) return <button type="button" onClick={() => onSelect(metric.preset!)} className={className}>{content}</button>
  return <div className={cn(className, "cursor-default hover:bg-[var(--color-surface)]")}>{content}</div>
}

function OperationalAlert({ alert, onSelect }: { alert: DashboardAlert; onSelect: (preset: DashboardQueuePreset) => void }) {
  const meta = SEVERITY_META[alert.severity]
  const content = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
        <WarningCircle size={17} weight={alert.severity === "critical" ? "fill" : "regular"} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-semibold tabular-nums text-[var(--color-text)]">{alert.count}</span>
          <span className="text-sm font-semibold text-[var(--color-text)]">{alert.title}</span>
          <Badge variant={meta.variant} size="sm" dot>{meta.label}</Badge>
        </span>
        <span className="mt-1 block text-xs leading-5 text-[var(--color-text-muted)]">{alert.description}</span>
      </span>
    </>
  )
  const className = "group flex min-h-20 items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 text-left transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] motion-safe:active:scale-[0.99]"

  if (alert.href) return <Link href={alert.href} data-pressable className={className}>{content}</Link>
  if (alert.preset) return <button type="button" onClick={() => onSelect(alert.preset!)} className={cn(className, "w-full")}>{content}</button>
  return <div className={className}>{content}</div>
}

function FilterSelect({ label, value, onValueChange, children }: {
  label: string
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
      <span>{label}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger aria-label={label} className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </label>
  )
}

function WorkQueueRow({ task, refreshedAt, canAssign }: { task: DashboardTask; refreshedAt: string; canAssign: boolean }) {
  const { label: moduleLabel, Icon } = MODULE_META[task.type]
  return (
    <li className="grid grid-cols-[7rem_minmax(15rem,1.6fr)_9rem_10rem_9rem_8rem_10rem] items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-[var(--color-surface-2)]">
      <PriorityBadge priority={task.priority} size="sm" className="justify-self-start" />
      <div className="min-w-0">
        <p className="truncate font-semibold text-[var(--color-text)]" title={task.title}>{task.title}</p>
        <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]" title={task.subtitle}>{task.subtitle}</p>
      </div>
      <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]"><Icon size={14} aria-hidden />{moduleLabel}</span>
      <span className="truncate text-xs text-[var(--color-text-muted)]" title={task.worksiteName}>{task.worksiteName}</span>
      <Badge variant="default" size="sm" className="justify-self-start">{task.statusLabel}</Badge>
      <time dateTime={task.createdAt} className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{relativeAge(task.createdAt, refreshedAt)}</time>
      <span className="flex justify-self-end gap-1 whitespace-nowrap">
        {canAssign && task.operationalItem?.assignable ? <WorkAssignmentControl item={task.operationalItem} /> : null}
        <Button asChild size="sm" variant="link"><Link href={task.href}>{task.ctaLabel}</Link></Button>
      </span>
    </li>
  )
}

function buildOperationalSummary(summary: DashboardControlCenterProps["queueSummary"]) {
  if (summary.total === 0) return "No tienes acciones pendientes en el contexto operativo actual."
  const fragments = [`Tienes ${summary.total} tarea${summary.total === 1 ? "" : "s"} pendiente${summary.total === 1 ? "" : "s"}`]
  if (summary.critical > 0) fragments.push(`${summary.critical} crítica${summary.critical === 1 ? "" : "s"}`)
  if (summary.overdue > 0) fragments.push(`${summary.overdue} vencida${summary.overdue === 1 ? "" : "s"}`)
  if (summary.deliveries > 0) fragments.push(`${summary.deliveries} entrega${summary.deliveries === 1 ? "" : "s"} por registrar`)
  return `${fragments.join(", ")}.`
}

function relativeAge(value: string, referenceTime: string) {
  const elapsedMs = Math.max(0, new Date(referenceTime).getTime() - new Date(value).getTime())
  const days = Math.floor(elapsedMs / 86_400_000)
  if (days === 0) return "Hoy"
  if (days === 1) return "1 día"
  return `${days} días`
}
