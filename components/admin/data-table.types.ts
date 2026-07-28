import * as React from "react"

export interface ColumnDef {
  key:            string
  label:          string
  sortable?:      boolean
  /** If true, renders with TableCellNum styles (mono, right-aligned) */
  numeric?:       boolean
  /** Width hint (Tailwind class, e.g. "w-32") */
  width?:         string
  /** Default visibility state when column toggle is enabled */
  defaultVisible?: boolean
}

export interface DataTableProps<T extends Record<string, unknown>> {
  /** Nombre accesible de la tabla, expuesto como `<caption>` visualmente oculto. */
  caption:      string
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
  /**
   * E-4: congela la primera columna al hacer scroll horizontal, para que el
   * identificador de la fila no se pierda. Sólo tiene sentido en tablas anchas
   * (8+ columnas); en las estrechas no hay scroll que compensar.
   */
  stickyFirstColumn?: boolean
  emptyTitle?:  string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  pageSize?:    number
  searchPlaceholder?: string
  className?:   string
  /** Optional table-layout override for dense, responsive catalog views. */
  tableClassName?: string
  /** Content rendered in the header toolbar (right side) */
  actions?:     React.ReactNode
  /** When true renders skeleton rows instead of EmptyState — prevents "no results" flash during load */
  loading?:     boolean
  /** When true, disables the in-memory text filter and its toolbar input. */
  disableInternalSearch?: boolean
  /** When true, adds a "Columnas" dropdown menu allowing users to toggle column visibility */
  enableColumnToggle?: boolean
  /**
   * When true, hides the "Cómodo / Compacto" density toggle in the toolbar.
   * The global `data-density` attribute still applies if the user already
   * chose compact elsewhere — only the control disappears. Use on lists where
   * density is irrelevant (e.g. request lists that aren't operated row-by-row).
   */
  hideDensityToggle?: boolean
  /**
   * E-2: key to persist column visibility and sort state in URL search params.
   * When provided, visible columns and sort direction survive navigation and
   * are shareable via URL. Params: `${viewKey}_cols`, `${viewKey}_sort`, `${viewKey}_dir`.
   */
  viewKey?: string
  /** When true, enables checkbox row selection */
  enableRowSelection?: boolean
  /** Function to extract unique key for a row (defaults to row.id) */
  getRowKey?: (row: T) => string
  /** Selected row keys when controlled */
  selectedRowKeys?: string[]
  /** Called when row selection changes */
  onSelectionChange?: (selectedKeys: string[]) => void
  /** Render custom action component for selected rows (e.g. Export selected) */
  onSelectionExport?: (selectedRows: T[]) => React.ReactNode
}

export type SortDir = "asc" | "desc" | null
