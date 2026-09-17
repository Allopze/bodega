"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Callout } from "@/components/ui/callout"
import { DEFAULT_QUEUE_SORT, OPERATIONAL_MODULE_LABELS } from "@/lib/work-queue"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn, formatDate, formatDateTime } from "@/lib/utils"
import type { OperationalQueueResult, OperationalWorkItem } from "@/lib/services/operational-work-queue"
import { Table, TableBody, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

const QUICK_FILTERS = [
  ["all", "Todas"], ["critical", "Críticas"], ["overdue", "Vencidas"], ["today", "Hoy"],
  // "Mis tareas" dentro de una página titulada "Mis pendientes" se leía como
  // una contradicción: todo lo de la cola ya es del usuario. Lo que este chip
  // filtra es lo que tiene responsable asignado — y así lo dice.
  ["blocked", "Bloqueadas"], ["unassigned", "Sin responsable"], ["mine", "Asignadas a mí"],
] as const

const PRIMARY_QUICK_FILTERS = QUICK_FILTERS.filter(([value]) => ["all", "critical", "overdue", "mine"].includes(value))
const SECONDARY_QUICK_FILTERS = QUICK_FILTERS.filter(([value]) => !["all", "critical", "overdue", "mine"].includes(value))

const SORT_CAPTIONS: Record<string, string> = {
  priority: "ordenados por prioridad y luego por vencimiento",
  due: "ordenados por vencimiento, lo más atrasado primero",
  oldest: "ordenados de más antiguos a más recientes",
  newest: "ordenados de más recientes a más antiguos",
}

const PRIORITY_LABELS: Record<string, string> = {
  critical: "Crítica",
  high: "Alta",
  normal: "Normal",
  low: "Baja",
}

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
  const advancedFilterCount = ["module", "estado", "priority"].filter((key) => {
    const value = searchParams.get(key)
    return value && value !== "all"
  }).length
  const activeChips: ActiveFilterChip[] = []
  const query = searchParams.get("q")
  const moduleFilter = searchParams.get("module")
  const worksiteId = searchParams.get("faena")
  const priority = searchParams.get("priority")
  const status = searchParams.get("estado")
  const quickLabel = QUICK_FILTERS.find(([value]) => value === activeQuick)?.[1]
  if (query) activeChips.push({ key: "q", label: "Búsqueda", value: query, displayValue: query })
  if (quickLabel && activeQuick !== "all") activeChips.push({ key: "quick", label: "Vista rápida", value: activeQuick, displayValue: quickLabel })
  if (worksiteId && worksiteId !== "all") {
    const worksite = worksites.find((item) => item.id === worksiteId)
    if (worksite) activeChips.push({ key: "faena", label: "Faena", value: worksiteId, displayValue: worksite.name })
  }
  if (moduleFilter && moduleFilter !== "all") activeChips.push({ key: "module", label: "Módulo", value: moduleFilter, displayValue: OPERATIONAL_MODULE_LABELS[moduleFilter as keyof typeof OPERATIONAL_MODULE_LABELS] ?? moduleFilter })
  if (priority && priority !== "all") activeChips.push({ key: "priority", label: "Prioridad", value: priority, displayValue: PRIORITY_LABELS[priority] ?? priority })
  if (status && status !== "all") {
    const statusLabel = statuses.find((item) => item.value === status)?.label ?? status
    activeChips.push({ key: "estado", label: "Estado", value: status, displayValue: statusLabel })
  }

  return (
    <section aria-labelledby="cola-operacional" className="space-y-4">
      {/* El encabezado eran tres líneas apiladas bajo el `<h1>` de la página:
          título, conteo y fecha de actualización. El conteo y la fecha son la
          misma clase de dato —metadatos de esta lista—, así que van juntos en
          una sola línea y el `<h2>` queda solo. */}
      <div className="flex flex-col gap-1 border-b border-[var(--color-border)] pb-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h2 id="cola-operacional" className="text-h2 text-[var(--color-text)]">Cola de trabajo</h2>
        <p className="text-xs text-[var(--color-text-subtle)]">
          {result.total} {result.total === 1 ? "acción" : "acciones"} dentro de tus permisos y faenas
          {" · "}Actualizada <time dateTime={result.refreshedAt}>{formatDateTime(result.refreshedAt)}</time>
        </p>
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
        {/* Lupa, no embudo: el embudo significa filtrar y este botón busca. */}
        <Button type="submit" variant="secondary" size="sm"><MagnifyingGlass size={14} />Buscar</Button>
      </form>

      <div className="flex flex-wrap gap-1 pb-1" aria-label="Vistas rápidas de pendientes">
        {PRIMARY_QUICK_FILTERS.map(([value, label]) => {
          const count = result.summary[value]
          // Un chip en 0 lleva a una lista vacía. Se probó deshabilitarlo, pero
          // sigue siendo un destino legítimo: pulsarlo es cómo el usuario
          // confirma "no hay nada crítico ahora mismo", y con la vista rápida
          // aplicada la lista vacía lo dice explícitamente. Lo que faltaba no
          // era bloquear el click sino explicar el 0.
          const empty = count === 0 && activeQuick !== value
          return (
            <button
              key={value}
              type="button"
              aria-pressed={activeQuick === value}
              title={empty ? "Sin pendientes en esta vista con los filtros actuales" : undefined}
              onClick={() => update({ quick: value })}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius)] border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
                activeQuick === value ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
                empty && "opacity-60",
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

      <FilterToolbar
        activeChips={activeChips}
        activeCount={advancedFilterCount}
        hasActiveFilters={activeFilters > 0}
        onRemoveChip={(key) => update({ [key]: null })}
        onClearAll={() => router.replace(pathname, { scroll: false })}
        overflowFilters={
          <>
            <div className="space-y-2">
              <p className="text-eyebrow">Vistas adicionales</p>
              <div className="flex flex-wrap gap-1">
                {SECONDARY_QUICK_FILTERS.map(([value, label]) => (
                  <Button key={value} type="button" variant={activeQuick === value ? "primary" : "secondary"} size="sm" onClick={() => update({ quick: value })}>
                    {label} <span className="font-mono tabular-nums">{result.summary[value]}</span>
                  </Button>
                ))}
              </div>
            </div>
            <Select value={searchParams.get("module") ?? "all"} onValueChange={(value) => update({ module: value })}>
              <SelectTrigger aria-label="Filtrar por módulo"><SelectValue placeholder="Módulo" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los módulos</SelectItem>{modules.map((item) => <SelectItem key={item} value={item}>{OPERATIONAL_MODULE_LABELS[item]}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={searchParams.get("priority") ?? "all"} onValueChange={(value) => update({ priority: value })}>
              <SelectTrigger aria-label="Filtrar por prioridad"><SelectValue placeholder="Prioridad" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todas las prioridades</SelectItem><SelectItem value="critical">Crítica</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="low">Baja</SelectItem></SelectContent>
            </Select>
            <Select value={searchParams.get("estado") ?? "all"} onValueChange={(value) => update({ estado: value })}>
              <SelectTrigger aria-label="Filtrar por estado"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los estados</SelectItem>{statuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </>
        }
      >
        {/* El ancho lo devuelve `FilterToolbar`; el mínimo es para que el
            nombre de faena no baile de ancho al cambiar de selección. */}
        <Select value={searchParams.get("faena") ?? "all"} onValueChange={(value) => update({ faena: value })}>
          <SelectTrigger aria-label="Filtrar por faena" className="h-11 min-w-44 sm:h-8 text-xs"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas las faenas</SelectItem>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}</SelectContent>
        </Select>
        {/* Las etiquetas dicen "Ordenar por …" y no sólo "Prioridad": con el
            filtro de prioridad viviendo en "Más filtros", un trigger que decía
            "Prioridad" parecía un segundo filtro y no el criterio de orden. */}
        <Select value={searchParams.get("sort") ?? DEFAULT_QUEUE_SORT} onValueChange={(value) => update({ sort: value })}>
          <SelectTrigger aria-label="Ordenar por" className="h-11 min-w-52 sm:h-8 text-xs"><SelectValue placeholder="Ordenar por" /></SelectTrigger>
          <SelectContent><SelectItem value="priority">Ordenar por prioridad</SelectItem><SelectItem value="due">Ordenar por vencimiento</SelectItem><SelectItem value="oldest">Más antiguas primero</SelectItem><SelectItem value="newest">Más recientes primero</SelectItem></SelectContent>
        </Select>
      </FilterToolbar>

      {result.sourceErrors.length > 0 && (
        <Callout tone="warning" icon={<WarningCircle size={18} />} className="px-3 py-2">
          {result.sourceErrors.map((error) => error.message).join(" ")}
        </Callout>
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
          <div className="hidden md:block">
            <TableRoot>
            {/* "Antigüedad" y "Vencimiento" eran dos columnas para un mismo
                dato: en una fila vencida decían "33 días" y "Vencida hace 33
                días". Quedó una sola columna, y la antigüedad sólo aparece
                cuando aporta algo (la fila todavía no vence, o no tiene fecha). */}
            <Table className="min-w-[900px] text-left text-xs" aria-label="Pendientes operacionales">
              {/* El resumen describe el orden real: quedaba mintiendo cada vez
                  que el usuario cambiaba el criterio en el selector. */}
              <caption className="sr-only">Pendientes operacionales {SORT_CAPTIONS[searchParams.get("sort") ?? DEFAULT_QUEUE_SORT] ?? SORT_CAPTIONS[DEFAULT_QUEUE_SORT]}</caption>
              <TableHeader><TableRow><TableHead>Prioridad</TableHead><TableHead>Tarea</TableHead><TableHead>Módulo</TableHead><TableHead>Faena</TableHead><TableHead>Estado</TableHead><TableHead>Vencimiento</TableHead><TableHead><span className="sr-only">Acciones</span></TableHead></TableRow></TableHeader>
              <TableBody>{result.items.map((item) => <QueueRow key={item.id} item={item} today={today} />)}</TableBody>
            </Table>
            </TableRoot>
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
 * Una fila de la cola. Compara la fecha de origen contra hoy — misma regla que
 * usa el chip "Vencidas" (auditoría UI/UX 2026-07-29, A-04). El atraso se
 * muestra sólo en el texto de fecha ("Vencida hace N días"); el badge de
 * `statusLabel` ya no cambia de variante por vencimiento (antes saltaba a
 * `warning`, y la misma etiqueta de estado se veía en mayúscula monoespaciada
 * de un momento a otro sólo por estar atrasada — confuso, y redundante con el
 * texto de fecha que ya lo dice).
 */
function dueState(item: OperationalWorkItem, today: string) {
  const overdue = item.sourceDueAt !== null && item.sourceDueAt < today
  const daysLate = overdue ? Math.floor((Date.parse(today) - Date.parse(item.sourceDueAt!)) / 86_400_000) : 0
  return { overdue, daysLate }
}

/**
 * El atraso se escalona en tres tramos. Con la mitad de la cola vencida —35 de
 * 72 en una faena real—, pintar todas las filas del mismo naranjo hacía que
 * ninguna destacara: la señal se anulaba a sí misma. Un mes de atraso ya no se
 * ve igual que tres días.
 */
function overdueTone(daysLate: number) {
  if (daysLate > 30) return "font-semibold text-[var(--color-danger-ink)]"
  if (daysLate > 7) return "text-[var(--color-danger-ink)]"
  return "text-[var(--color-warning-ink)]"
}

/** Texto de la línea secundaria de la columna de vencimiento. */
function dueMeta(item: OperationalWorkItem, overdue: boolean, daysLate: number) {
  if (overdue) return `Vencida hace ${daysLate} día${daysLate === 1 ? "" : "s"}`
  return ageLabel(item.createdAt)
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
        <MetaBadge meta={{ label: `${item.blocked ? "Bloqueada · " : ""}${item.statusLabel}`, variant: item.blocked ? "danger" : "info" }} />
        {/* Con dueño nominal, la fila no le aparece a nadie más de su cargo:
            decirlo aquí es lo que distingue "me toca a mí" de "le toca a
            cualquiera del equipo". */}
        {item.assignee && <MetaBadge meta={{ label: `Asignada a ${item.assignee.name}`, variant: "outline" }} />}
        <span className={cn("text-[11px]", overdue ? overdueTone(daysLate) : "text-[var(--color-text-subtle)]")}>
          {item.sourceDueAt
            ? overdue
              ? `Vencida hace ${daysLate} día${daysLate === 1 ? "" : "s"}`
              : `Vence ${formatDate(item.sourceDueAt)} · ${ageLabel(item.createdAt)}`
            : `Sin fecha · ${ageLabel(item.createdAt)}`}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
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
    <tr className="group border-t border-[var(--color-border)] align-middle hover:bg-[var(--color-surface-2)]">
      <td className="px-3 py-2.5"><PriorityBadge priority={item.priority} /></td>
      <td className="px-3 py-2.5">
        <Link href={item.href} className="font-medium text-[var(--color-text)] hover:text-[var(--color-primary-ink)] hover:underline">{item.title}</Link>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{[item.code, item.subtitle].filter(Boolean).join(" · ")}</p>
      </td>
      <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{OPERATIONAL_MODULE_LABELS[item.module]}</td>
      <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{item.worksiteName}</td>
      <td className="px-3 py-2.5">
        <MetaBadge meta={{ label: `${item.blocked ? "Bloqueada · " : ""}${item.statusLabel}`, variant: item.blocked ? "danger" : "info" }} />
        {item.assignee && (
          <MetaBadge meta={{ label: `Asignada a ${item.assignee.name}`, variant: "outline" }} className="mt-1" />
        )}
      </td>
      <td className="px-3 py-2.5 text-[var(--color-text-muted)]">
        {item.sourceDueAt
          ? <time dateTime={item.sourceDueAt} className={overdue ? overdueTone(daysLate) : undefined}>{formatDate(item.sourceDueAt)}</time>
          : "Sin fecha"}
        <span className={cn("block text-[11px]", overdue ? overdueTone(daysLate) : "text-[var(--color-text-subtle)]")}>
          {dueMeta(item, overdue, daysLate)}
        </span>
      </td>
      <td className="px-3 py-2.5">
        {/* El mismo CTA repetido en cada fila era una columna de texto idéntico
            leída de arriba abajo. La flecha queda siempre; el verbo aparece al
            posar o al enfocar la fila. `aria-label` mantiene el nombre
            accesible estable, así que el lector de pantalla no pierde nada. */}
        <div className="flex items-center justify-end gap-1">
          <Button asChild size="sm" variant="ghost">
            <Link href={item.href} aria-label={item.ctaLabel}>
              <span aria-hidden className="opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-within:opacity-100">{item.ctaLabel}</span>
              <ArrowRight size={14} />
            </Link>
          </Button>
        </div>
      </td>
    </tr>
  )
}

/** Cuánto lleva la tarea esperando, para la línea secundaria del vencimiento. */
function ageLabel(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  return days === 0 ? "Ingresó hoy" : days === 1 ? "En cola 1 día" : `En cola ${days} días`
}
