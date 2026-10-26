"use client"

import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
} from "recharts"
import {
  ChartConfig,
  ChartContainer,
} from "@/components/ui/chart"

import { CHART_COLORS } from "@/lib/chart-palette"


// ── 13. Radial Gauge ─────────────────────────────────────────────────────────

const gaugeConfig = {
  value: { label: "Avance", color: CHART_COLORS.brand },
} satisfies ChartConfig

/**
 * Medidor radial para una sola tasa contra su meta.
 *
 * Un porcentaje anual no es una serie: dibujarlo como línea de un punto o como
 * barra suelta desperdicia la tarjeta. El arco declara la meta y el color dice
 * si está bajo ella — `signal` (naranja) por debajo, marca por encima, que es
 * exactamente el rol reservado del naranja en DESIGN.md: "pendiente".
 */
export function RadialGaugeChart({ title, description, percent, targetPercent, footer }: {
  title: string
  description: string
  /** 0-100 ya redondeado por el llamador. */
  percent: number
  /** Meta en la misma escala. Omitida, el arco siempre va en color de marca. */
  targetPercent?: number
  footer?: string
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  const belowTarget = targetPercent !== undefined && value < targetPercent

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </div>

      <ChartContainer config={gaugeConfig} className="mx-auto aspect-[2/1] max-h-44 w-full">
        <RadialBarChart aria-label={title} data={[{ name: title, value }]} startAngle={200} endAngle={-20} innerRadius="72%" outerRadius="100%">
          {/* Sin el eje polar explícito recharts escala el arco al máximo del
              dato, así que un 41% dibujaba el círculo completo. */}
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            dataKey="value" angleAxisId={0} background cornerRadius={999}
            fill={belowTarget ? CHART_COLORS.signal : CHART_COLORS.brand}
            isAnimationActive={false}
          />
          {/* Centrado en el hueco del arco, no en la abertura de abajo.
              Con `y="78%"` la cifra caía entre las dos puntas del arco —que
              están a ~67% de la altura— y el texto mide 30px **fijos** mientras
              la geometría escala con el ancho de la columna: en la retícula de
              dos columnas el arco se encoge, la cifra no, y se solapaban. El
              interior (innerRadius 72%) es la zona ancha y vacía, así que
              centrarla ahí no puede chocar con nada a ningún ancho. */}
          <text
            x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
            className="fill-[var(--color-text)] font-mono text-3xl font-bold"
          >
            {`${value}%`}
          </text>
        </RadialBarChart>
      </ChartContainer>

      {(footer || targetPercent !== undefined) && (
        <p className="mt-1 text-center text-xs text-[var(--color-text-muted)]">
          {footer ?? `Meta ${targetPercent}%`}
        </p>
      )}
    </div>
  )
}
