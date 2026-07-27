"use client"

import * as React from "react"
import { CaretDown, DotsThree, SlidersHorizontal } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * ControlsBar — patrón "periodo + fecha + personalizar + overflow" para páginas
 * con tendencias (dashboard, combustibles, analítica).
 *
 * B1 (PLAN_MIGRACION_VISUAL_SIDEBAR_HEADER): estandariza los controles compactos
 * que hoy se improvisan arriba del contenido, en el lenguaje de la referencia.
 *
 * **Contrato crítico (AGENTS.md regla 5 page-layout + screen-density A3):**
 * este componente NO es una toolbar independiente. Se monta dentro de
 * `PageHeader.actions` (o de un `header.actions` del shell) para que aparezca
 * en el TopBar en desktop y en el bloque de cabecera en móvil, **nunca** como
 * una segunda barra dentro del contenido.
 *
 * - Densidad fija `text-xs h-[30px]` (usa `Button size="sm"`).
 * - Sin búsqueda: el TopBar ya la provee contextualmente.
 * - Slots opcionales: si un slot no se pasa, no se renderiza.
 *
 * Uso típico:
 *   <PageHeader
 *     title="Bitácora"
 *     actions={
 *       <ControlsBar
 *         period={<PeriodMenu value={period} onChange={setPeriod} />}
 *         range={<DateRangePicker ... />}
 *         customize={<CustomizeSheet ... />}
 *       />
 *     }
 *   />
 */
export interface ControlsBarProps {
  /** Selector de período (ej. "Últimos 30 días"). Suele ser un DropdownMenu. */
  period?: React.ReactNode
  /** Selector de rango de fechas. */
  range?: React.ReactNode
  /** Acción "personalizar" (abre un Sheet/Dialog con columnas, fuentes...). */
  customize?: React.ReactNode
  /** Overflow (más acciones). Si no se pasa, no se muestra el botón `•••`. */
  overflow?: React.ReactNode
  /** Reemplaza todos los slots por hijos libres (escape hatch, usar con tino). */
  children?: React.ReactNode
  className?: string
}

/**
 * Trigger estándar para el slot `period`. Botón secundario pequeño con caret.
 * Pensado para envolver un `DropdownMenuTrigger` (asChild).
 */
export function PeriodTrigger({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={cn("font-medium", className)}
      {...props}
    >
      <span className="truncate">{children}</span>
      <CaretDown size={12} weight="bold" className="shrink-0 text-(--color-text-muted)" />
    </Button>
  )
}

/**
 * Trigger estándar para el slot `customize`. Botón secundario con icono.
 */
export function CustomizeTrigger({
  children = "Personalizar",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={cn("font-medium", className)}
      {...props}
    >
      <SlidersHorizontal size={12} weight="bold" className="shrink-0 text-(--color-text-muted)" />
      <span className="truncate">{children}</span>
    </Button>
  )
}

/**
 * Trigger estándar para el slot `overflow`. Botón icono pequeño con `•••`.
 */
export function OverflowTrigger({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={cn("px-0 sm:w-[30px]", className)}
      aria-label="Más acciones"
      {...props}
    >
      <DotsThree size={16} weight="bold" className="shrink-0" />
    </Button>
  )
}

export function ControlsBar({
  period,
  range,
  customize,
  overflow,
  children,
  className,
}: ControlsBarProps) {
  // Si pasan children, respetamos el escape hatch sin envolver cada slot.
  if (children !== undefined) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5",
          className,
        )}
        role="group"
        aria-label="Controles de la página"
      >
        {children}
      </div>
    )
  }

  // Ningún slot pasado: no renderizamos nada (evita un grupo vacío).
  const hasAny = period || range || customize || overflow
  if (!hasAny) return null

  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        className,
      )}
      role="group"
      aria-label="Controles de la página"
    >
      {period}
      {range}
      {customize}
      {overflow}
    </div>
  )
}
