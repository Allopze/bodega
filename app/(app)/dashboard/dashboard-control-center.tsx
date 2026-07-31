"use client"

import * as React from "react"
import Link from "next/link"
import {
  CheckCircle,
  CheckSquare,
  ClipboardText,
  ClockCounterClockwise,
  FileText,
  ShoppingCart,
  Truck,
  WarningCircle,
  Warehouse,
} from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DashboardGrid } from "@/components/ui/dashboard-grid"
import { EmptyState } from "@/components/ui/empty-state"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DashboardScopeControls } from "./dashboard-scope-controls"
import { periodFlowTitle, type DashboardScope } from "./dashboard-scope"
import { chileDateParts, cn, formatDateTime } from "@/lib/utils"
import { OperationalMetricsStrip } from "./operational-metrics-strip"
import { MiniSparkline } from "./mini-sparkline"
import { CHART_COLORS } from "./chart-palette"
import type { WorkPriority, WorkTask, WorkTaskType } from "@/lib/work-queue"
import type { OperationalWorkItem } from "@/lib/services/operational-work-queue"
import { WorkAssignmentControl } from "../pendientes/work-assignment-control"

export interface DashboardMetric {
  key: string
  label: string
  value: string | number
  description: string
  icon: "tasks" | "critical" | "approvals" | "receipts" | "deliveries" | "stock" | "investment" | "rate"
  tone?: "neutral" | "signal" | "danger"
  href?: string
  sparkline?: number[]
}

export interface DashboardAlert {
  key: string
  title: string
  description: string
  count: number
  severity: "critical" | "warning" | "info"
  href?: string
}

/**
 * Atajo a `/pendientes` con el conteo de la **población completa**.
 *
 * Reemplaza a los chips que filtraban en cliente: aquellos contaban sólo las
 * filas cargadas y contradecían al saludo, que sí usa el total (D-01).
 */
export interface QueueShortcut {
  key: string
  label: string
  count: number
  href: string
}

export interface OperationalPeriodSummaryEntry {
  key: string
  label: string
  value: string | number
  comparison: string
  href: string
  /** Serie diaria real; sólo la traen las entradas con instantáneas. */
  sparkline?: number[]
}

export type DashboardTask = WorkTask & {
  operationalItem?: OperationalWorkItem
}

interface DashboardControlCenterProps {
  firstName: string
  contextLabel: string
  refreshedAt: string
  /**
   * Sólo las tareas más urgentes, NO la cola completa. Todo conteo que deba
   * hablar del backlog entero sale de `queueSummary` o de `queueShortcuts`.
   */
  tasks: DashboardTask[]
  queueSummary: {
    total: number
    critical: number
    overdue: number
    deliveries: number
  }
  /** Atajos con conteos de población completa, ya filtrados por permiso. */
  queueShortcuts: QueueShortcut[]
  /** Alcance global vigente: la cola ya viene consultada con él. */
  scope: DashboardScope
  /** Faenas activas autorizadas para el selector de alcance. */
  worksiteOptions: Array<{ id: string; name: string }>
  canAssign: boolean
  periodSummary: OperationalPeriodSummaryEntry[]
  backlogSummary: OperationalPeriodSummaryEntry[]
  metrics: DashboardMetric[]
  alerts: DashboardAlert[]
  /** Contenido extra de la columna principal, bajo la cola (actividad). */
  mainSlot?: React.ReactNode
  /** Contenido extra del lateral, entre alertas y métricas mensuales (PDTP). */
  asideSlot?: React.ReactNode
}

type SortOption = "priority" | "oldest" | "newest"

const SORT_OPTIONS: SortOption[] = ["priority", "oldest", "newest"]

/**
 * **Sólo el orden** de la cola vive en `sessionStorage`. La faena se fue al
 * alcance global de la URL (ver `dashboard-scope.ts`), y la distinción es la que
 * importa: el orden es preferencia de UI y se aplica en cliente sobre las filas
 * ya cargadas; la faena reencuadra consultas de servidor y por eso tiene que
 * viajar en la URL.
 *
 * `sessionStorage` y no la URL para el orden porque cualquier `router.refresh()`
 * —el de `WorkAssignmentControl`, por ejemplo— desmonta el árbol (hay
 * `loading.tsx`) y borraría un estado que viviera sólo en React.
 */
const FILTERS_STORAGE_KEY = "dashboard:queue-filters"

type ModuleMeta = { label: string; Icon: typeof ClipboardText }

/**
 * `Partial` a propósito: `purchase_order` es un `WorkTaskType` válido pero
 * `MODULE_TO_TASK_TYPE` (page.tsx) nunca lo produce, así que su fila era una
 * etiqueta que no se mostraba nunca (C2). Cualquier tipo futuro sin entrada cae
 * al fallback en vez de romper en runtime.
 */
