import * as React from "react"
import { cn } from "@/lib/utils"

/* ── Table root — horizontal scroll on narrow viewports ───────────────────── */
interface TableRootProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Acota la altura y habilita scroll vertical propio, lo que hace que la
   * cabecera sticky de `TableHeader` funcione de verdad.
   *
   * Sin esto el sticky es un no-op: `overflow-x-auto` ya establece un contenedor
   * de scroll, así que el `<thead>` se posiciona respecto a ÉL y no respecto a la
   * página — y con altura automática ese contenedor no tiene rango de scroll.
   * Usar en listados largos (>20 filas visibles); innecesario si hay paginación.
   */
  stickyHeader?: boolean
}

const TableRoot = React.forwardRef<HTMLDivElement, TableRootProps>(
  ({ className, stickyHeader = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // `relative` es lo que hace que el recorte funcione de verdad: sin un
        // ancestro posicionado, los descendientes `absolute` —como el
        // `.sr-only` de una cabecera de acciones— toman el <html> como bloque
        // contenedor, ESCAPAN a este overflow y arrastran el ancho del
        // documento. Eso producía 676px de scroll horizontal en un viewport de
        // 390px (auditoría 2026-07-24, A-7).
        "relative w-full overflow-x-auto overscroll-x-contain",
        stickyHeader && "max-h-[70vh] overflow-y-auto overscroll-y-contain",
        "rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
      {...props}
    />
  )
)
TableRoot.displayName = "TableRoot"

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm border-collapse", className)}
      {...props}
    />
  )
)
Table.displayName = "Table"

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn(
        "border-b border-[var(--color-border-strong)]",
        // Sólo tiene efecto cuando el TableRoot acota su altura (stickyHeader).
        // Inerte en cualquier otro caso, así que es seguro tenerlo siempre.
        "sticky top-0 z-10",
        className,
      )}
      {...props}
    />
  )
)
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody
      ref={ref}
      className={cn("divide-y divide-[var(--color-border)]", className)}
      {...props}
    />
  )
)
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn("border-t border-[var(--color-border-strong)] font-medium", className)}
      {...props}
    />
  )
)
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "transition-colors duration-[var(--duration-fast)]",
        "hover:bg-[var(--color-surface-2)]",
        "data-[selected=true]:bg-[var(--color-primary-tint)]",
        className,
      )}
      {...props}
    />
  )
)
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, children, scope = "col", ...props }, ref) => (
    <th
      ref={ref}
      scope={scope}
      className={cn(
        "px-4 py-3 text-left text-xs font-semibold",
        "text-slate-500 uppercase tracking-wider",
        "whitespace-nowrap",
        "bg-slate-50/70 border-b border-slate-200/80",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  )
)
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "px-4 py-3 text-sm text-[var(--color-text)] align-middle",
        className,
      )}
      {...props}
    />
  )
)
TableCell.displayName = "TableCell"

/** Numeric table cell — monospace, right-aligned for quantities/money */
const TableCellNum = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "px-4 py-3 text-sm text-[var(--color-text)] text-right align-middle",
        "font-mono tabular-nums",
        className,
      )}
      {...props}
    />
  )
)
TableCellNum.displayName = "TableCellNum"

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption
      ref={ref}
      className={cn("mt-3 text-xs text-[var(--color-text-subtle)]", className)}
      {...props}
    />
  )
)
TableCaption.displayName = "TableCaption"

export {
  TableRoot, Table, TableHeader, TableBody, TableFooter,
  TableRow, TableHead, TableCell, TableCellNum, TableCaption,
}
