import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Superficie del tablero: un panel único dividido por líneas finas, en vez de
 * una tarjeta flotante por bloque (excepción del tablero a la regla 7 de
 * AGENTS.md).
 *
 * Las divisiones salen del borde superior e izquierdo de cada bloque, con la
 * grilla corrida -1px para que el borde exterior del panel no se duplique. No
 * se usa `gap-px` sobre un fondo gris: con gráficos que aparecen o no según los
 * datos, la última fila queda incompleta y ese fondo se ve como una mancha.
 *
 * Es un `div` a propósito, nunca una región: `e2e/densidad-kpi-filtros.spec.ts`
 * cuenta los tiles por región y un panel con nombre los juntaría todos.
 */
const PANEL_COLS = {
  kpis: "sm:grid-cols-2 xl:grid-cols-4",
  charts: "xl:grid-cols-2 2xl:grid-cols-3",
  /** Resumen: 12 columnas desde `lg`, los bloques eligen su ancho. */
  twelve: "lg:grid-cols-12",
  single: "",
} as const

export function DashboardPanel({
  cols = "single",
  className,
  children,
}: {
  cols?: keyof typeof PANEL_COLS
  className?: string
  children: ReactNode
}) {
  return (
    // Sin ninguna celda con contenido (todos los gráficos sin datos) el panel
    // desaparece entero en vez de quedar como un marco vacío.
    <div data-dashboard-panel="" className={cn("overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] [&:not(:has(>div>:not(:empty)))]:hidden", className)}>
      <div className={cn("-ml-px -mt-px grid grid-cols-1", PANEL_COLS[cols])}>{children}</div>
    </div>
  )
}

const BLOCK_SPAN = {
  one: "",
  /** Doble ancho en el bento de gráficos. */
  wide: "xl:col-span-2",
  /** Fila completa del bento de gráficos. */
  full: "xl:col-span-2 2xl:col-span-3",
} as const

const BLOCK_PADDING = {
  none: "",
  md: "p-4",
  lg: "p-5",
} as const

/**
 * Un bloque dentro de `DashboardPanel`. En la grilla de 12 columnas del Resumen
 * el ancho se pasa por `className` (`lg:col-span-8`).
 */
export function PanelBlock({
  span = "one",
  padding = "lg",
  className,
  children,
}: {
  span?: keyof typeof BLOCK_SPAN
  padding?: keyof typeof BLOCK_PADDING
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn("min-w-0 border-l border-t border-[var(--color-border)] bg-[var(--color-surface)]", BLOCK_SPAN[span], BLOCK_PADDING[padding], className)}>
      {children}
    </div>
  )
}

/**
 * Celda de un gráfico. Los gráficos devuelven `null` cuando no tienen datos;
 * `empty:hidden` hace que la celda desaparezca en vez de dejar un hueco del
 * ancho de dos columnas (el defecto de Prevención con SST en cero).
 */
export function ChartSlot({
  span = "one",
  className,
  children,
}: {
  span?: keyof typeof BLOCK_SPAN
  className?: string
  children?: ReactNode
}) {
  return (
    <PanelBlock span={span} padding="none" className={cn("empty:hidden", className)}>
      {children}
    </PanelBlock>
  )
}
