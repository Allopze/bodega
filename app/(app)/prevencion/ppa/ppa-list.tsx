"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MagnifyingGlass, ShieldCheck } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { StateBadge } from "@/components/states/state-badge"
import { Input } from "@/components/ui/input"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { WorksiteSelect } from "@/components/ui/worksite-select"
import { Pagination } from "@/components/ui/pagination"
import { cn, formatDateTime } from "@/lib/utils"
import type { PpaRow, PpaStats } from "@/lib/services/ppa"
import { tipoTrabajoLabel } from "@/lib/ppa/types"
import { listPpaAction, type PpaListClientFilters } from "./actions"
import { buildPpaDetailHref, buildPpaListFilters, buildPpaListHref, type PpaListFilterState } from "./list-filters"

const QUICK_FILTERS: { value: string; label: string; tone?: "signal"; countKey?: keyof PpaStats }[] = [
  { value: "",              label: "Todos",         countKey: "total" },
  { value: "pendientes",    label: "Por revisar",   tone: "signal", countKey: "pendientes" },
  { value: "detenido",      label: "Detenidos",     tone: "signal", countKey: "detenidos" },
  { value: "autorizado",    label: "Autorizados",   countKey: "autorizados" },
  { value: "rechazado",     label: "Rechazados",    countKey: "rechazados" },
  { value: "aprobado_auto", label: "Aprob. auto",   countKey: "aprobadosAuto" },
  { value: "en_correccion", label: "En corrección" },
  { value: "cerrado",       label: "Cerrados" },
]

interface Props {
  initialRows: PpaRow[]
  total: number
  pageSize: number
  initialFilterState: PpaListFilterState
  initialPage: number
  worksiteOptions: { id: string; name: string }[]
  canReview: boolean
  stats?: PpaStats
}

interface PpaListState {
  rows: PpaRow[]
  total: number
  page: number
  filters: PpaListFilterState
  loadError: string | null
}

type PpaListAction =
  | { type: "sync"; rows: PpaRow[]; total: number; page: number; filters: PpaListFilterState }
  | { type: "filters"; patch: Partial<PpaListFilterState> }
  | { type: "clearFilters" }
  | { type: "page"; page: number }
  | { type: "loaded"; rows: PpaRow[]; total: number }
  | { type: "loadError"; message: string | null }

function createPpaListState({ initialRows, total, initialPage, initialFilterState }: Pick<Props, "initialRows" | "total" | "initialPage" | "initialFilterState">): PpaListState {
  return { rows: initialRows, total, page: initialPage, filters: initialFilterState, loadError: null }
}

function ppaListReducer(state: PpaListState, action: PpaListAction): PpaListState {
  switch (action.type) {
    case "sync":
      return { rows: action.rows, total: action.total, page: action.page, filters: action.filters, loadError: null }
    case "filters":
      return { ...state, page: 1, filters: { ...state.filters, ...action.patch } }
    case "clearFilters":
      return { ...state, page: 1, filters: { estado: "", worksiteId: "", search: "", dateFrom: "", dateTo: "" } }
    case "page":
      return { ...state, page: action.page }
    case "loaded":
      return { ...state, rows: action.rows, total: action.total, loadError: null }
    case "loadError":
      return { ...state, loadError: action.message }
  }
}

