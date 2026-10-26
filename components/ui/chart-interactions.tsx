"use client"

import * as React from "react"
import {
  Rectangle,
  useActiveTooltipCoordinate,
  useActiveTooltipLabel,
  useIsTooltipActive,
} from "recharts"
import { cn, formatCLP, formatPercent, formatQty } from "@/lib/utils"
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
    case "percent": return formatPercent(n)
    case "liters": return `${formatQty(n, undefined, { maximumFractionDigits: 0 })} L`
    default: return formatQty(n, undefined, { maximumFractionDigits: 1 })
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
 *
 * `formats` da un formato por `dataKey` cuando el tooltip mezcla unidades
 * (combustible: litros, dinero y cargas). Un valor `null` es "sin dato" y se
 * pinta "—": leerlo como 0 mostraba "$0" en un mes sin costo registrado.
 */
export function ChartTooltipCard({
  active,
  payload,
  label,
  valueFormat = "count",
  formats,
  labelFormatter,
  names,
  footer,
}: {
  active?: boolean
  payload?: ChartTooltipCardItem[]
  label?: unknown
  valueFormat?: ChartValueFormat
  formats?: Record<string, ChartValueFormat>
  labelFormatter?: (label: unknown) => React.ReactNode
  /** Rótulos legibles por `dataKey` (los de la `ChartConfig`). */
  names?: Record<string, React.ReactNode>
  footer?: (payload: ChartTooltipCardItem[]) => React.ReactNode
}) {
  if (!active || !payload?.length) return null
  const heading = labelFormatter ? labelFormatter(label) : label != null ? String(label) : null
  const footerContent = footer?.(payload)
  return (
    <div className="min-w-40 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm shadow-[var(--shadow-lg)]">
      {heading != null && heading !== "" && <p className="mb-1.5 text-xs text-[var(--color-text-muted)]">{heading}</p>}
      <div className="space-y-1">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index)
          const color = item.color ?? item.stroke ?? item.fill
          return (
            <div key={key} className="flex items-center gap-2">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <span className="flex-1 text-[var(--color-text-muted)]">{names?.[key] ?? item.name}</span>
              <span className="font-semibold tabular-nums text-[var(--color-text)]">
                {item.value == null ? "—" : formatChartValue(item.value, formats?.[key] ?? valueFormat)}
              </span>
            </div>
          )
        })}
      </div>
      {footerContent != null && footerContent !== false && (
        <div className="mt-2 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-text-muted)]">{footerContent}</div>
      )}
    </div>
  )
}

/**
 * Índice del punto activo, para que la cifra principal del gráfico y las
 * barras vecinas reaccionen. Lo alimenta `<ChartActiveSync onIndex={setActiveIndex}>`
 * (puntero y teclado); `null` cuando no hay punto activo.
 */
export function useActiveIndex() {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  return { activeIndex, setActiveIndex }
}

/**
 * Sincroniza el punto activo del gráfico con el estado del componente, venga
 * del puntero **o del teclado**. Un `onMouseMove` sólo ve el mouse:
 * con las flechas (`accessibilityLayer`) el tooltip avanzaba pero la cifra
 * principal, la leyenda y las columnas atenuadas se quedaban en el último mes.
 * Los hooks de recharts leen el mismo estado del tooltip para ambos casos.
 *
 * Va como hijo del gráfico (`<ComposedChart>…<ChartActiveSync … /></…>`); no
 * dibuja nada. `labels` son los valores del eje X en el orden de los datos.
 */
export function ChartActiveSync({
  labels,
  onIndex,
  onX,
}: {
  labels: ReadonlyArray<string | number>
  onIndex?: (index: number | null) => void
  onX?: (x: number | null) => void
}) {
  const isActive = useIsTooltipActive()
  const label = useActiveTooltipLabel()
  const coordinate = useActiveTooltipCoordinate()
  const index = isActive && label !== undefined ? labels.findIndex((entry) => String(entry) === String(label)) : -1
  const x = isActive && typeof coordinate?.x === "number" && Number.isFinite(coordinate.x) ? coordinate.x : null
  React.useEffect(() => { onIndex?.(index >= 0 ? index : null) }, [index, onIndex])
  React.useEffect(() => { onX?.(x) }, [x, onX])
  return null
}

/**
 * Foco de luz bajo el cursor (como `sales-chart` de la referencia): el área
 * rellena se ve completa en reposo y, al apuntar, se concentra alrededor del
 * cursor y se atenúa el resto. Uso:
 *
 *   const spot = useSpotlight()
 *   <AreaChart>
 *     <defs>{spot.defs}</defs>
 *     <ChartActiveSync labels={…} onX={spot.setX} />
 *     <Area mask={spot.mask} … />
 */
export function useSpotlight(width = 360) {
  const uid = React.useId().replace(/:/g, "")
  const maskId = `spot-mask-${uid}`
  const gradientId = `spot-grad-${uid}`
  const reduced = useReducedMotion()
  const [x, setX] = React.useState<number | null>(null)

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

  return { x, setX, defs, mask: `url(#${maskId})` }
}

/**
 * Brillo suave de la serie protagonista: el trazo más una copia desenfocada a
 * media opacidad. Se pone dentro de `<defs>` y se aplica con `filter={url(#id)}`.
 *
 * La región va en coordenadas de usuario y no en las del elemento
 * (`objectBoundingBox`): una serie plana —todos sus valores iguales, p. ej. 0
 * solicitudes porque el rol no ve ese volumen— tiene un cuadro de alto 0 y, por
 * especificación, el navegador no dibuja el elemento filtrado: la línea
 * desaparecía.
 */
export function GlowFilter({ id, std = 4 }: { id: string; std?: number }) {
  return (
    <filter id={id} filterUnits="userSpaceOnUse" x="0" y="-10%" width="100%" height="120%">
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

/** Opacidad (0–1) de una serie: atenúa las que no están en foco en la leyenda. */
export function seriesOpacity(key: string, focused: string | null) {
  return focused && focused !== key ? 0.15 : 1
}

export const chartLegendButtonClass = cn(
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)]",
  "transition-[background-color,opacity] duration-[var(--duration-fast)] hover:bg-[var(--color-surface-2)]",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
)
