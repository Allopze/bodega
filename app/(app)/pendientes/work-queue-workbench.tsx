"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, FunnelSimple, WarningCircle } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn, formatDate, formatDateTime } from "@/lib/utils"
import type { OperationalModule, OperationalQueueResult } from "@/lib/services/operational-work-queue"

const MODULE_LABELS: Record<OperationalModule, string> = {
  solicitudes: "Solicitudes", aprobaciones: "Aprobaciones", compras: "Compras", recepciones: "Recepciones", entregas: "Entregas",
  pdtp: "PDTP", capa: "CAPA", inspecciones: "Inspecciones", documentacion: "Documentación", ppa: "PPA", sst: "SST",
}

const QUICK_FILTERS = [
  ["all", "Todas"], ["critical", "Críticas"], ["overdue", "Vencidas"], ["today", "Hoy"], ["blocked", "Bloqueadas"], ["mine", "Mis tareas"],
] as const

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

  function nextPage() {
    if (!result.nextCursor) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("cursor", result.nextCursor)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

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
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{result.total} acciones priorizadas dentro de tus permisos y faenas.</p>
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

      <div className="flex gap-1 overflow-x-auto pb-1" aria-label="Filtros rápidos">
        {QUICK_FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={activeQuick === value}
            onClick={() => update({ quick: value })}
            className={cn(
              "h-9 shrink-0 rounded-[var(--radius)] border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
              activeQuick === value ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
            )}
          >{label}</button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={searchParams.get("module") ?? "all"} onValueChange={(value) => update({ module: value })}>
          <SelectTrigger aria-label="Filtrar por módulo" className="h-11 sm:h-8 text-xs"><SelectValue placeholder="Módulo" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos los módulos</SelectItem>{modules.map((module) => <SelectItem key={module} value={module}>{MODULE_LABELS[module]}</SelectItem>)}</SelectContent>
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
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-border)]">
          <table className="w-full min-w-[980px] border-collapse text-left text-xs" aria-label="Pendientes operacionales">
            <thead className="bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"><tr><th className="px-3 py-2.5 th-type">Prioridad</th><th className="px-3 py-2.5 th-type">Tarea</th><th className="px-3 py-2.5 th-type">Módulo</th><th className="px-3 py-2.5 th-type">Faena</th><th className="px-3 py-2.5 th-type">Estado</th><th className="px-3 py-2.5 th-type">Antigüedad</th><th className="px-3 py-2.5 th-type">Vencimiento</th><th className="px-3 py-2.5"><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>{result.items.map((item) => <tr key={item.id} className="border-t border-[var(--color-border)] align-middle hover:bg-[var(--color-surface-2)]"><td className="px-3 py-2.5"><PriorityBadge priority={item.priority} /></td><td className="px-3 py-2.5"><Link href={item.href} className="font-medium text-[var(--color-text)] hover:text-[var(--color-primary-ink)] hover:underline">{item.title}</Link><p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{item.code && <span>{item.code} · </span>}{item.subtitle}</p></td><td className="px-3 py-2.5 text-[var(--color-text-muted)]">{MODULE_LABELS[item.module]}</td><td className="px-3 py-2.5 text-[var(--color-text-muted)]">{item.worksiteName}</td><td className="px-3 py-2.5"><Badge variant={item.blocked ? "danger" : item.status === "overdue" ? "warning" : "info"} size="sm">{item.blocked ? "Bloqueada · " : ""}{item.statusLabel}</Badge></td><td className="px-3 py-2.5 text-[var(--color-text-muted)]">{relativeAge(item.createdAt)}</td><td className="px-3 py-2.5 text-[var(--color-text-muted)]">{item.effectiveDueAt ? <><time dateTime={item.effectiveDueAt}>{formatDate(item.effectiveDueAt)}</time><span className="block text-[11px] text-[var(--color-text-subtle)]">{item.dueSource === "commitment" ? "Compromiso" : "Fecha origen"}</span></> : "Sin fecha"}</td><td className="px-3 py-2.5"><div className="flex items-center justify-end gap-1"><Button asChild size="sm" variant="ghost"><Link href={item.href}>{item.ctaLabel}<ArrowRight size={14} /></Link></Button></div></td></tr>)}</tbody>
          </table>
        </div>
      )}
      {(searchParams.get("cursor") || result.nextCursor) && (
        <nav className="flex flex-wrap justify-center gap-2" aria-label="Paginación de pendientes">
          {searchParams.get("cursor") && <Button type="button" variant="ghost" onClick={() => router.back()}>Página anterior</Button>}
          {result.nextCursor && <Button type="button" variant="secondary" onClick={nextPage}>Siguiente página</Button>}
        </nav>
      )}
    </section>
  )
}

function relativeAge(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  return days === 0 ? "Hoy" : days === 1 ? "1 día" : `${days} días`
}
