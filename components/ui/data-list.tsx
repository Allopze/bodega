import * as React from "react"
import { cn } from "@/lib/utils"

/** DataList: key-value pairs for detail panels/info sections.
 *  Not a table — uses definition-list semantics.
 *  Avoids card overuse: groups data with divide-y, no unnecessary boxing.
 */

interface DataItem {
  label:    string
  value:    React.ReactNode
  mono?:    boolean   // render value in font-mono (for codes, quantities, money)
  span?:    boolean   // full width row
}

interface DataListProps {
  items:      DataItem[]
  columns?:   1 | 2
  className?: string
}

export function DataList({ items, columns = 2, className }: DataListProps) {
  return (
    <dl
      className={cn(
        "divide-y divide-[var(--color-border)]",
        columns === 2 && "sm:grid sm:grid-cols-2 sm:divide-y-0 sm:gap-px sm:[background:var(--color-border)] overflow-hidden rounded-[var(--radius)]",
        className,
      )}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className={cn(
            "px-4 py-3 flex justify-between items-baseline gap-4",
            "bg-[var(--color-surface)]",
            columns === 2 && (item.span ? "sm:col-span-2" : ""),
          )}
        >
          <dt className="text-xs font-medium text-[var(--color-text-subtle)] shrink-0 min-w-0 leading-relaxed">
            {item.label}
          </dt>
          <dd
            className={cn(
              "text-sm text-[var(--color-text)] text-right min-w-0 break-words",
              item.mono && "font-mono tabular-nums",
            )}
          >
            {item.value ?? <span className="text-[var(--color-text-subtle)]">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
