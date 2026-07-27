"use client"

import * as React from "react"
import { X } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

interface RightPanelProps {
  /** Indica si el panel está visible */
  open?: boolean
  /** Callback para cambiar visibilidad o cerrar */
  onOpenChange?: (open: boolean) => void
  /** Título opcional de la sección contextual */
  title?: string
  /** Subtítulo o descripción breve opcional */
  subtitle?: string
  /** Acciones adicionales en el header del panel */
  actions?: React.ReactNode
  /** Contenido interno del panel contextual */
  children: React.ReactNode
  className?: string
}

/**
 * Panel contextual secundario (3ª columna del layout SaaS).
 *
 * - Desktop (xl:): Columna derecha fija/sticky de 384px con borde izquierdo sutil de 1px
 *   y scroll vertical independiente (`overflow-y-auto`).
 * - Mobile/Tablet (<xl): Sliding drawer responsivo.
 */
export function RightPanel({
  open = true,
  onOpenChange,
  title,
  subtitle,
  actions,
  children,
  className,
}: RightPanelProps) {
  if (!open) return null

  return (
    <>
      {/* Overlay para móvil/tablet cuando se abre como drawer (<xl) */}
      <div
        className="fixed inset-0 z-40 bg-(--color-overlay) backdrop-blur-xs transition-opacity duration-(--duration-slow) xl:hidden"
        onClick={() => onOpenChange?.(false)}
        aria-hidden="true"
      />

      <aside
        aria-label={title ?? "Panel contextual"}
        className={cn(
          // Mobile/Tablet: Drawer lateral flotante
          "fixed right-0 top-0 z-50 flex h-full w-[85vw] max-w-[384px] flex-col border-l border-(--color-border) bg-(--color-surface) shadow-(--shadow-lg)",
          "transition-transform duration-(--duration-slow) ease-(--ease-panel)",
          // Desktop: Columna integrada sticky de 384px en la retícula de 3 zonas
          "xl:relative xl:z-auto xl:h-full xl:w-[var(--right-panel-width)] xl:shrink-0 xl:shadow-none",
          className
        )}
      >
        {/* Header del panel contextual */}
        {(title || onOpenChange || actions) && (
          <div className="flex items-center justify-between border-b border-(--color-border) px-5 py-3.5">
            <div className="min-w-0 flex-1">
              {title && (
                <h3 className="truncate text-sm font-semibold text-(--color-text) leading-tight">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="truncate text-xs text-(--color-text-subtle) leading-tight mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {actions}
              {onOpenChange && (
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-(--radius) text-(--color-text-muted) transition-colors duration-(--duration-fast) hover:bg-(--color-surface-2) hover:text-(--color-text) cursor-pointer"
                  aria-label="Cerrar panel"
                >
                  <X size={15} weight="bold" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Contenido scrolleable del panel contextual */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs text-(--color-text)">
          {children}
        </div>
      </aside>
    </>
  )
}