const MODULE_FALLBACK: ModuleMeta = { label: "Otros", Icon: ClipboardText }

const MODULE_META: Partial<Record<WorkTaskType, ModuleMeta>> = {
  request_followup:   { label: "Solicitudes",  Icon: ClipboardText },
  approval:           { label: "Aprobaciones", Icon: CheckSquare },
  purchase:           { label: "Compras",      Icon: ShoppingCart },
  receipt:            { label: "Recepciones", Icon: Truck },
  warehouse_delivery: { label: "Entregas",     Icon: Warehouse },
  pdtp:               { label: "PDTP",         Icon: ClipboardText },
  capa:               { label: "CAPA",         Icon: WarningCircle },
  inspection:         { label: "Inspecciones", Icon: ClipboardText },
  documentation:      { label: "Documentación", Icon: FileText },
  ppa:                { label: "PPA",          Icon: WarningCircle },
  sst:                { label: "SST",          Icon: CheckSquare },
}

const moduleMeta = (type: WorkTaskType): ModuleMeta => MODULE_META[type] ?? MODULE_FALLBACK

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

export function DashboardControlCenter({
  firstName,
  contextLabel,
  refreshedAt,
  tasks,
  queueSummary,
  queueShortcuts,
  scope,
  worksiteOptions,
  canAssign,
  periodSummary,
  backlogSummary,
  metrics,
  alerts,
  mainSlot,
  asideSlot,
}: DashboardControlCenterProps) {
  const { searchQuery } = useSafeShellHeader()
  const [sort, setSort] = React.useState<SortOption>("priority")
  const [restored, setRestored] = React.useState(false)

  React.useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(FILTERS_STORAGE_KEY) ?? "{}")
      if (SORT_OPTIONS.includes(saved.sort)) setSort(saved.sort)
    } catch { /* modo privado o valor corrupto: se usan los defaults */ }
    setRestored(true)
  }, [])

  React.useEffect(() => {
    // Sin el guard, el primer commit guardaría los defaults encima de lo leído.
    if (!restored) return
    try { sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({ sort })) } catch { /* modo privado */ }
  }, [restored, sort])

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase("es-CL")
  // Ya no filtra por faena: la cola llega consultada por el alcance global, así
  // que hacerlo otra vez acá sobre 12 filas sólo podía contradecir los conteos.
  const filteredTasks = React.useMemo(() => {
    const result = normalizedSearch
      ? tasks.filter((task) => [task.title, task.subtitle, task.worksiteName, task.statusLabel, moduleMeta(task.type).label]
          .join(" ")
          .toLocaleLowerCase("es-CL")
          .includes(normalizedSearch))
      : [...tasks]

    return result.sort((left, right) => {
      if (sort === "priority") {
        const priorityDifference = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
        if (priorityDifference !== 0) return priorityDifference
      }
      const dateDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      return sort === "newest" ? -dateDifference : dateDifference
    })
  }, [normalizedSearch, sort, tasks])

  const isTruncated = queueSummary.total > tasks.length

  return (
    <>
      {/* ── Greeting header — full width ── */}
      <header className="border-b border-[var(--color-border)] pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            {/* Saludo, no encabezado: el `<h1>` de la página lo emite PageHeader
                y tener dos competía en el árbol de accesibilidad (L-01). */}
            <p className="text-3xl font-bold tracking-tight text-[var(--color-text)]">Hola, {firstName}</p>
            <p className="mt-1.5 max-w-[70ch] text-sm text-[var(--color-text-muted)]">
              {buildOperationalSummary(queueSummary, scope)}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <DashboardScopeControls scope={scope} worksites={worksiteOptions} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-subtle)]">
              <span className="font-medium text-[var(--color-text-muted)]">{contextLabel}</span>
              <span aria-hidden>·</span>
              <time dateTime={refreshedAt}>Actualizado {formatDateTime(refreshedAt)}</time>
            </div>
          </div>
        </div>
      </header>

      {/* ── Grid principal + lateral (C1 — Fase 2.3) ── */}
      <div className="mt-6">
        <DashboardGrid
          main={
            <>
              {/* ── KPIs accionables (tira editorial, máx. 4) ── */}
              {metrics.length > 0 && <OperationalMetricsStrip metrics={metrics} />}

              {/* ── Cola de trabajo — top-N accionable, no la cola completa ── */}
              <section id="cola-de-trabajo" className="scroll-mt-4 min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6 shadow-xs" aria-labelledby="titulo-cola-trabajo">
                <div className="flex flex-col gap-3 border-b border-[var(--color-border)] pb-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h2 id="titulo-cola-trabajo" className="text-h3 text-[var(--color-text)]">Cola de trabajo</h2>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      {isTruncated
                        ? `Las ${tasks.length} tareas más urgentes de tus faenas autorizadas.`
                        : "Acciones disponibles en tus faenas autorizadas."}
                      {" "}El texto se filtra desde la búsqueda de la cabecera.
                    </p>
                  </div>
                  <p aria-live="polite" className="font-mono text-xs font-medium text-[var(--color-text-muted)]">
                    {filteredTasks.length} de {tasks.length} visible{tasks.length === 1 ? "" : "s"}
                  </p>
                </div>

                {/* Conteos de población completa: navegan a /pendientes, no filtran estas filas. */}
                {queueShortcuts.length > 0 && (
                  <nav className="mt-4 flex gap-1.5 overflow-x-auto pb-1" aria-label="Atajos a la cola completa">
                    {queueShortcuts.map((shortcut) => (
                      <Link
                        key={shortcut.key}
                        href={shortcut.href}
                        className={cn(
                          "inline-flex h-11 sm:h-8 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-semibold",
                          "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)]",
                          "transition-all duration-150 ease-out motion-safe:active:scale-[0.97]",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
                        )}
                      >
                        {shortcut.label}
                        <span className="font-mono text-xs tabular-nums opacity-80">{shortcut.count}</span>
                      </Link>
                    ))}
                  </nav>
                )}

                {/* Un solo control: el orden. La faena se elige una vez arriba y
                    reencuadra el tablero completo, así que repetirla acá sería
                    una segunda representación de la misma dimensión (A5). */}
                <div className="mt-4 grid gap-2.5 border-y border-[var(--color-border)] py-3.5 sm:grid-cols-2 xl:grid-cols-3">
                  <FilterSelect label="Ordenar por" value={sort} onValueChange={(value) => setSort(value as SortOption)}>
                    <SelectItem value="priority">Prioridad</SelectItem>
                    <SelectItem value="oldest">Más antigua</SelectItem>
                    <SelectItem value="newest">Más reciente</SelectItem>
                  </FilterSelect>
                </div>

                {filteredTasks.length > 0 ? (
                  <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                    <div className="min-w-[34rem]">
                      <div className="grid grid-cols-[5.5rem_minmax(12rem,1fr)_5rem_9rem] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                        <span>Prioridad</span>
                        <span>Tarea</span>
                        <span>Antigüedad</span>
                        <span className="text-right">Acción</span>
                      </div>
                      <ul className="divide-y divide-[var(--color-border)]">
                        {filteredTasks.map((task) => <WorkQueueRow key={task.id} task={task} refreshedAt={refreshedAt} canAssign={canAssign} />)}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] py-6">
                    <EmptyState
                      compact
                      icon={<ClockCounterClockwise size={20} />}
                      title={normalizedSearch ? "Ninguna tarea coincide con la búsqueda" : "No hay tareas pendientes en este alcance"}
                      description={normalizedSearch
                        ? "Prueba otra búsqueda desde la cabecera."
                        : scope.worksiteName
                          ? `${scope.worksiteName} no tiene acciones disponibles para tu rol. Cambia de faena arriba para ver otra.`
                          : "No hay acciones disponibles para tu rol en las faenas autorizadas."}
                    />
                  </div>
                )}

                {isTruncated && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Mostrando las <span className="font-mono tabular-nums">{tasks.length}</span> más urgentes de{" "}
                      <span className="font-mono tabular-nums">{queueSummary.total}</span> tareas pendientes.
                    </p>
                    <Button asChild size="sm" variant="link"><Link href="/pendientes">Abrir cola completa</Link></Button>
                  </div>
                )}
              </section>

              {/* ── Actividad (reciente + por faena) — inyectada por la página ── */}
              {mainSlot}
            </>
          }
          aside={
            <>
              {/* ── Requiere atención ── */}
              <section aria-labelledby="alertas-operacionales" className="min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
                  <h2 id="alertas-operacionales" className="text-h3 text-[var(--color-text)]">Requiere atención</h2>
                  {alerts.length > 0 && <span className="font-mono text-xs font-semibold text-[var(--color-text-muted)]">{alerts.length} activa{alerts.length === 1 ? "" : "s"}</span>}
                </div>
                {alerts.length > 0 ? (
                  <div className="flex flex-col gap-2.5">
                    {alerts.map((alert) => <OperationalAlert key={alert.key} alert={alert} />)}
                  </div>
                ) : (
                  <div className="py-2">
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
              </section>

              {/* ── PDTP — inyectado por la página ── */}
              {asideSlot}

              {/* ── Métricas mensuales (lectura de apoyo) ── */}
              {periodSummary.length > 0 && (
                <CompactMetricList id="flujo-mensual" title={periodFlowTitle(scope.period)} entries={periodSummary} />
              )}
              {backlogSummary.length > 0 && (
                <CompactMetricList id="backlog-comparado" title="Backlog comparado" entries={backlogSummary} />
              )}
            </>
          }
        />
      </div>
    </>
  )
}

