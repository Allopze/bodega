"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Pagination } from "@/components/ui/pagination"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ClipboardText } from "@phosphor-icons/react"
import { CAPA_SOURCE_LABELS, CAPA_STATUS_LABELS, capaStatusBadgeVariant } from "@/lib/prevention/capa"
import type { CapaStatus } from "@/lib/services/prevention-capa"
import type { PaginationState } from "@/lib/pagination"
import { chileDateParts } from "@/lib/utils"
import {
  CAPA_QUICK_FILTER_LABELS,
  matchesCapaQuickFilter,
  type CapaQuickFilter,
} from "@/lib/prevention/capa-list-filters"

interface CapaListItem {
  id: string
  code: string
  sourceType: string
  sourceId: string
  worksiteId: string
  finding: string
  actionDescription: string
  responsibleSnapshot: string | null
  responsibleUserId: string | null
  priority: string
  targetDate: string
  status: string
  reconciliationStatus: string
  requiresImmediateStop: boolean
  createdAt: string
}

interface Props {
  actions: CapaListItem[]
  worksites: { id: string; name: string }[]
  counts: { open: number; overdue: number; pendingVerification: number; unreconciled: number; immediateStop: number }
  pagination: PaginationState
}

const PRIORITY_LABEL: Record<string, string> = {
  low: "Baja", medium: "Media", high: "Alta", critical: "Crítica",
}

