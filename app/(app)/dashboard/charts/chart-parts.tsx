"use client"

import * as React from "react"
import { Rectangle, Text, type BarShapeProps } from "recharts"
import {
  chartLegendButtonClass,
  formatChartValue,
  seriesOpacity,
  type ChartTooltipCardItem,
  type ChartValueFormat,
} from "@/components/ui/chart-interactions"
import { MONTH_LABELS, cn } from "@/lib/utils"

/*
 * Piezas que comparten los gráficos de series por mes (tendencia, facturación,
 * SST, flota). Viven acá y no en `components/ui/chart-interactions.tsx`
 * (contrato de la Fase 0, que esta línea no edita) porque dependen de recharts
 * y de la forma de los datos del tablero.
 */

// ── Meses ────────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const

/**
 * "Ene" → "enero"; "Jul 2026" → "julio". Los servicios entregan el mes como
 * rótulo corto (`MONTH_LABELS`) y las cabeceras de los gráficos piden el nombre
 * completo ("solicitudes en julio"). Un rótulo que no calza se devuelve tal cual.
 */
export function monthFullName(label: string): string {
  const abbreviation = label.trim().split(/\s+/)[0]?.toLowerCase()
  const index = MONTH_LABELS.findIndex((short) => short.toLowerCase() === abbreviation)
  return MONTH_NAMES[index] ?? label.toLowerCase()
}

/** "Jul 2026" → "Julio 2026"; "Ene" → "Enero". Para el encabezado del tooltip. */
export function monthTitle(label: string): string {
  const [, ...rest] = label.trim().split(/\s+/)
  const name = monthFullName(label)
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1)
  return rest.length > 0 && name !== label.toLowerCase() ? `${capitalized} ${rest.join(" ")}` : capitalized
}

// ── Ids y estilos comunes ────────────────────────────────────────────────────

/** Id sin `:` para usar en `url(#…)`: `useId()` devuelve `:r1:`, que rompe el selector. */
export function useChartUid() {
  return React.useId().replace(/:/g, "")
}

/**
 * Transición de opacidad de las series (leyenda que enfoca una, columna
 * apuntada que atenúa a las vecinas). Va en el `className` del `ChartContainer`:
 * recharts pinta los trazos, y el cambio de `strokeOpacity`/`fillOpacity` se
 * anima por CSS.
 */
export const SERIES_FADE_CLASS = cn(
  "[&_.recharts-line-curve]:transition-[stroke-opacity] [&_.recharts-line-curve]:duration-200",
  "[&_.recharts-area-area]:transition-[fill-opacity] [&_.recharts-area-area]:duration-200",
)

export const SURFACE = "var(--color-surface)"

/**
 * Tope "redondo" de un eje de conteos: 4 pasos de 1, 2 o 5 × 10ⁿ. Con el dominio
 * automático y `allowDecimals={false}` recharts elige pasos raros (0, 9, 18, 27,
 * 36); así los ticks caen en 0, 10, 20, 30, 40 y en 0, 1, 2, 3, 4 con pocos datos.
 */
export function niceCountMax(dataMax: number): number {
  const target = Math.max(dataMax, 1)
  for (let magnitude = 1; ; magnitude *= 10) {
    for (const base of [1, 2, 5]) {
      if (base * magnitude * 4 >= target) return base * magnitude * 4
    }
  }
}

/** Para `<YAxis domain={COUNT_DOMAIN} tickCount={5} allowDecimals={false} />`. */
export const COUNT_DOMAIN = [0, niceCountMax] as const

// ── Brillo ───────────────────────────────────────────────────────────────────

/**
 * Brillo suave de la serie protagonista.
 *
 * Mismo efecto que `GlowFilter` de `chart-interactions`, pero con la región del
 * filtro en coordenadas de usuario. `GlowFilter` usa el cuadro del elemento
 * (`objectBoundingBox`) y una serie plana —todos sus valores iguales, p. ej. 0
 * solicitudes porque el rol no ve ese volumen— tiene un cuadro de alto 0: por
 * especificación el navegador no dibuja el elemento y la línea desaparece. Con
 * `userSpaceOnUse` la región es el SVG entero y la línea plana se ve.
 */
