"use client"

import * as React from "react"
import { CaretUp, CaretDown, CaretUpDown, GearSix } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead,
} from "@/components/ui/table"
import { Pagination } from "@/components/ui/pagination"
import { EmptyState } from "@/components/ui/empty-state"
import { SkeletonRow } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useSafeShellHeader } from "@/components/layout/header-context"
import type { DataTableProps, SortDir } from "./data-table.types"

export type { ColumnDef, DataTableProps } from "./data-table.types"

// ── Component ─────────────────────────────────────────────────────────────────

const DataTableInner = <T extends Record<string, unknown>>({
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
}: DataTableProps<T>) => {
  const { searchQuery } = useSafeShellHeader()

  // Column visibility state
  const [visibleKeys, setVisibleKeys] = React.useState<Set<string>>(() => {
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

  // If explicit search prop is given, use it. Otherwise, fall back to header context search.
  // When server-side filtering is in effect, the in-memory filter is a no-op.
  const currentSearch = disableInternalSearch
    ? ""
    : search !== undefined ? search : searchQuery
  const hasExplicitSearch = !disableInternalSearch && search !== undefined
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<SortDir>(null)
  const [page,    setPage]    = React.useState(1)

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
  const paginated = React.useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
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
      {(hasExplicitSearch || actions || enableColumnToggle) && (
        <div className="flex flex-col gap-3 mb-3 sm:flex-row sm:items-center sm:justify-between">
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
                className="h-8 text-xs sm:max-w-xs"
                aria-label="Buscar en la tabla"
              />
            )}
            {enableColumnToggle && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-xs">
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
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}

      {/* Table */}
      <TableRoot className={renderMobileCard ? "hidden md:block" : undefined}>
        <Table className={tableClassName}>
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
                        "inline-flex items-center gap-1",
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
        page={page}
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
