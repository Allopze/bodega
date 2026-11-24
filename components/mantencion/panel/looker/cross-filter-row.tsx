"use client"

import * as React from "react"
import { TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { CrossFilterAction } from "@/lib/services/mantencion/looker/filters"
import { useCrossFilter } from "./use-cross-filter"

/**
 * Fila de tabla clickeable. El clic del mouse filtra; el teclado usa el `FilterToggle` de la
 * celda identificadora (la fila no se vuelve un botón ni pierde su semántica de fila).
 */
export function CrossFilterRow({
  action,
  active,
  children,
  className,
}: {
  action: CrossFilterAction
  active?: boolean
  children: React.ReactNode
  className?: string
}) {
  const { toggle, pending } = useCrossFilter()
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => setReady(true), [])
  return (
    <TableRow
      data-cross-filter-row=""
      data-cross-filter-ready={ready ? "" : undefined}
      data-selected={active ? "true" : undefined}
      aria-busy={pending || undefined}
      onClick={() => toggle(action)}
      className={cn(
        "cursor-pointer transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:bg-[var(--color-surface-2)]",
        active && "bg-[var(--color-primary-tint)]/50",
        className,
      )}
    >
      {children}
    </TableRow>
  )
}
