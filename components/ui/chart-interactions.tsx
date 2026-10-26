"use client"

import * as React from "react"
import { Rectangle, type MouseHandlerDataParam } from "recharts"
import { cn, formatCLP } from "@/lib/utils"
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion"

/*
 * Piezas de interacción de los gráficos del tablero, tomadas de los bloques de
 * referencia (dashboards-referencia/, Efferd): tooltip que se desliza entre
 * puntos, guía punteada, columna resaltada, foco de luz bajo el cursor y brillo
 * en la serie protagonista. `components/ui/chart.tsx` (shadcn) no se toca: el
 * resto de la app sigue con su tooltip.
 */

export type ChartValueFormat = "clp" | "count" | "percent" | "liters"

export function formatChartValue(value: unknown, format: ChartValueFormat = "count"): string {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return "—"
  switch (format) {
    case "clp": return formatCLP(n)
    case "percent": return `${n.toLocaleString("es-CL", { maximumFractionDigits: 1 })} %`
    case "liters": return `${n.toLocaleString("es-CL", { maximumFractionDigits: 0 })} L`
    default: return n.toLocaleString("es-CL", { maximumFractionDigits: 1 })
  }
}

/** Animación de entrada de las series; se apaga con "reducir movimiento". */
export function useChartMotion() {
  const reduced = useReducedMotion()
  return {
    isAnimationActive: !reduced,
    animationDuration: 900,
    animationEasing: "ease-out" as const,
  }
}

/** Guía vertical punteada de las series de tiempo. */
export const DASHED_CURSOR = {
  stroke: "var(--color-text-subtle)",
  strokeDasharray: "3 3",
  strokeWidth: 1,
} as const

/** Fondo redondeado de la columna apuntada en los gráficos de barras. */
export function ColumnHoverCursor(props: React.ComponentProps<typeof Rectangle>) {
  return <Rectangle {...props} fill="var(--color-surface-2)" radius={10} stroke="none" />
}

/**
 * Props comunes del `<ChartTooltip>`: el tooltip se desliza entre posiciones
 * (recharts anima su `transform`) y la guía es punteada. Para barras, pasa
 * `cursor: <ColumnHoverCursor />` por encima.
 */
export function useTooltipProps() {
  const reduced = useReducedMotion()
  return {
    isAnimationActive: !reduced,
    animationDuration: 220,
    animationEasing: "ease-out" as const,
    cursor: DASHED_CURSOR,
    wrapperStyle: { outline: "none" },
  }
}

export interface ChartTooltipCardItem {
  dataKey?: string | number
  name?: string | number
  value?: unknown
  color?: string
  fill?: string
  stroke?: string
  payload?: Record<string, unknown>
}

/**
 * Tooltip de los gráficos del tablero: tarjeta blanca con sombra, el período
 * arriba y una fila por serie (punto de color, nombre, valor en negrita).
 */
export function ChartTooltipCard({
  active,
  payload,
  label,
  valueFormat = "count",
  labelFormatter,
  names,
  footer,
}: {
  active?: boolean
  payload?: ChartTooltipCardItem[]
  label?: unknown
  valueFormat?: ChartValueFormat
  labelFormatter?: (label: unknown) => React.ReactNode
  /** Rótulos legibles por `dataKey` (los de la `ChartConfig`). */
  names?: Record<string, React.ReactNode>
  footer?: (payload: ChartTooltipCardItem[]) => React.ReactNode
}) {
  if (!active || !payload?.length) return null
  const heading = labelFormatter ? labelFormatter(label) : label != null ? String(label) : null
  return (
    <div className="min-w-40 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm shadow-[0_14px_34px_-10px_oklch(0_0_0/0.22),0_2px_6px_oklch(0_0_0/0.06)]">
      {heading != null && heading !== "" && <p className="mb-1.5 text-xs text-[var(--color-text-muted)]">{heading}</p>}
      <div className="space-y-1">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index)
          const color = item.color ?? item.stroke ?? item.fill
          return (
            <div key={key} className="flex items-center gap-2">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <span className="flex-1 text-[var(--color-text-muted)]">{names?.[key] ?? item.name}</span>
              <span className="font-semibold tabular-nums text-[var(--color-text)]">{formatChartValue(item.value, valueFormat)}</span>
            </div>
          )
        })}
      </div>
      {footer && <div className="mt-2 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-text-muted)]">{footer(payload)}</div>}
    </div>
  )
}

