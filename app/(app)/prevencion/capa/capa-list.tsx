"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Pagination } from "@/components/ui/pagination"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { StageTabs } from "@/components/ui/stage-tabs"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ClipboardText } from "@phosphor-icons/react"
import { CAPA_SOURCE_LABELS, CAPA_STATUS_LABELS, capaStatusBadgeVariant } from "@/lib/prevention/capa"
import type { CapaStatus } from "@/lib/services/prevention-capa"
import type { PaginationState } from "@/lib/pagination"
import { chileDateParts } from "@/lib/utils"
import {
  CAPA_QUICK_FILTER_LABELS,
  buildCapaStatusTabs,
  matchesCapaQuickFilter,
  parseCapaCondition,
  parseCapaStatusView,
  type CapaCondition,
  type CapaStatusCounts,
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
  /** Nombre del responsable actual, resuelto en el servidor. */
  responsibleName: string | null
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
  /** Condiciones que cruzan los estados; cuentan con el estado elegido (lo que la lista mostraría al activarlas). */
  counts: { overdue: number; unreconciled: number; immediateStop: number }
  /** Contadores de las pestañas de estado: con los demás filtros aplicados y sin el de estado. */
  statusCounts: CapaStatusCounts
  pagination: PaginationState
}

const PRIORITY_LABEL: Record<string, string> = {
  low: "Baja", medium: "Media", high: "Alta", critical: "Crítica",
}

export function CapaList({ actions, worksites, counts, statusCounts, pagination }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const { searchQuery } = useSafeShellHeader()
  // Regla A5: el estado son las pestañas (`?status=`) y las tarjetas son condiciones que
  // cruzan los estados (`?vista=overdue|immediate_stop|unreconciled`, que sigue en la URL
  // para que el tablero pueda aterrizar aquí). La página resuelve todos los filtros en el
  // servidor y lee directo de la URL, sin useState (evita el drift previo entre useState
  // y searchParams): `actions` llega ya recortado y la tabla sólo suma el buscador de la
  // barra superior.
  const { getFilter, setFilters, clearFilters: clearUrlFilters } = useUrlFilters()
  const status = parseCapaStatusView(getFilter("status"))
  const source = getFilter("source") || "all"
  const worksite = getFilter("worksite") || "all"
  const condition = parseCapaCondition(getFilter("vista"))
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
    router.replace(qs ? `?${qs}` : "", { scroll: false })
  }

  const filtered = actions.filter((item) => {
    if (!query) return true
    return [item.code, item.finding, item.actionDescription, item.responsibleName, item.responsibleSnapshot, worksiteName.get(item.worksiteId)]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase("es-CL").includes(query))
  })

  const metrics: Array<{ key: CapaCondition; label: string; value: number; detail: string }> = [
    { key: "immediate_stop", label: "Exigen detener la tarea", value: counts.immediateStop, detail: "Respuesta inmediata en terreno" },
    { key: "overdue", label: "Vencidas", value: counts.overdue, detail: "Plazo incumplido" },
  ]

  // Estado y fuente se filtran en el servidor, así que `actions` **ya llega
  // recortado**: usar su tamaño para distinguir "vacío por filtro" de "vacío
  // sin datos" fallaba siempre en ese caso, y la pantalla anunciaba que no hay
  // acciones —sin ofrecer salida— cuando en realidad las había fuera del
  // filtro. La causa se decide por los filtros activos, no por el resultado.
  const hayFiltroActivo = Boolean(status) || source !== "all" || worksite !== "all" || Boolean(condition) || Boolean(query)

  const SOURCE_LABELS = CAPA_SOURCE_LABELS as Record<string, string>
  const activeChips: ActiveFilterChip[] = []
  if (source !== "all") activeChips.push({ key: "source", label: "Fuente", value: source, displayValue: SOURCE_LABELS[source] ?? source })
  if (worksite !== "all") {
    const ws = worksites.find((w) => w.id === worksite)
    if (ws) activeChips.push({ key: "worksite", label: "Faena", value: worksite, displayValue: ws.name })
  }
  if (condition) {
    activeChips.push({ key: "quick", label: "Vista", value: condition, displayValue: CAPA_QUICK_FILTER_LABELS[condition] })
  }
  function handleRemoveChip(key: string) {
    if (key === "quick") {
      setFilters({ vista: null })
      return
    }
    setFilters({ [key]: null })
  }
  // El estado no es un filtro (son las pestañas): limpiar no cambia de pestaña.
  function clearFilters() {
    clearUrlFilters(["status"])
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)]">
        {metrics.map((metric) => (
          <button
            key={metric.key}
            type="button"
            onClick={() => setFilters({ vista: condition === metric.key ? null : metric.key })}
            aria-pressed={condition === metric.key}
            className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      <StageTabs tabs={buildCapaStatusTabs(statusCounts)} ariaLabel="Estado de las acciones CAPA" param="status" />

      <FilterToolbar
        activeChips={activeChips}
        onRemoveChip={handleRemoveChip}
        onClearAll={clearFilters}
        hasActiveFilters={source !== "all" || worksite !== "all" || Boolean(condition)}
        activeCount={condition === "unreconciled" ? 1 : 0}
        overflowFilters={
          <Button
            type="button"
            variant={condition === "unreconciled" ? "primary" : "secondary"}
            onClick={() => setFilters({ vista: condition === "unreconciled" ? null : "unreconciled" })}
            aria-pressed={condition === "unreconciled"}
            className="w-full justify-start"
          >
            Por conciliar ({counts.unreconciled})
          </Button>
        }
      >
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
          action={hayFiltroActivo ? <Button type="button" variant="secondary" onClick={() => clearUrlFilters()}>Ver todas</Button> : undefined}
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
                          <MetaBadge meta={{ label: "Detener la tarea", variant: "danger" }} className="mb-1" />
                        )}
                        <p className="line-clamp-1 text-sm font-medium">{item.finding}</p>
                        <p className="mt-1 line-clamp-1 text-xs text-[var(--color-text-subtle)]">{item.actionDescription}</p>
                      </TableCell>
                      <TableCell>{worksiteName.get(item.worksiteId) ?? item.worksiteId}</TableCell>
                      <TableCell>{item.responsibleName || item.responsibleSnapshot || "Sin asignar"}</TableCell>
                      <TableCell>
                        <span className={overdue ? "font-semibold text-[var(--color-danger)]" : "tabular-nums"}>{item.targetDate}</span>
                        <p className="text-xs text-[var(--color-text-subtle)]">{PRIORITY_LABEL[item.priority] ?? item.priority}</p>
                      </TableCell>
                      <TableCell>
                        <MetaBadge meta={{ label: `${CAPA_STATUS_LABELS[item.status as CapaStatus] ?? item.status}`, variant: capaStatusBadgeVariant(item.status) }} />
                        {item.reconciliationStatus !== "reconciled" && <p className="mt-1 text-xs text-[var(--color-warning-ink)]">Por conciliar</p>}
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