export function CapaList({ actions, worksites, counts, pagination }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const { searchQuery } = useSafeShellHeader()
  // status/source/worksite son filtros SERVER-SIDE (la página re-query por URL);
  // por eso se conservan las claves exactas y se lee directo de la URL sin useState
  // (evita el drift previo entre useState y searchParams). quickFilter es un toggle
  // local de las métricas (no viaja al server).
  const { getFilter, setFilters, clearFilters: clearUrlFilters } = useUrlFilters()
  const status = getFilter("status") || "all"
  const source = getFilter("source") || "all"
  const worksite = getFilter("worksite") || "all"
  const quickFilterValue = getFilter("vista")
  const quickFilter = quickFilterValue === "open" || quickFilterValue === "overdue" || quickFilterValue === "pending_verification" || quickFilterValue === "unreconciled" || quickFilterValue === "immediate_stop"
    ? quickFilterValue
    : "all"
  const worksiteName = React.useMemo(() => new Map(worksites.map((item) => [item.id, item.name])), [worksites])
  const today = React.useMemo(() => {
    const { year, month, day } = chileDateParts()
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }, [])
  const query = searchQuery.trim().toLocaleLowerCase("es-CL")

  function navigateToPage(p: number) {
    const params = new URLSearchParams(sp.toString())
    if (p > 1) params.set("page", String(p))
    else params.delete("page")
    const qs = params.toString()
    router.push(qs ? `?${qs}` : "")
  }

  const filtered = actions.filter((item) => {
    if (!matchesCapaQuickFilter(item, quickFilter, today)) return false
    if (!query) return true
    return [item.code, item.finding, item.actionDescription, item.responsibleSnapshot, worksiteName.get(item.worksiteId)]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase("es-CL").includes(query))
  })

  const metrics: Array<{ key: CapaQuickFilter; label: string; value: number; detail: string }> = [
    { key: "immediate_stop", label: "Exigen detener la tarea", value: counts.immediateStop, detail: "Respuesta inmediata en terreno" },
    { key: "open", label: "Abiertas", value: counts.open, detail: "Requieren gestión" },
    { key: "overdue", label: "Vencidas", value: counts.overdue, detail: "Plazo incumplido" },
    { key: "pending_verification", label: "Por verificar", value: counts.pendingVerification, detail: "Esperan inspección" },
  ]

  // Estado y fuente se filtran en el servidor, así que `actions` **ya llega
  // recortado**: usar su tamaño para distinguir "vacío por filtro" de "vacío
  // sin datos" fallaba siempre en ese caso, y la pantalla anunciaba que no hay
  // acciones —sin ofrecer salida— cuando en realidad las había fuera del
  // filtro. La causa se decide por los filtros activos, no por el resultado.
  const hayFiltroActivo = status !== "all" || source !== "all" || worksite !== "all" || quickFilter !== "all" || Boolean(query)

  const STATUS_LABELS = CAPA_STATUS_LABELS as Record<string, string>
  const SOURCE_LABELS = CAPA_SOURCE_LABELS as Record<string, string>
  const activeChips: ActiveFilterChip[] = []
  if (status !== "all") activeChips.push({ key: "status", label: "Estado", value: status, displayValue: STATUS_LABELS[status] ?? status })
  if (source !== "all") activeChips.push({ key: "source", label: "Fuente", value: source, displayValue: SOURCE_LABELS[source] ?? source })
  if (worksite !== "all") {
    const ws = worksites.find((w) => w.id === worksite)
    if (ws) activeChips.push({ key: "worksite", label: "Faena", value: worksite, displayValue: ws.name })
  }
  if (quickFilter !== "all") {
    activeChips.push({ key: "quick", label: "Vista", value: quickFilter, displayValue: CAPA_QUICK_FILTER_LABELS[quickFilter] })
  }
  function handleRemoveChip(key: string) {
    if (key === "quick") {
      setFilters({ vista: null })
      return
    }
    setFilters({ [key]: null })
  }
  function clearFilters() {
    clearUrlFilters()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.key}
            type="button"
            onClick={() => setFilters({ vista: quickFilter === metric.key ? null : metric.key })}
            aria-pressed={quickFilter === metric.key}
            className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      <FilterToolbar
        activeChips={activeChips}
        onRemoveChip={handleRemoveChip}
        onClearAll={clearFilters}
        hasActiveFilters={status !== "all" || source !== "all" || worksite !== "all" || quickFilter !== "all"}
        activeCount={quickFilter === "unreconciled" ? 1 : 0}
        overflowFilters={
          <Button
            type="button"
            variant={quickFilter === "unreconciled" ? "primary" : "secondary"}
            onClick={() => setFilters({ vista: quickFilter === "unreconciled" ? null : "unreconciled" })}
            aria-pressed={quickFilter === "unreconciled"}
            className="w-full justify-start"
          >
            Por conciliar ({counts.unreconciled})
          </Button>
        }
      >
        <Select value={status} onValueChange={(value) => setFilters({ status: value === "all" ? null : value })}>
          <SelectTrigger className="w-48" aria-label="Estado CAPA"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(CAPA_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(value) => setFilters({ source: value === "all" ? null : value })}>
          <SelectTrigger className="w-44" aria-label="Fuente CAPA"><SelectValue placeholder="Fuente" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las fuentes</SelectItem>
            {Object.entries(CAPA_SOURCE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={worksite} onValueChange={(value) => setFilters({ worksite: value === "all" ? null : value })}>
          <SelectTrigger className="w-52" aria-label="Faena CAPA"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterToolbar>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={20} />}
          title={hayFiltroActivo ? "No hay acciones con estos filtros" : "Aún no hay acciones CAPA"}
          description={hayFiltroActivo
            ? "Ajusta los filtros o el texto del buscador superior para volver a ver acciones."
            : "Las acciones aparecerán al registrar hallazgos desde PPA, PDTP, evaluaciones, incidentes o riesgos."}
          action={hayFiltroActivo ? <Button type="button" variant="secondary" onClick={clearFilters}>Ver todas</Button> : undefined}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código / fuente</TableHead>
                  <TableHead>Hallazgo y acción</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Plazo</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => {
                  const overdue = matchesCapaQuickFilter(item, "overdue", today)
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Link href={`/prevencion/capa/${item.id}`} className="font-mono text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">
                          {item.code}
                        </Link>
                        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{CAPA_SOURCE_LABELS[item.sourceType] ?? item.sourceType}</p>
                      </TableCell>
                      <TableCell className="max-w-md">
                        {item.requiresImmediateStop && (
                          <Badge variant="danger" className="mb-1">Detener la tarea</Badge>
                        )}
                        <p className="line-clamp-1 text-sm font-medium">{item.finding}</p>
                        <p className="mt-1 line-clamp-1 text-xs text-[var(--color-text-subtle)]">{item.actionDescription}</p>
                      </TableCell>
                      <TableCell>{worksiteName.get(item.worksiteId) ?? item.worksiteId}</TableCell>
                      <TableCell>{item.responsibleSnapshot || (item.responsibleUserId ? "Usuario asignado" : "Sin asignar")}</TableCell>
                      <TableCell>
                        <span className={overdue ? "font-semibold text-[var(--color-danger)]" : "tabular-nums"}>{item.targetDate}</span>
                        <p className="text-xs text-[var(--color-text-subtle)]">{PRIORITY_LABEL[item.priority] ?? item.priority}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={capaStatusBadgeVariant(item.status)}>{CAPA_STATUS_LABELS[item.status as CapaStatus] ?? item.status}</Badge>
                        {item.reconciliationStatus !== "reconciled" && <p className="mt-1 text-xs text-[var(--color-warning)]">Por conciliar</p>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex justify-center pt-2">
              <Pagination page={pagination.page} total={pagination.totalItems} perPage={pagination.limit} onPage={navigateToPage} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