/**
 * Lista compacta de métricas mensuales para el lateral del dashboard.
 */
function CompactMetricList({ id, title, entries }: {
  id: string
  title: string
  entries: OperationalPeriodSummaryEntry[]
}) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <h2 id={id} className="text-h3 text-[var(--color-text)] border-b border-[var(--color-border)] pb-3">{title}</h2>
      <ul className="mt-2 divide-y divide-[var(--color-border)]">
        {entries.map((entry) => (
          <li key={entry.key}>
            <Link
              href={entry.href}
              className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-[var(--color-surface-2)] rounded-lg px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-[var(--color-text)] group-hover:text-[var(--color-primary)]">
                  {entry.label}: <span className="font-mono tabular-nums">{entry.value}</span>
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)]">{entry.comparison}</span>
              </span>
              {/* Sólo con serie real; sin ella la fila conserva su layout. */}
              {entry.sparkline && entry.sparkline.length >= 2 && (
                <span title={`Últimos ${entry.sparkline.length} días con instantánea completa`} className="shrink-0">
                  <MiniSparkline data={entry.sparkline} color={CHART_COLORS.brand} className="h-6 w-14" />
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function OperationalAlert({ alert }: { alert: DashboardAlert }) {
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
        <SelectTrigger aria-label={label} className="h-11 sm:h-9 text-[13px]"><SelectValue /></SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </label>
  )
}

/**
 * Módulo, estado y faena viven dentro de la celda de tarea.
 *
 * Con siete columnas el ancho intrínseco (~1160px) desbordaba el slot de 8/12
 * —que en un portátil de 1440px con el sidebar abierto son ~676px útiles— y la
 * cola scrolleaba horizontalmente siempre (L-02). Con cuatro cabe con holgura.
 */
function WorkQueueRow({ task, refreshedAt, canAssign }: { task: DashboardTask; refreshedAt: string; canAssign: boolean }) {
  const { label: moduleLabel, Icon } = moduleMeta(task.type)
  return (
    <li className="grid grid-cols-[5.5rem_minmax(12rem,1fr)_5rem_9rem] items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-[var(--color-surface-2)]">
      <PriorityBadge priority={task.priority} size="sm" className="justify-self-start" />
      <div className="min-w-0">
        <p className="truncate font-semibold text-[var(--color-text)]" title={task.title}>{task.title}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--color-text-muted)]" title={moduleLabel}>
            <Icon size={13} aria-hidden />{moduleLabel}
          </span>
          <Badge variant="default" size="sm" className="shrink-0">{task.statusLabel}</Badge>
          <span className="truncate text-xs text-[var(--color-text-muted)]" title={`${task.worksiteName} · ${task.subtitle}`}>
            {task.worksiteName} · {task.subtitle}
          </span>
        </div>
      </div>
      <time dateTime={task.createdAt} className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{relativeAge(task.createdAt, refreshedAt)}</time>
      <span className="flex justify-self-end gap-1 whitespace-nowrap">
        {canAssign && task.operationalItem?.assignable ? <WorkAssignmentControl item={task.operationalItem} /> : null}
        <Button asChild size="sm" variant="link"><Link href={task.href}>{task.ctaLabel}</Link></Button>
      </span>
    </li>
  )
}

