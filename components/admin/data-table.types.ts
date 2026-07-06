import * as React from "react"

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
  /** Explicit search query — when provided, the DataTable uses this value instead of the header context search */
  search?:      string
  /** Callback when internal search changes (only used when search prop is provided) */
  onSearchChange?: (value: string) => void
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
  /** When true, disables the in-memory text filter and its toolbar input. */
  disableInternalSearch?: boolean
}

export type SortDir = "asc" | "desc" | null
