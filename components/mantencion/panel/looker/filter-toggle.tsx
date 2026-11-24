"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { CrossFilterAction } from "@/lib/services/mantencion/looker/filters"
import { useCrossFilter } from "./use-cross-filter"

/**
 * Control enfocable de un filtro cruzado. Es un `<button>` real (`aria-pressed`, Enter y
 * Espacio) y no un `<tr>` con rol inventado: la fila también responde al clic, pero el teclado
 * opera siempre este botón. Un segundo clic quita el filtro.
 */
export function FilterToggle({
  action,
  children,
  className,
  title,
  pressedClassName,
  "aria-label": ariaLabel,
}: {
  action: CrossFilterAction
  children: React.ReactNode
  className?: string
  title?: string
  /** Clase adicional cuando el filtro está activo. */
  pressedClassName?: string
  "aria-label"?: string
}) {
  const { toggle, isActive, pending } = useCrossFilter()
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => setReady(true), [])
  const active = isActive(action.values)
  return (
    <button
      type="button"
      data-cross-filter=""
      // El HTML del servidor ya trae el botón, pero su onClick no existe hasta hidratar.
      // Las pruebas esperan esta marca antes de hacer clic; también documenta el límite.
      data-cross-filter-ready={ready ? "" : undefined}
      aria-label={ariaLabel}
      aria-pressed={active}
      aria-busy={pending || undefined}
      title={title ?? (active ? "Quitar este filtro" : "Filtrar por este valor")}
      onClick={(event) => {
        // La fila entera también es clickeable: sin esto, el botón y la fila togglearían dos veces.
        event.stopPropagation()
        toggle(action)
      }}
      className={cn(
        "inline-flex min-h-8 max-w-full items-center gap-1 rounded-[var(--radius)] px-1 text-left text-[var(--color-text)]",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-primary-ink)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
        active && "bg-[var(--color-primary-tint)] font-semibold text-[var(--color-primary-ink)]",
        active && pressedClassName,
        className,
      )}
    >
      {children}
    </button>
  )
}
