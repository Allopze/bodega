"use client"

import * as React from "react"
import Link from "next/link"
import {
  CheckSquare,
  ClipboardText,
  ClockCounterClockwise,
  FileText,
  ShoppingCart,
  Truck,
  UsersThree,
  WarningCircle,
  Warehouse,
} from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { chileDateParts, cn } from "@/lib/utils"
import type { WorkPriority, WorkTask, WorkTaskType } from "@/lib/work-queue"
import type { OperationalWorkItem } from "@/lib/services/operational-work-queue"
import { WorkCommitmentControl } from "../../pendientes/work-commitment-control"
import type { DashboardScope } from "../dashboard-scope"

export type DashboardTask = WorkTask & {
  operationalItem?: OperationalWorkItem
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
 * —el de `WorkCommitmentControl`, por ejemplo— desmonta el árbol (hay
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
  cphs:               { label: "Comité Paritario", Icon: UsersThree },
}

const moduleMeta = (type: WorkTaskType): ModuleMeta => MODULE_META[type] ?? MODULE_FALLBACK

const PRIORITY_RANK: Record<WorkPriority, number> = {
  critical: 0,
  high:     1,
  normal:   2,
  low:      3,
}

/**
 * Vista "Mi trabajo": la cola operacional completa.
 *
 * Ocupaba la primera pantalla de Inicio y empujaba todo indicador bajo el
 * pliegue — el primer gráfico aparecía a pantalla y media de scroll. Acá es el
 * contenido principal de su propia pestaña, que es lo que siempre fue.
 */
export function TrabajoView({
  tasks,
  queueSummary,
  queueShortcuts,
  scope,
  canAssign,
  refreshedAt,
}: {
  /**
   * Sólo las tareas más urgentes, NO la cola completa. Todo conteo que deba
   * hablar del backlog entero sale de `queueSummary` o de `queueShortcuts`.
   */
  tasks: DashboardTask[]
  queueSummary: { total: number; critical: number; overdue: number; deliveries: number }
  /** Atajos con conteos de población completa, ya filtrados por permiso. */
  queueShortcuts: QueueShortcut[]
  scope: DashboardScope
  canAssign: boolean
  refreshedAt: string
}) {
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
    <section
      id="cola-de-trabajo"
      className="scroll-mt-4 min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6 shadow-xs"
      aria-labelledby="titulo-cola-trabajo"
    >
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="titulo-cola-trabajo" className="text-h3 text-[var(--color-text)]">Cola de trabajo</h2>
          {/* Sin la coletilla "El texto se filtra desde…": una instrucción
              permanente en un subtítulo es ruido; el placeholder del buscador ya
              lo dice (I-16). */}
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {isTruncated
              ? `Las ${tasks.length} tareas más urgentes de tus faenas autorizadas.`
              : "Acciones disponibles en tus faenas autorizadas."}
          </p>
        </div>
        <p aria-live="polite" className="font-mono text-xs font-medium text-[var(--color-text-muted)]">
          {filteredTasks.length} de {tasks.length} visible{tasks.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* Atajos (población completa, navegan a /pendientes) y el único control
          local —el orden— en UNA fila: la banda anterior reservaba un grid de 3
          columnas para un solo select y quedaba como franja casi vacía de borde
          a borde (I-16). La faena se elige una vez arriba (A5). */}
      <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-2">
        {queueShortcuts.length > 0 && (
          <nav className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1" aria-label="Atajos a la cola completa">
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
        <div className="w-full shrink-0 sm:w-44">
          <FilterSelect label="Ordenar por" value={sort} onValueChange={(value) => setSort(value as SortOption)}>
            <SelectItem value="priority">Prioridad</SelectItem>
            <SelectItem value="oldest">Más antigua</SelectItem>
            <SelectItem value="newest">Más reciente</SelectItem>
          </FilterSelect>
        </div>
      </div>

      {filteredTasks.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {/* Bajo `sm` la fila se apila: la tabla con scroll lateral dejaba
              Antigüedad y el CTA fuera del viewport de 390px sin ningún indicio
              de que existían (I-12). */}
          <div className="sm:min-w-[34rem]">
            <div className="hidden sm:grid grid-cols-[5.5rem_minmax(12rem,1fr)_5rem_9rem] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
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
  )
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
    // Mobile: apilada (badge+edad / título / meta / acciones). Desktop: grid de
    // 4 columnas. La celda de acción envuelve (`flex-wrap`) en vez de
    // `whitespace-nowrap`: "Comprometer fecha" + CTA medían ~230px en una columna de 9rem
    // y desbordaban ENCIMA de "56 días" (I-06).
    <li className="flex flex-col gap-2 px-4 py-3 text-sm transition-colors hover:bg-[var(--color-surface-2)] sm:grid sm:grid-cols-[5.5rem_minmax(12rem,1fr)_5rem_9rem] sm:items-center sm:gap-3">
      <PriorityBadge priority={task.priority} size="sm" className="self-start sm:justify-self-start" />
      <div className="min-w-0">
        <p className="truncate font-semibold text-[var(--color-text)]" title={task.title}>{task.title}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--color-text-muted)]" title={moduleLabel}>
            <Icon size={13} aria-hidden />{moduleLabel}
          </span>
          <Badge variant="default" size="sm" className="shrink-0">{task.statusLabel}</Badge>
          <span className="truncate text-xs text-[var(--color-text-muted)]" title={[task.worksiteName, task.subtitle].filter(Boolean).join(" · ")}>
            {[task.worksiteName, task.subtitle].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>
      <time dateTime={task.createdAt} className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{relativeAge(task.createdAt, refreshedAt)}</time>
      <span className="flex flex-wrap items-center gap-1 sm:justify-end sm:justify-self-end">
        {canAssign && task.operationalItem?.assignable ? <WorkCommitmentControl item={task.operationalItem} /> : null}
        <Button asChild size="sm" variant="link"><Link href={task.href}>{task.ctaLabel}</Link></Button>
      </span>
    </li>
  )
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
