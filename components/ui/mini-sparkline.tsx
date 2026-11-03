import * as React from "react"
import { cn } from "@/lib/utils"
import { CHART_COLORS } from "@/lib/chart-palette"

/**
 * Sparkline de tendencia, en SVG plano.
 *
 * No usa recharts a propósito. La versión anterior vivía en
 * `dashboard-charts.tsx` y se importaba de forma **estática** desde la tira de
 * KPIs, lo que arrastraba recharts (~168kb) al chunk inicial del Centro de
 * Control — anulando el `next/dynamic` de la sección analítica, que existe
 * justamente para evitarlo (auditoría UIUX-002). Una polilínea no justifica esa
 * dependencia, y sin ella el sparkline se puede usar también en el lateral.
 *
 * Decorativo: `aria-hidden` porque el valor y su comparación ya están en texto
 * junto a él. Sin animación, así que no hay nada que atenuar bajo
 * `prefers-reduced-motion`.
 *
 * `markedIndex` pone un punto sobre una lectura (la que se está revisando, p. ej.
 * la lectura que retrocede en la evidencia de «Por revisar»). Sigue siendo
 * decorativo: quien lo use dice esa lectura también en texto.
 */
export function MiniSparkline({
  data,
  color = CHART_COLORS.blue,
  markedIndex,
  markedColor = CHART_COLORS.danger,
  className,
}: {
  data: number[]
  color?: string
  /** Índice de `data` que lleva un punto; fuera de rango, se ignora. */
  markedIndex?: number
  markedColor?: string
  className?: string
}) {
  const coords = React.useMemo(() => buildCoords(data), [data])
  if (!coords) return null
  const points = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")
  const marked = markedIndex !== undefined ? coords[markedIndex] : undefined

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className={cn("h-7 w-20 shrink-0 overflow-visible", className)}
      aria-hidden
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {marked ? (
        // Un trazo de largo casi nulo con punta redonda y grosor fijo: es un punto circular aunque el
        // svg se estire (`preserveAspectRatio="none"` deformaría un `<circle>` en una elipse).
        <line
          data-marked=""
          x1={marked[0]}
          y1={marked[1]}
          x2={marked[0] + 0.001}
          y2={marked[1]}
          stroke={markedColor}
          strokeWidth={7}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  )
}

const VIEW_W = 80
const VIEW_H = 28
/** Deja aire arriba y abajo para que el trazo no se corte en los extremos. */
const PAD = 2

function buildCoords(data: number[]): Array<[number, number]> | null {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  // Serie plana: una línea al medio, no una división por cero.
  const span = max - min || 1
  const stepX = VIEW_W / (data.length - 1)
  const usableH = VIEW_H - PAD * 2

  return data.map((value, i) => [
    i * stepX,
    max === min ? VIEW_H / 2 : PAD + usableH - ((value - min) / span) * usableH,
  ])
}
