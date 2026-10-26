"use client"

import * as React from "react"
import {
  Cell,
  Label,
  Pie,
  PieChart,
} from "recharts"
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { formatCLP } from "@/lib/utils"
import { CHART_SERIES } from "@/lib/chart-palette"


// ── 9. Dona de composición ───────────────────────────────────────────────────

export interface CompositionSlice {
  key: string
  label: string
  value: number
}

/**
 * Dona para **composición de un total** (gasto por módulo, estados
 * documentales): responde "de qué está hecho" mejor que una barra, porque el
 * total va al centro y cada arco se lee como parte de él.
 *
 * Sólo para composición. Para comparar magnitudes entre categorías la barra
 * sigue ganando —los ángulos se comparan peor que las longitudes—, y por eso el
 * ranking por faena o por producto no usa esto.
 */
export function CompositionDonutChart({ data, title, description, totalLabel, format = "count" }: {
  data: CompositionSlice[]
  title: string
  description: string
  totalLabel: string
  /**
   * Discriminador y **no** una función: este componente lo instancia un Server
   * Component, y las funciones no cruzan la frontera RSC — pasar `formatCLP`
   * directo tiraba la página entera al `error.tsx` del dashboard.
   */
  format?: "count" | "clp"
}) {
  /*
   * Se fusionan las porciones que comparten etiqueta antes de dibujar.
   *
   * `spendByModule` mapea varios módulos a "Otros", así que la leyenda mostraba
   * **"Otros" dos veces** con dos colores: dos porciones indistinguibles entre
   * sí. Lo detectó la pasada visual; ningún test lo veía.
   */
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const slices = React.useMemo(() => {
    const merged = new Map<string, CompositionSlice>()
    for (const slice of data) {
      if (slice.value <= 0) continue
      const current = merged.get(slice.label)
      if (current) current.value += slice.value
      else merged.set(slice.label, { ...slice })
    }
    return [...merged.values()].sort((left, right) => right.value - left.value)
  }, [data])
  const total = React.useMemo(() => slices.reduce((sum, slice) => sum + slice.value, 0), [slices])
  const config = React.useMemo<ChartConfig>(
    () => Object.fromEntries(slices.map((slice, index) => [slice.key, { label: slice.label, color: CHART_SERIES[index % CHART_SERIES.length] }])),
    [slices],
  )
  if (slices.length === 0) return null

  const formatted = (value: number) => (format === "clp" ? formatCLP(value) : value.toLocaleString("es-CL"))

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </div>

      {slices.length <= 2 ? (
        /* I-09: una dona de 1-2 categorías es decoración (Tufte) — la misma
           composición cabe en una barra apilada de 12 px y la tarjeta deja de
           reservar 192 px de alto para un solo dato. */
        <div>
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-[var(--color-text)]">{formatted(total)}</span>
            <span className="text-xs text-[var(--color-text-muted)]">{totalLabel}</span>
          </p>
          <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]" aria-hidden>
            {slices.map((slice, index) => (
              <div key={slice.key} style={{ width: `${(slice.value / total) * 100}%`, background: CHART_SERIES[index % CHART_SERIES.length] }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {slices.map((slice, index) => (
              <li key={slice.key} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <span className="size-2 rounded-full" style={{ background: CHART_SERIES[index % CHART_SERIES.length] }} aria-hidden />
                {slice.label}: <span className="font-mono font-semibold text-[var(--color-text)]">{formatted(slice.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ChartContainer config={config} className="h-48 w-full">
          <PieChart aria-label={title} onMouseLeave={() => setActiveIndex(null)}>
            <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => [formatted(Number(value)), String(name)]} />} />
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius={52} outerRadius={78} strokeWidth={2} paddingAngle={2}>
              {slices.map((slice, index) => (
                <Cell
                  key={slice.key}
                  fill={CHART_SERIES[index % CHART_SERIES.length]}
                  opacity={activeIndex === null || activeIndex === index ? 1 : 0.4}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  className="cursor-pointer transition-opacity duration-200"
                />
              ))}
              <Label content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox)) return null
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={viewBox.cy} className="fill-[var(--color-text)] font-mono text-lg font-bold">{formatted(total)}</tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-[var(--color-text-muted)] text-xs">{totalLabel}</tspan>
                  </text>
                )
              }} />
            </Pie>
            <ChartLegend content={<ChartLegendContent />} />
          </PieChart>
        </ChartContainer>
      )}
    </div>
  )
}


// ── 11. Barra apilada 100% de estados ────────────────────────────────────────

export interface StatusShare {
  key: string
  label: string
  value: number
  /**
   * Color semántico de la categoría (brand/signal/danger/neutral). Sin él se
   * asigna por índice sobre las categorías **presentes**, y eso pintaba "Por
   * mejorar" con el verde de marca cuando "Satisfactorios" venía en cero
   * (I-11): quien tenga semántica de estado debe declararla.
   */
  color?: string
}

/**
 * Una sola barra al 100% partida por estado.
 *
 * Para "cómo se reparte una población entre estados" cuando el total absoluto
 * ya está dicho en el KPI de al lado: la proporción se lee de un vistazo y no
 * compite con la cifra. Los conteos exactos van en el tooltip y en la leyenda.
 */
export function StatusShareBar({ data, title, description }: {
  data: StatusShare[]
  title: string
  description: string
}) {
  const slices = React.useMemo(() => data.filter((slice) => slice.value > 0), [data])
  const total = React.useMemo(() => slices.reduce((sum, slice) => sum + slice.value, 0), [slices])
  if (total === 0) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </div>

      <div className="flex h-6 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]" role="img" aria-label={slices.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        {slices.map((slice, index) => (
          <div
            key={slice.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(slice.value / total) * 100}%`, backgroundColor: slice.color ?? CHART_SERIES[index % CHART_SERIES.length] }}
            title={`${slice.label}: ${slice.value} (${Math.round((slice.value / total) * 100)}%)`}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {slices.map((slice, index) => (
          <li key={slice.key} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: slice.color ?? CHART_SERIES[index % CHART_SERIES.length] }} aria-hidden />
            {slice.label}
            <span className="font-mono tabular-nums text-[var(--color-text)]">{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
