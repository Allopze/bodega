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

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ColumnDef {
  key:       string
  label:     string
  sortable?: boolean
  /** If true, renders with TableCellNum styles (mono, right-aligned) */
  numeric?:  boolean
  /** Width hint (Tailwind class, e.g. "w-32") */
  width?:    string
}

export interface DataTableProps<T extends Record<string, unknown>> {
  columns:      ColumnDef[]
  rows:         T[]
  /** Keys to include in full-text search */
  searchKeys:   (keyof T)[]
  /** Render a <tr> for a given row. Receives the row + the columns list. */
  renderRow:    (row: T, index: number) => React.ReactNode
  /** Optional compact rendering for narrow screens. */
  renderMobileCard?: (row: T, index: number) => React.ReactNode
  emptyTitle?:  string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  pageSize?:    number
  searchPlaceholder?: string
  className?:   string
  /** Content rendered in the header toolbar (right side) */
  actions?:     React.ReactNode
  /** When true renders skeleton rows instead of EmptyState — prevents "no results" flash during load */
  loading?:     boolean
}

type SortDir = "asc" | "desc" | null

// ── Component ─────────────────────────────────────────────────────────────────

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  searchKeys,
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
}: DataTableProps<T>) {
  const [search,  setSearch]  = React.useState("")
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<SortDir>(null)
  const [page,    setPage]    = React.useState(1)

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter((row) =>
      searchKeys.some((k) => {
        const val = row[k]
        return val != null && String(val).toLowerCase().includes(q)
      })
    )
  }, [rows, search, searchKeys])

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
  function toggleSort(key: string) {
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
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          type="search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          className="h-8 text-xs sm:max-w-xs"
          aria-label="Buscar en la tabla"
        />
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

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
                >
                  {col.sortable ? (
                    <button
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        "inline-flex items-center gap-1",
                        "text-xs font-medium uppercase tracking-wide",
                        "text-[var(--color-text-subtle)] hover:text-[var(--color-text)]",
                        "transition-[color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                        "motion-safe:active:scale-[0.97]",
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
