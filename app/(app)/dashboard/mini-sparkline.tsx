import * as React from "react"
import { cn } from "@/lib/utils"
import { CHART_COLORS } from "./chart-palette"

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
 */
export function MiniSparkline({
  data,
  color = CHART_COLORS.blue,
  className,
}: {
  data: number[]
  color?: string
  className?: string
}) {
  const points = React.useMemo(() => buildPoints(data), [data])
  if (!points) return null

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
    </svg>
  )
}

const VIEW_W = 80
const VIEW_H = 28
/** Deja aire arriba y abajo para que el trazo no se corte en los extremos. */
const PAD = 2

function buildPoints(data: number[]): string | null {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  // Serie plana: una línea al medio, no una división por cero.
  const span = max - min || 1
  const stepX = VIEW_W / (data.length - 1)
  const usableH = VIEW_H - PAD * 2

  return data
    .map((value, i) => {
      const x = i * stepX
      const y = max === min
        ? VIEW_H / 2
        : PAD + usableH - ((value - min) / span) * usableH
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}
