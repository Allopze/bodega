"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, FunnelSimple, WarningCircle } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { OPERATIONAL_MODULE_LABELS } from "@/lib/work-queue"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn, formatDate, formatDateTime } from "@/lib/utils"
import type { OperationalQueueResult, OperationalWorkItem } from "@/lib/services/operational-work-queue"
import { WorkAssignmentControl } from "./work-assignment-control"

const QUICK_FILTERS = [
  ["all", "Todas"], ["critical", "Críticas"], ["overdue", "Vencidas"], ["today", "Hoy"],
  ["blocked", "Bloqueadas"], ["unassigned", "Sin asignar"], ["mine", "Mis tareas"],
] as const

/** Hoy en la zona de operación, para decidir si una fecha ya venció. */
function chileToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })
}

interface WorkQueueWorkbenchProps {
  result: OperationalQueueResult
}

export function WorkQueueWorkbench({ result }: WorkQueueWorkbenchProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [term, setTerm] = React.useState(searchParams.get("q") ?? "")

  React.useEffect(() => setTerm(searchParams.get("q") ?? ""), [searchParams])

  function update(next: Record<string, string | null>, resetCursor = true) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (!value || value === "all") params.delete(key)
      else params.set(key, value)
    }
    if (resetCursor) params.delete("cursor")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    update({ q: term.trim() || null })
  }

  /**
   * A-29: "Página anterior" usa `router.back()`, que es correcto mientras el
   * historial lo haya construido esta lista (los filtros usan `replace`, así que
   * sólo `nextPage` agrega entradas). Pero si se entra por un enlace compartido
   * que ya trae `?cursor=`, el botón aparecía igual y `back()` sacaba al usuario
   * de la aplicación. Este marcador distingue los dos casos.
   *
   * Va en `sessionStorage` y no en estado de React porque `/pendientes` tiene
   * `loading.tsx`: la navegación remonta el árbol y el estado se perdería.
   */
  const advancedKey = `queue-advanced:${pathname}`
  const [advanced, setAdvanced] = React.useState(false)
  React.useEffect(() => {
    try {
      if (!searchParams.get("cursor")) {
        sessionStorage.removeItem(advancedKey)
        setAdvanced(false)
      } else {
        setAdvanced(sessionStorage.getItem(advancedKey) === "1")
      }
    } catch { setAdvanced(false) }
  }, [advancedKey, searchParams])

  function nextPage() {
    if (!result.nextCursor) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("cursor", result.nextCursor)
    try { sessionStorage.setItem(advancedKey, "1") } catch { /* modo privado */ }
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  /** Vuelve al principio limpiando el cursor: nunca sale de la aplicación. */
  function firstPage() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("cursor")
    try { sessionStorage.removeItem(advancedKey) } catch { /* modo privado */ }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  // Una sola lectura por render: todas las filas comparan contra la misma fecha.
  const today = chileToday()
  const activeQuick = searchParams.get("quick") ?? "all"
  const activeFilters = ["q", "module", "faena", "estado", "priority", "quick"].filter((key) => {
    const value = searchParams.get(key)
    return value && value !== "all"
  }).length
  const { modules, worksites, statuses } = result.filterOptions

  return (
    <section aria-labelledby="cola-operacional" className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-[var(--color-border)] pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="cola-operacional" className="text-h2 text-[var(--color-text)]">Cola de trabajo</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{result.total} {result.total === 1 ? "acción" : "acciones"} dentro de tus permisos y faenas.</p>
        </div>
        <time dateTime={result.refreshedAt} className="shrink-0 text-xs text-[var(--color-text-subtle)]">Actualizada {formatDateTime(result.refreshedAt)}</time>
      </div>

      <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row sm:items-center" role="search">
        <label className="sr-only" htmlFor="work-queue-search">Buscar en pendientes</label>
        <input
          id="work-queue-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar código, tarea o faena"
          className="h-11 min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-line)] sm:h-8"
        />
        <Button type="submit" variant="secondary" size="sm"><FunnelSimple size={14} />Buscar</Button>
      </form>

      <div className="flex flex-wrap gap-1 pb-1" aria-label="Filtros rápidos">
        {QUICK_FILTERS.map(([value, label]) => {
          const count = result.summary[value]
          return (
            <button
              key={value}
              type="button"
              aria-pressed={activeQuick === value}
              onClick={() => update({ quick: value })}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius)] border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
                activeQuick === value ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
                count === 0 && activeQuick !== value && "opacity-60",
              )}
            >
              {label}
              {/* El conteo evita tener que pulsar el chip para descubrir si trae algo. */}
              <span className={cn(
                "rounded-full px-1.5 text-[11px] tabular-nums",
                activeQuick === value ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]",
              )}>{count}</span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={searchParams.get("module") ?? "all"} onValueChange={(value) => update({ module: value })}>
          <SelectTrigger aria-label="Filtrar por módulo" className="h-11 sm:h-8 text-xs"><SelectValue placeholder="Módulo" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos los módulos</SelectItem>{modules.map((module) => <SelectItem key={module} value={module}>{OPERATIONAL_MODULE_LABELS[module]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={searchParams.get("faena") ?? "all"} onValueChange={(value) => update({ faena: value })}>
          <SelectTrigger aria-label="Filtrar por faena" className="h-11 sm:h-8 text-xs"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas las faenas</SelectItem>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={searchParams.get("priority") ?? "all"} onValueChange={(value) => update({ priority: value })}>
          <SelectTrigger aria-label="Filtrar por prioridad" className="h-11 sm:h-8 text-xs"><SelectValue placeholder="Prioridad" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas las prioridades</SelectItem><SelectItem value="critical">Crítica</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="low">Baja</SelectItem></SelectContent>
        </Select>
        <Select value={searchParams.get("sort") ?? "priority"} onValueChange={(value) => update({ sort: value })}>
          <SelectTrigger aria-label="Ordenar cola" className="h-11 sm:h-8 text-xs"><SelectValue placeholder="Orden" /></SelectTrigger>
          <SelectContent><SelectItem value="priority">Prioridad</SelectItem><SelectItem value="due">Fecha de vencimiento</SelectItem><SelectItem value="oldest">Más antiguas</SelectItem><SelectItem value="newest">Más recientes</SelectItem></SelectContent>
        </Select>
      </div>

      <details className="rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-muted)]">Más filtros{activeFilters > 0 ? ` (${activeFilters})` : ""}</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Select value={searchParams.get("estado") ?? "all"} onValueChange={(value) => update({ estado: value })}>
            <SelectTrigger aria-label="Filtrar por estado"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos los estados</SelectItem>{statuses.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </details>

      {activeFilters > 0 && <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><span>{activeFilters} filtro{activeFilters === 1 ? "" : "s"} activo{activeFilters === 1 ? "" : "s"}</span><Button type="button" size="sm" variant="link" onClick={() => router.replace(pathname, { scroll: false })}>Limpiar filtros</Button></div>}

      {result.sourceErrors.length > 0 && (
        <div role="status" className="flex gap-2 rounded-[var(--radius)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-warning-ink)]">
          <WarningCircle size={18} className="mt-0.5 shrink-0" />
          <span>{result.sourceErrors.map((error) => error.message).join(" ")}</span>
        </div>
      )}

      {result.items.length === 0 ? (
        <EmptyState compact title="No hay pendientes con estos filtros" description="Cambia o limpia los filtros para revisar otras acciones disponibles." action={activeFilters > 0 ? <Button type="button" size="sm" onClick={() => router.replace(pathname)}>Limpiar filtros</Button> : undefined} />
      ) : (
        <>
          {/* A-21: la tabla tiene `min-w-[980px]`, así que en 390px las columnas
              de acción quedaban a ~600px de scroll horizontal — y con los chips
              scrolleando aparte, había dos scrolls anidados en la misma pantalla.
              Mismo patrón de tarjetas que `recepcion-table`: la tabla desde `md`,
              tarjetas debajo. No se migró a `DataTable` porque esta cola pagina
              por cursor y ordena en SQL, y `DataTable` hace ambas en cliente. */}
          <div className="hidden overflow-x-auto rounded-[var(--radius)] border border-[var(--color-border)] md:block">
            <table className="w-full min-w-[980px] border-collapse text-left text-xs" aria-label="Pendientes operacionales">
              <thead className="bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"><tr><th className="px-3 py-2.5 th-type">Prioridad</th><th className="px-3 py-2.5 th-type">Tarea</th><th className="px-3 py-2.5 th-type">Módulo</th><th className="px-3 py-2.5 th-type">Faena</th><th className="px-3 py-2.5 th-type">Estado</th><th className="px-3 py-2.5 th-type">Antigüedad</th><th className="px-3 py-2.5 th-type">Vencimiento</th><th className="px-3 py-2.5"><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>{result.items.map((item) => <QueueRow key={item.id} item={item} today={today} />)}</tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Pendientes operacionales">
            {result.items.map((item) => <QueueCard key={item.id} item={item} today={today} />)}
          </ul>
        </>
      )}
      {(searchParams.get("cursor") || result.nextCursor) && (
        <nav className="flex flex-wrap justify-center gap-2" aria-label="Paginación de pendientes">
          {searchParams.get("cursor") && (advanced
            ? <Button type="button" variant="ghost" onClick={() => router.back()}>Página anterior</Button>
            : <Button type="button" variant="ghost" onClick={firstPage}>Volver al inicio de la lista</Button>)}
          {result.nextCursor && <Button type="button" variant="secondary" onClick={nextPage}>Siguiente página</Button>}
        </nav>
      )}
    </section>
  )
}

/**
 * Una fila de la cola. La variante del badge se derivaba de `item.status ===
 * "overdue"`, pero `status` es el estado de dominio ("requested", "sent"…) y
 * sólo las obligaciones PDTP llegan con ese valor: en Adquisiciones la rama
 * `warning` era código muerto y una tarea con 40 días de atraso se pintaba igual
 * que una de hoy. Ahora se compara la fecha efectiva contra hoy, que es la misma
 * regla que usa el chip "Vencidas" (auditoría UI/UX 2026-07-29, A-04).
 */
function dueState(item: OperationalWorkItem, today: string) {
  const overdue = item.effectiveDueAt !== null && item.effectiveDueAt < today
  const daysLate = overdue ? Math.floor((Date.parse(today) - Date.parse(item.effectiveDueAt!)) / 86_400_000) : 0
  return { overdue, daysLate }
}

/** Tarjeta equivalente a `QueueRow` para móvil: misma información, sin scroll. */
function QueueCard({ item, today }: { item: OperationalWorkItem; today: string }) {
  const { overdue, daysLate } = dueState(item, today)
  return (
    <li className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={item.href} className="min-w-0 text-sm font-medium text-[var(--color-text)] hover:underline">
          {item.title}
        </Link>
        <PriorityBadge priority={item.priority} />
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
        {item.code && <span>{item.code} · </span>}{OPERATIONAL_MODULE_LABELS[item.module]} · {item.worksiteName}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant={item.blocked ? "danger" : overdue ? "warning" : "info"} size="sm">
          {item.blocked ? "Bloqueada · " : ""}{item.statusLabel}
        </Badge>
        <span className="text-[11px] text-[var(--color-text-subtle)]">
          {item.effectiveDueAt
            ? overdue
              ? `Vencida hace ${daysLate} día${daysLate === 1 ? "" : "s"}`
              : `Vence ${formatDate(item.effectiveDueAt)}`
            : "Sin fecha"}
          {" · "}{relativeAge(item.createdAt)}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <WorkAssignmentControl item={item} showAssignee />
        <Button asChild size="sm" variant="secondary">
          <Link href={item.href}>{item.ctaLabel}<ArrowRight size={14} /></Link>
        </Button>
      </div>
    </li>
  )
}

function QueueRow({ item, today }: { item: OperationalWorkItem; today: string }) {
  const { overdue, daysLate } = dueState(item, today)
  return (
    <tr className="border-t border-[var(--color-border)] align-middle hover:bg-[var(--color-surface-2)]">
      <td className="px-3 py-2.5"><PriorityBadge priority={item.priority} /></td>
      <td className="px-3 py-2.5">
        <Link href={item.href} className="font-medium text-[var(--color-text)] hover:text-[var(--color-primary-ink)] hover:underline">{item.title}</Link>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{item.code && <span>{item.code} · </span>}{item.subtitle}</p>
      </td>
      <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{OPERATIONAL_MODULE_LABELS[item.module]}</td>
      <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{item.worksiteName}</td>
      <td className="px-3 py-2.5">
        <Badge variant={item.blocked ? "danger" : overdue ? "warning" : "info"} size="sm">
          {item.blocked ? "Bloqueada · " : ""}{item.statusLabel}
        </Badge>
      </td>
      <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{relativeAge(item.createdAt)}</td>
      <td className="px-3 py-2.5 text-[var(--color-text-muted)]">
        {item.effectiveDueAt ? (
          <>
            <time dateTime={item.effectiveDueAt} className={overdue ? "font-medium text-[var(--color-warning-ink)]" : undefined}>
              {formatDate(item.effectiveDueAt)}
            </time>
            <span className="block text-[11px] text-[var(--color-text-subtle)]">
              {overdue
                ? `Vencida hace ${daysLate} día${daysLate === 1 ? "" : "s"}`
                : item.dueSource === "commitment" ? "Compromiso" : "Fecha origen"}
            </span>
          </>
        ) : "Sin fecha"}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1">
          <WorkAssignmentControl item={item} showAssignee />
          <Button asChild size="sm" variant="ghost"><Link href={item.href}>{item.ctaLabel}<ArrowRight size={14} /></Link></Button>
        </div>
      </td>
    </tr>
  )
}

function relativeAge(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  return days === 0 ? "Hoy" : days === 1 ? "1 día" : `${days} días`
}
