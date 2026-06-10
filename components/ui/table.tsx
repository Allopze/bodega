import * as React from "react"
import { cn } from "@/lib/utils"

/* ── Table root — horizontal scroll on narrow viewports ───────────────────── */
const TableRoot = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("w-full overflow-x-auto overscroll-x-contain", className)}
      {...props}
    />
  )
)
TableRoot.displayName = "TableRoot"

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table
      ref={ref}
      className={cn("w-full min-w-max caption-bottom text-sm border-collapse", className)}
      {...props}
    />
  )
)
Table.displayName = "Table"

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn("border-b border-[var(--color-border-strong)]", className)}
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
  ({ className, children, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "px-4 py-2.5 text-left text-xs font-semibold",
        "text-[var(--color-text-subtle)] uppercase tracking-wide",
        "whitespace-nowrap",
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