export function PpaList({
  initialRows,
  total: initialTotal,
  pageSize,
  initialFilterState,
  initialPage,
  worksiteOptions,
  canReview,
  stats,
}: Props) {
  const router = useRouter()
  const [state, dispatch] = React.useReducer(
    ppaListReducer,
    { initialRows, total: initialTotal, initialPage, initialFilterState },
    createPpaListState,
  )
  const [pending, startTransition] = React.useTransition()
  const { rows, total, page, filters: filterState, loadError } = state
  const { search, estado, worksiteId, dateFrom, dateTo } = filterState

  const filtersActive = !!(estado || worksiteId || search.trim() || dateFrom || dateTo)
  const firstRender = React.useRef(true)
  const latestRequestIdRef = React.useRef(0)

  const filters = React.useMemo<PpaListClientFilters>(
    () => buildPpaListFilters(filterState),
    [filterState],
  )

  React.useEffect(() => {
    firstRender.current = true
    dispatch({ type: "sync", rows: initialRows, total: initialTotal, page: initialPage, filters: initialFilterState })
  }, [initialRows, initialTotal, initialPage, initialFilterState])

  React.useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    const requestId = ++latestRequestIdRef.current
    const handle = setTimeout(() => {
      router.replace(buildPpaListHref(filterState, page))
      dispatch({ type: "loadError", message: null })
      startTransition(async () => {
        const res = await listPpaAction(filters, pageSize, (page - 1) * pageSize)
        if (latestRequestIdRef.current !== requestId) return
        if (res.ok && res.data) {
          dispatch({ type: "loaded", rows: res.data.rows, total: res.data.total })
        } else {
          dispatch({ type: "loadError", message: res.message ?? "No fue posible actualizar la lista de PPA." })
        }
      })
    }, 250)
    return () => clearTimeout(handle)
  }, [filters, page, pageSize, router, filterState])

  function onFilterChange(patch: Partial<PpaListFilterState>) {
    dispatch({ type: "filters", patch })
  }

  function clearFilters() {
    dispatch({ type: "clearFilters" })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Quick-filters — underline tabs */}
      <div className="flex items-end gap-0 border-b border-[var(--color-border)]">
        {QUICK_FILTERS.map((f) => {
          const active = estado === f.value
          const count = stats && f.countKey ? (stats[f.countKey] as number) : null
          return (
            <button
              key={f.value || "all"}
              type="button"
              onClick={() => onFilterChange({ estado: f.value })}
              className={cn(
                "-mb-px px-3.5 pb-2.5 pt-1 text-sm font-medium",
                "border-b-2 transition-[color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                active
                  ? f.tone === "signal"
                    ? "border-[var(--color-signal)] text-[var(--color-signal-ink)]"
                    : "border-[var(--color-text)] text-[var(--color-text)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]",
              )}
              aria-pressed={active}
            >
              {f.label}
              {count !== null && (
                <span className={cn(
                  "ml-1.5 font-mono text-xs tabular-nums",
                  active ? "opacity-80" : "text-[var(--color-text-faint)]",
                )}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
        {canReview && (
          <span className="ml-auto hidden pb-2.5 text-xs text-[var(--color-text-subtle)] sm:inline">
            Revisa los trabajos detenidos desde su detalle.
          </span>
        )}
      </div>

      {/* Filtros detallados */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center">
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute left-2.5 shrink-0 text-[var(--color-text-subtle)]"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => onFilterChange({ search: e.target.value })}
            placeholder="Buscar por trabajador o tarea..."
            aria-label="Buscar"
            className="h-8 w-48 pl-8 text-xs sm:w-64"
          />
        </div>

        {worksiteOptions.length > 1 && (
          <WorksiteSelect
            worksites={worksiteOptions}
            value={worksiteId}
            onChange={(val) => onFilterChange({ worksiteId: val })}
            triggerClassName="w-44 h-8 text-xs"
          />
        )}

        <DateRangePicker
          fromValue={dateFrom}
          toValue={dateTo}
          onFromChange={(iso) => onFilterChange({ dateFrom: iso })}
          onToChange={(iso) => onFilterChange({ dateTo: iso })}
          className="flex items-center gap-2"
          pickerClassName="w-[9.5rem] h-8 text-xs"
        />

        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-medium text-[var(--color-primary)] underline-offset-2 hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {pending && <p role="status" aria-live="polite" className="text-xs text-[var(--color-text-subtle)]">Actualizando resultados…</p>}
      {loadError && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{loadError}</p>}

      {rows.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={<ShieldCheck />}
            title="Sin coincidencias"
            description="Ningún PPA coincide con los filtros aplicados."
            action={
              <button
                type="button"
                onClick={clearFilters}
                className="text-sm font-medium text-[var(--color-primary)] hover:underline"
              >
                Limpiar filtros
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<ShieldCheck />}
            title="Aún no hay PPA registrados"
            description="Comparte el enlace o QR del formulario con tu equipo en terreno para empezar a recibir evaluaciones."
            tone="neutral"
          />
        )
      ) : (
        <>
          {/* Tabla (md+) */}
          <TableRoot className={cn("hidden md:block", pending && "opacity-60 transition-opacity duration-[var(--duration-default)] ease-[var(--ease-out)]")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Trabajador</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Tarea</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const href = buildPpaDetailHref(r.id, { estado, worksiteId, search, dateFrom, dateTo }, page)
                  return (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-[var(--color-primary-tint)]">
                      <TableCell><Link href={href} className="block">{formatDateTime(r.createdAt)}</Link></TableCell>
                      <TableCell>
                        <Link href={href} className="block">
                          {r.workerName}
                          {r.manualIdentificacion && (
                            <Badge variant="warning" size="sm" className="ml-2">Manual</Badge>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell><Link href={href} className="block">{r.worksiteName ?? "—"}</Link></TableCell>
                      <TableCell><Link href={href} className="block">{tipoTrabajoLabel(r.tipoTrabajo)}</Link></TableCell>
                      <TableCell>
                        <Link href={href} className="block">
                          {r.resultado === "detenido"
                            ? <span className="text-[var(--color-danger-ink)]">Detenido</span>
                            : <span className="text-[var(--color-text-muted)]">Sin detención</span>}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={href} className="block">
                          <StateBadge state={r.estado} entity="ppa" size="sm" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Pagination page={page} total={total} perPage={pageSize} onPage={(nextPage) => dispatch({ type: "page", page: nextPage })} />
          </TableRoot>

          {/* Cards (mobile) */}
          <div className={cn("flex flex-col gap-2 md:hidden", pending && "opacity-60 transition-opacity duration-[var(--duration-default)] ease-[var(--ease-out)]")}>
            {rows.map((r) => (
              <Link
                key={r.id}
                href={buildPpaDetailHref(r.id, { estado, worksiteId, search, dateFrom, dateTo }, page)}
                data-pressable
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3 transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">
                    {r.workerName}
                    {r.manualIdentificacion && (
                      <Badge variant="warning" size="sm" className="ml-2">Manual</Badge>
                    )}
                  </span>
                  <StateBadge state={r.estado} entity="ppa" size="sm" />
                </div>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {tipoTrabajoLabel(r.tipoTrabajo)} · {r.worksiteName ?? "—"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{formatDateTime(r.createdAt)}</p>
              </Link>
            ))}
            <Pagination page={page} total={total} perPage={pageSize} onPage={(nextPage) => dispatch({ type: "page", page: nextPage })} />
          </div>
        </>
      )}
    </div>
  )
}