function indexFrom(state: MouseHandlerDataParam | undefined): number | null {
  const raw = state?.activeTooltipIndex ?? state?.activeIndex
  if (raw === undefined || raw === null) return null
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Índice del punto apuntado, para que la cifra principal del gráfico y las
 * barras vecinas reaccionen al cursor. `null` cuando el cursor sale.
 */
export function useActiveIndex() {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const onMouseMove = React.useCallback((state: MouseHandlerDataParam) => {
    const next = state?.isTooltipActive === false ? null : indexFrom(state)
    setActiveIndex((current) => (current === next ? current : next))
  }, [])
  const onMouseLeave = React.useCallback(() => setActiveIndex(null), [])
  return { activeIndex, onMouseMove, onMouseLeave }
}

/**
 * Foco de luz bajo el cursor (como `sales-chart` de la referencia): el área
 * rellena se ve completa en reposo y, al apuntar, se concentra alrededor del
 * cursor y se atenúa el resto. Uso:
 *
 *   const spot = useSpotlight()
 *   <AreaChart onMouseMove={spot.onMouseMove} onMouseLeave={spot.onMouseLeave}>
 *     <defs>{spot.defs}</defs>
 *     <Area mask={spot.mask} … />
 */
export function useSpotlight(width = 360) {
  const uid = React.useId().replace(/:/g, "")
  const maskId = `spot-mask-${uid}`
  const gradientId = `spot-grad-${uid}`
  const reduced = useReducedMotion()
  const [x, setX] = React.useState<number | null>(null)

  const onMouseMove = React.useCallback((state: MouseHandlerDataParam) => {
    const next = state?.isTooltipActive === false ? null : state?.activeCoordinate?.x ?? null
    setX(typeof next === "number" && Number.isFinite(next) ? next : null)
  }, [])
  const onMouseLeave = React.useCallback(() => setX(null), [])

  const defs = (
    <>
      <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stopColor="white" stopOpacity={0} />
        <stop offset="50%" stopColor="white" stopOpacity={1} />
        <stop offset="100%" stopColor="white" stopOpacity={0} />
      </linearGradient>
      <mask id={maskId} maskUnits="userSpaceOnUse" x="-50%" y="-50%" width="200%" height="200%">
        <rect x="-50%" y="-50%" width="200%" height="200%" fill="white" fillOpacity={x === null ? 1 : 0.22} style={{ transition: reduced ? undefined : "fill-opacity 220ms ease-out" }} />
        <rect
          x={0}
          y="-50%"
          width={width}
          height="200%"
          fill={`url(#${gradientId})`}
          opacity={x === null ? 0 : 1}
          style={{
            transform: `translateX(${(x ?? 0) - width / 2}px)`,
            transition: reduced ? undefined : "transform 220ms cubic-bezier(.2,.8,.2,1), opacity 220ms ease-out",
          }}
        />
      </mask>
    </>
  )

  return { x, onMouseMove, onMouseLeave, defs, mask: `url(#${maskId})` }
}

/**
 * Brillo suave de la serie protagonista: el trazo más una copia desenfocada a
 * media opacidad. Se pone dentro de `<defs>` y se aplica con `filter={url(#id)}`.
 */
export function GlowFilter({ id, std = 4 }: { id: string; std?: number }) {
  return (
    <filter id={id} x="-10%" y="-40%" width="120%" height="180%">
      <feGaussianBlur in="SourceGraphic" stdDeviation={std} result="blur" />
      <feComponentTransfer in="blur" result="soft">
        <feFuncA type="linear" slope={0.5} />
      </feComponentTransfer>
      <feMerge>
        <feMergeNode in="soft" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  )
}

/** Combina handlers de mouse de varios hooks en uno solo para el gráfico. */
export function composeChartHandlers(...handlers: Array<((state: MouseHandlerDataParam) => void) | undefined>) {
  return (state: MouseHandlerDataParam) => {
    for (const handler of handlers) handler?.(state)
  }
}

/** Clase para la leyenda interactiva: atenúa las series que no están en foco. */
export function seriesOpacity(key: string, focused: string | null) {
  return focused && focused !== key ? 0.15 : 1
}

export const chartLegendButtonClass = cn(
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)]",
  "transition-[background-color,opacity] duration-[var(--duration-fast)] hover:bg-[var(--color-surface-2)]",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
)
