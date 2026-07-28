"use client"

import * as React from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { CaretUp, CaretDown, CaretUpDown, GearSix } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  TableRoot, Table, TableCaption, TableHeader, TableBody, TableRow, TableHead,
} from "@/components/ui/table"
import { Pagination } from "@/components/ui/pagination"
import { EmptyState } from "@/components/ui/empty-state"
import { SkeletonRow } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useSafeShellHeader } from "@/components/layout/header-context"
import type { DataTableProps, SortDir } from "./data-table.types"

export type { ColumnDef, DataTableProps } from "./data-table.types"

/* ── E-1 · Densidad ───────────────────────────────────────────────────────────
 * Preferencia del usuario, compartida por todas las tablas: quien opera en
 * compacto lo quiere en todas. Se persiste en localStorage y se lee con
 * useSyncExternalStore para que dos tablas en la misma pantalla no se
 * desincronicen. `visual-design/density.md`: cómodo es el default; compacto
 * existe para operadores expertos en monitores grandes.
 */
const DENSITY_KEY = "table-density"
const DENSITY_EVENT = "table-density-change"
type Density = "comfortable" | "compact"

function defaultColumnKeys<T extends { key: string; defaultVisible?: boolean }>(columns: T[]) {
  return columns.reduce<string[]>((keys, column) => {
    if (column.defaultVisible !== false) keys.push(column.key)
    return keys
  }, [])
}

function getDensitySnapshot(): Density {
  if (typeof window === "undefined") return "comfortable"
  return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable"
}
function subscribeDensity(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(DENSITY_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(DENSITY_EVENT, onChange)
  }
}
function setDensity(value: Density) {
  localStorage.setItem(DENSITY_KEY, value)
  window.dispatchEvent(new Event(DENSITY_EVENT))
}

/** Umbral desde el que la densidad cambia algo perceptible. Por debajo, el
 *  control sería adorno: la tabla entra completa en pantalla igual. */
const DENSITY_MIN_ROWS = 8

// ── Component ─────────────────────────────────────────────────────────────────

