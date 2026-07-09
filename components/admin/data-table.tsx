"use client"

import * as React from "react"
import { CaretUp, CaretDown, CaretUpDown } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
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
  actions,
  loading = false,
  disableInternalSearch = false,
}: DataTableProps<T>) => {
  const { searchQuery } = useSafeShellHeader()

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
      {/* Toolbar — only shown when there's an explicit search input or actions */}
      {(hasExplicitSearch || actions) && (
        <div className="flex flex-col gap-3 mb-3 sm:flex-row sm:items-center sm:justify-between">
          {hasExplicitSearch ? (
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
          ) : (
            <div />
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}

      {/* Table */}
      <TableRoot className={renderMobileCard ? "hidden md:block" : undefined}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
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
                        "",
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
                  <td colSpan={columns.length} className="p-0">
                    <SkeletonRow cols={columns.length} />
                  </td>
                </tr>
              ))
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
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