export function ChartGlow({ id, std = 4 }: { id: string; std?: number }) {
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

// ── Enfoque de series (leyenda) ──────────────────────────────────────────────

/**
 * Serie enfocada: la que apunta el puntero o el teclado en la leyenda, o la que
 * el usuario fijó con un clic. El clic existe porque en pantallas táctiles no hay
 * hover, y porque un botón que no hace nada no es un botón.
 */
export function useSeriesFocus() {
  const [hovered, setHovered] = React.useState<string | null>(null)
  const [pinned, setPinned] = React.useState<string | null>(null)
  const togglePinned = React.useCallback((key: string) => setPinned((current) => (current === key ? null : key)), [])
  return { focusedKey: hovered ?? pinned, pinnedKey: pinned, setHovered, togglePinned }
}
export type SeriesFocus = ReturnType<typeof useSeriesFocus>

export interface LegendEntry {
  key: string
  label: string
  color: string
  /** Cifra al lado del rótulo (la del mes apuntado). Sin ella, sólo el rótulo. */
  value?: React.ReactNode
  /** `line` para series de línea, `box` para barras y porciones. */
  swatch?: "line" | "box"
}

export function InteractiveLegend({ entries, focus, label }: {
  entries: LegendEntry[]
  focus: SeriesFocus
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1">
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          aria-pressed={focus.pinnedKey === entry.key}
          className={cn(chartLegendButtonClass, focus.focusedKey && focus.focusedKey !== entry.key && "opacity-45")}
          onPointerEnter={() => focus.setHovered(entry.key)}
          onPointerLeave={() => focus.setHovered(null)}
          onFocus={() => focus.setHovered(entry.key)}
          onBlur={() => focus.setHovered(null)}
          onClick={() => focus.togglePinned(entry.key)}
        >
          <span
            aria-hidden
            className={cn("inline-block shrink-0", entry.swatch === "box" ? "size-2.5 rounded-[3px]" : "h-[3px] w-2.5 rounded-sm")}
            style={{ background: entry.color }}
          />
          {entry.label}
          {entry.value != null && <b className="font-semibold tabular-nums text-[var(--color-text)]">{entry.value}</b>}
        </button>
      ))}
    </div>
  )
}

// ── Piezas dentro del gráfico ────────────────────────────────────────────────

/**
 * Barra que se atenúa: la columna que no es la apuntada y la serie que no es la
 * enfocada en la leyenda bajan de opacidad. recharts llama a `shape` como función
 * (no la monta como componente), así que el `<Rectangle>` conserva su lugar en
 * el árbol entre renders y la transición CSS sí corre.
 */
export function dimmedBarShape(seriesKey: string, activeIndex: number | null, focusedKey: string | null) {
  return function DimmedBar(props: BarShapeProps) {
    const columnOpacity = activeIndex === null || activeIndex === props.index ? 1 : 0.35
    return (
      <Rectangle
        {...props}
        opacity={columnOpacity * seriesOpacity(seriesKey, focusedKey)}
        style={{ transition: "opacity 200ms ease" }}
      />
    )
  }
}

/** Punto sólo en el último mes de una serie de línea; se oculta mientras se apunta otro. */
export function lastPointDot(color: string, lastIndex: number, hidden: boolean, radius = 3.5) {
  return function LastPointDot({ index, cx, cy }: { index: number; cx?: number; cy?: number }) {
    if (hidden || index !== lastIndex || cx == null || cy == null) return null
    return <circle cx={cx} cy={cy} r={radius} fill={SURFACE} stroke={color} strokeWidth={2} />
  }
}

/** Punto activo de una serie de línea: relleno de superficie y borde del color de la serie. */
export function activeDotFor(color: string, radius = 4.5) {
  return { r: radius, fill: SURFACE, stroke: color, strokeWidth: 2.4 } as const
}

type AxisTickProps = Omit<React.ComponentProps<typeof Text>, "children"> & { payload?: { value?: unknown } }

/**
 * Tick del eje X con el mes apuntado (o el último, en reposo) en negrita y color
 * pleno. `fill` va en `style` y no como atributo: una regla CSS del contenedor
 * gana sobre los atributos de presentación.
 */
export function emphasizedTick(current: string | undefined) {
  return function EmphasizedTick(props: unknown) {
    const { payload, ...rest } = props as AxisTickProps
    const label = String(payload?.value ?? "")
    const emphasized = label === current
    return (
      <Text
        {...rest}
        style={{
          fill: emphasized ? "var(--color-text)" : "var(--color-text-subtle)",
          fontWeight: emphasized ? 700 : 400,
          transition: "fill 150ms ease",
        }}
      >
        {label}
      </Text>
    )
  }
}

// ── Tooltip con unidades distintas por serie ─────────────────────────────────

/**
 * `ChartTooltipCard` formatea todas las filas con un único `valueFormat`. Combustible
 * y mantención mezclan litros, dinero y conteos en un mismo tooltip, y además
 * pueden traer `null` (mes sin costo): `formatChartValue(null)` lo lee como 0 y
 * mostraría "$0" donde no hay dato. Esta versión formatea por serie y pinta "—"
 * para los vacíos. Mismo marcado que `ChartTooltipCard`.
 */
export function MixedUnitsTooltipCard({ active, payload, label, formats, labelFormatter, footer }: {
  active?: boolean
  payload?: ChartTooltipCardItem[]
  label?: unknown
  /** Formato por `dataKey`; el que falte se muestra como conteo. */
  formats: Record<string, ChartValueFormat>
  labelFormatter?: (label: unknown) => React.ReactNode
  footer?: (payload: ChartTooltipCardItem[]) => React.ReactNode
}) {
  if (!active || !payload?.length) return null
  const heading = labelFormatter ? labelFormatter(label) : label != null ? String(label) : null
  const footerContent = footer?.(payload)
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
              <span className="flex-1 text-[var(--color-text-muted)]">{item.name}</span>
              <span className="font-semibold tabular-nums text-[var(--color-text)]">
                {item.value == null ? "—" : formatChartValue(item.value, formats[key] ?? "count")}
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
