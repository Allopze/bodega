import * as React from "react"
import { cn } from "@/lib/utils"
import { SummaryBarCompactStrip } from "./summary-bar-compact-strip"
import { SummaryBarStatCell } from "./summary-bar-stat-cell"

export interface SummaryStat {
  key: string
  label: string
  value: string | number
  /**
   * "text" pinta el valor como frase en la sans del cuerpo (`text-base`), sin mono ni
   * tabular-nums ni atenuación de ceros. Una frase en el hueco del numeral mono de 22 px
   * partía en 2–3 líneas; un tile vacío dice qué hacer (regla A1). Por defecto "number".
   */
  valueKind?: "number" | "text"
  icon?: React.ReactNode
  /** Si se setea, la celda es un link (p.ej. vista pre-filtrada). */
  href?: string
  /** "signal" pone naranja solo cuando el valor numérico es > 0 (alertas / críticas). */
  tone?: "signal"
  /** Etiqueta inline después del valor (p.ej. "2 crít."). */
  hint?: string
  /** Texto secundario bajo el valor (p.ej. desglose). Solo modo completo. */
  secondary?: string
  /** Mini barra de progreso 0–100. Solo modo completo. */
  progress?: number
}

/** Lo que recibe `renderLink`: el enlace de una cifra ya armado (clase, contenido y `data-pressable`). */
export type SummaryLinkProps = { href: string; className: string; children: React.ReactNode; "data-pressable": "" }

interface SummaryBarProps {
  stats: SummaryStat[]
  className?: string
  /**
   * Variante inline (separada por puntos) para espacios ajustados como el
   * TopBar/headerActions. Sin bordes entre celdas, sin progress/secondary.
   */
  compact?: boolean
  /**
   * Cómo navega una cifra con `href` (sólo modo completo). Por defecto,
   * `next/link` (push). La portada MIPER lo usa para filtrar con `replace` y sin
   * mover el scroll (AGENTS, «Navigation and scroll preservation»), y el
   * espacio de trabajo, para navegar con el historial nativo (`WorkspaceLink`)
   * sin ida al servidor.
   */
  renderLink?: (props: SummaryLinkProps) => React.ReactNode
}

/**
 * Tira editorial de resumen para listas con pocos registros. Sin tarjetas: una
 * banda acotada por reglas hairline con divisores (truco de margen negativo) que
 * adapta a cualquier ancho. Mismo lenguaje visual que la MetricBar del dashboard.
 * Los ceros se atenúan; las señales (>0) usan el naranja "signal".
 *
 * Modo `compact`: fila inline separada por puntos para el TopBar/headerActions;
 * replica el patrón WarehouseHeaderMetrics.
 *
 * Pensado para usarse entre el PageHeader y la tabla. No renderiza nada si no
 * hay stats; deja el caso vacío (0 filas) al EmptyState de la tabla.
 */
const SummaryBarInner = React.memo(function SummaryBarInner({ stats, className, compact = false, renderLink }: SummaryBarProps) {
  if (stats.length === 0) return null
  return compact ? (
    <SummaryBarCompactStrip stats={stats} className={className} />
  ) : (
    <div className={cn("overflow-hidden border-y border-[var(--color-border)]", className)}>
      <div className="-ml-px -mt-px flex flex-wrap">
        {stats.map((stat) => (
          <SummaryBarStatCell key={stat.key} stat={stat} renderLink={renderLink} />
        ))}
      </div>
    </div>
  )
})

export const SummaryBar = SummaryBarInner