/**
 * El saludo declara **una** cifra: el total de la cola.
 *
 * Antes enumeraba total, críticas, vencidas y entregas — y cada una de esas tres
 * ya vivía en su chip de atajo y en su tarjeta de alerta. "Críticas" aparecía
 * cuatro veces en la misma pantalla contando el tile. La regla A5 lo prohíbe
 * ("no repitas la misma cifra en dos controles") y el detalle sigue a un clic en
 * los atajos, que además navegan.
 */
function buildOperationalSummary(summary: DashboardControlCenterProps["queueSummary"], scope: DashboardScope) {
  const where = scope.worksiteName ? ` en ${scope.worksiteName}` : ""
  if (summary.total === 0) return `No tienes acciones pendientes${where}.`
  return `Tienes ${summary.total} tarea${summary.total === 1 ? "" : "s"} pendiente${summary.total === 1 ? "" : "s"}${where}.`
}

/**
 * Antigüedad en días de **calendario chileno**, no en múltiplos de 24h.
 *
 * Restar instantes hacía que una tarea creada ayer a las 23:00 y vista hoy a la
 * 01:00 dijera "Hoy": son 2 horas, pero es el día anterior (C1).
 */
function relativeAge(value: string, referenceTime: string) {
  const from = chileDateParts(value)
  const to = chileDateParts(referenceTime)
  const days = Math.max(0, Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000,
  ))
  if (days === 0) return "Hoy"
  if (days === 1) return "1 día"
  return `${days} días`
}