const DataTableInner = <T extends Record<string, unknown>>({
  caption,
  columns,
  rows,
  searchKeys,
  search,
  onSearchChange,
  renderRow,
  renderMobileCard,
  emptyTitle = "Sin resultados",
  emptyDescription,
  emptyAction,
  pageSize = 20,
  searchPlaceholder = "Buscar...",
  className,
  tableClassName,
  actions,
  loading = false,
  disableInternalSearch = false,
  enableColumnToggle = false,
  hideDensityToggle = false,
  stickyFirstColumn = false,
  viewKey,
}: DataTableProps<T>) => {
  const { searchQuery } = useSafeShellHeader()
  const density = React.useSyncExternalStore(subscribeDensity, getDensitySnapshot, () => "comfortable" as Density)
  const searchParams = useSearchParams()
  const router = useRouter()

  // ── E-2 · Vistas guardadas ────────────────────────────────────────────────
  // Cuando viewKey está definido, la visibilidad de columnas y el sort se
  // persisten en URL search params, sobreviviendo la navegación y siendo
  // compartibles via URL. Params: ${viewKey}_cols, ${viewKey}_sort, ${viewKey}_dir.
  const setViewParam = React.useCallback((key: string, value: string | null) => {
    const currentVal = searchParams.get(key)
    if ((currentVal ?? null) === (value ?? null)) return
    const params = new URLSearchParams(searchParams.toString())
    if (value === null) params.delete(key)
    else params.set(key, value)
    const queryString = params.toString()
    router.replace(queryString ? `?${queryString}` : window.location.pathname, { scroll: false })
  }, [searchParams, router])

  // Column visibility state — from URL or defaults
  const [visibleKeys, setVisibleKeys] = React.useState<Set<string>>(() => {
    if (viewKey) {
      const colsParam = searchParams.get(`${viewKey}_cols`)
      if (colsParam) {
        const keys = colsParam.split(",").filter(Boolean)
        if (keys.length > 0) return new Set(keys)
      }
    }
    return new Set(
      columns
        .filter((col) => col.defaultVisible !== false)
        .map((col) => col.key),
    )
  })

  const visibleColumns = React.useMemo(() => {
    if (!enableColumnToggle) return columns
    return columns.filter((col) => visibleKeys.has(col.key))
  }, [columns, enableColumnToggle, visibleKeys])

  function toggleColumn(key: string) {
    setVisibleKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Persist column visibility to URL when viewKey is set
  React.useEffect(() => {
    if (!viewKey) return
    const allDefault = defaultColumnKeys(columns)
    const current = Array.from(visibleKeys)
    const isDefault = current.length === allDefault.length && allDefault.every((k) => visibleKeys.has(k))
    setViewParam(`${viewKey}_cols`, isDefault ? null : current.join(","))
  }, [visibleKeys, viewKey, columns, setViewParam])

  // If explicit search prop is given, use it. Otherwise, fall back to header context search.
  // When server-side filtering is in effect, the in-memory filter is a no-op.
  const currentSearch = disableInternalSearch
    ? ""
    : search !== undefined ? search : searchQuery
  const hasExplicitSearch = !disableInternalSearch && search !== undefined
  const [sortKey, setSortKey] = React.useState<string | null>(() => viewKey ? searchParams.get(`${viewKey}_sort`) : null)
  const [sortDir, setSortDir] = React.useState<SortDir>(() => {
    if (!viewKey) return null
    const d = searchParams.get(`${viewKey}_dir`)
    return d === "asc" || d === "desc" ? d : null
  })
  const [page,    setPage]    = React.useState(1)

  // Persist sort state to URL when viewKey is set
  React.useEffect(() => {
    if (!viewKey) return
    setViewParam(`${viewKey}_sort`, sortKey)
    setViewParam(`${viewKey}_dir`, sortDir)
  }, [sortKey, sortDir, viewKey, setViewParam])

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    if (!currentSearch.trim()) return rows
    const q = currentSearch.toLowerCase()
    return rows.filter((row) =>
      searchKeys.some((k) => {
        const val = row[k]
        return val != null && String(val).toLowerCase().includes(q)
      })
    )
  }, [rows, currentSearch, searchKeys])

  // ── Sort ────────────────────────────────────────────────────────────────────
  const sorted = React.useMemo(() => {
    if (!sortKey || !sortDir) return filtered
    return [...filtered].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const cmp =
        av == null ? -1 :
        bv == null ?  1 :
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "es-CL", { sensitivity: "base" })
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir])

  // ── Paginate ─────────────────────────────────────────────────────────────────
  const totalFiltered = sorted.length
  // Sólo se ofrece donde cambia algo: en una tabla de 3 filas es adorno.
  const showDensityToggle = totalFiltered >= DENSITY_MIN_ROWS
  // `page` puede quedar más allá del rango real si el buscador del TopBar o el
  // dataset (`rows`) cambian sin pasar por `toggleSort`/`onSearchChange`. Se
  // acota contra `totalFiltered` en vez de resetear en un efecto: así no hay
  // riesgo de volver a la página 1 sólo porque el padre re-renderiza `rows`
  // con una referencia nueva (auditoría UIUX-009).
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginated = React.useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  )

  // ── Sort toggle ──────────────────────────────────────────────────────────────
  const toggleSort = React.useCallback((key: string) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir("asc")
    } else if (sortDir === "asc") {
      setSortDir("desc")
    } else {
      setSortKey(null)
      setSortDir(null)
    }
    setPage(1)
  }, [sortKey, sortDir])

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Toolbar — shown when there's an explicit search input, actions, or column toggle */}
      {(hasExplicitSearch || actions || enableColumnToggle || (showDensityToggle && !hideDensityToggle)) && (
        <div className={cn(
          "flex flex-col gap-3 mb-3 sm:flex-row sm:items-center",
          hasExplicitSearch || showDensityToggle ? "sm:justify-between" : "sm:justify-end gap-2"
        )}>
          <div className="flex items-center gap-2">
            {hasExplicitSearch && (
              <Input
                type="search"
                placeholder={searchPlaceholder}
                value={search ?? ""}
                onChange={(e) => {
                  onSearchChange?.(e.target.value)
                  setPage(1)
                }}
                className="h-11 text-xs sm:h-8 sm:max-w-xs"
                aria-label="Buscar en la tabla"
              />
            )}
            {showDensityToggle && !hideDensityToggle && (
              <div
                role="group"
                aria-label="Densidad de la tabla"
                className="hidden sm:inline-flex rounded-(--radius) border border-[var(--color-border-control)] bg-[var(--color-surface)] p-0.5"
              >
                {([["comfortable", "Cómodo"], ["compact", "Compacto"]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDensity(value)}
                    aria-pressed={density === value}
                    className={cn(
                      "rounded-[calc(var(--radius)-2px)] px-2 py-1 text-xs font-medium transition-colors duration-(--duration-fast)",
                      density === value
                        ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
                        : "text-[var(--color-text-subtle)] hover:text-[var(--color-text)]",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {enableColumnToggle && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-11 text-xs sm:h-8">
                    <GearSix size={14} className="mr-1" />
                    Columnas
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto p-2">
                  <div className="space-y-1.5">
                    {columns.map((column) => (
                      <Checkbox
                        key={column.key}
                        id={`col-${column.key}`}
                        label={column.label || column.key}
                        checked={visibleKeys.has(column.key)}
                        onChange={() => toggleColumn(column.key)}
                      />
                    ))}
                  </div>
                  {viewKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setVisibleKeys(new Set(defaultColumnKeys(columns)))
                        setSortKey(null)
                        setSortDir(null)
                      }}
                      className="mt-2 w-full rounded-[var(--radius)] px-2 py-1.5 text-xs text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-colors"
                    >
                      Restablecer vista
                    </button>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}

      {/* Table */}
      <TableRoot data-density={density} data-sticky-col={stickyFirstColumn || undefined} className={renderMobileCard ? "hidden md:block" : undefined}>
        <Table className={tableClassName}>
          {caption && <TableCaption className="sr-only">{caption}</TableCaption>}
          <TableHeader>
            <TableRow>
              {visibleColumns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(col.width, col.numeric && "text-right")}
                  aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  aria-label={!col.label ? "Acciones" : undefined}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        "inline-flex min-h-6 min-w-6 items-center gap-1",
                        "text-eyebrow hover:text-[var(--color-text)]",
                        "transition-[color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                        "select-none",
                      )}
                      aria-label={`Ordenar por ${col.label}${sortKey === col.key ? ` (${sortDir === "asc" ? "ascendente" : "descendente"})` : ""}`}
                    >
                      {col.label}
                      <SortIcon colKey={col.key} sortKey={sortKey} sortDir={sortDir} />
                    </button>
                  ) : (
                    col.label
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(pageSize, 5) }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={visibleColumns.length} className="p-0">
                    <SkeletonRow cols={visibleColumns.length} />
                  </td>
                </tr>
              ))
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length}>
                  <EmptyState
                    title={emptyTitle}
                    description={emptyDescription}
                    action={emptyAction}
                    compact
                  />
                </td>
              </tr>
            ) : (
              paginated.map((row, i) => (
                <React.Fragment key={(row.id as string | number | undefined) ?? i}>
                  {renderRow(row, i)}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </TableRoot>

      {renderMobileCard && (
        <div className="grid gap-2 md:hidden">
          {loading ? (
            Array.from({ length: Math.min(pageSize, 5) }).map((_, i) => (
              <SkeletonRow key={i} cols={2} />
            ))
          ) : paginated.length === 0 ? (
            <EmptyState
              title={emptyTitle}
              description={emptyDescription}
              action={emptyAction}
              compact
            />
          ) : (
            paginated.map((row, i) => (
              <React.Fragment key={(row.id as string | number | undefined) ?? i}>
                {renderMobileCard(row, i)}
              </React.Fragment>
            ))
          )}
        </div>
      )}

      {/* Pagination */}
      <Pagination
        page={safePage}
        total={totalFiltered}
        perPage={pageSize}
        onPage={setPage}
      />
    </div>
  )
}

export const DataTable = React.memo(DataTableInner) as typeof DataTableInner

// ── Sort icon helper ──────────────────────────────────────────────────────────
function SortIcon({ colKey, sortKey, sortDir }: {
  colKey:  string
  sortKey: string | null
  sortDir: SortDir
}) {
  if (sortKey !== colKey || !sortDir) {
    return <CaretUpDown size={11} className="opacity-40" />
  }
  return sortDir === "asc"
    ? <CaretUp size={11} className="text-[var(--color-primary)]" />
    : <CaretDown size={11} className="text-[var(--color-primary)]" />
}
