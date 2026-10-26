"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

import { CHART_COLORS } from "@/lib/chart-palette"


const sstChartConfig = {
  tasaFrecuencia: {
    label: "Tasa de Frecuencia (TF)",
    color: CHART_COLORS.blue,
  },
  tasaGravedad: {
    label: "Tasa de Gravedad (TG)",
    color: CHART_COLORS.danger,
  },
} satisfies ChartConfig

/**
 * Accidentes por estado de calificación, **no** por gravedad.
 *
 * Antes rotulaba "Accidentes CTP / STP" dos series que salían de `confirmed` y
 * `provisional`, y esas no son clases de gravedad: `provisional` es
 * confirmados **más** pendientes (`safety-indicators-calc.ts:217-219`), o sea un
 * superconjunto. El gráfico mostraba la barra chica contenida dentro de la
 * grande como si fueran categorías excluyentes, y ninguna de las dos tenía que
 * ver con tiempo perdido.
 *
 * `IndicatorMetricSet` no expone desglose de tiempo perdido — el dato existe a
 * nivel de caso (`absenceAtLeastNormalShift`) pero el motor canónico no lo
 * agrega. Así que el gráfico deja de prometerlo y grafica la partición que sí
 * es real y sí le sirve a gerencia: cuánto del total ya está confirmado y
 * cuánto sigue por calificar.
 */
const sstAccidentConfig = {
  confirmados: {
    label: "Confirmados",
    color: CHART_COLORS.danger,
  },
  porCalificar: {
    label: "Por calificar",
    color: CHART_COLORS.signal,
  },
} satisfies ChartConfig


const materialEnvConfig = {
  dangerousIncidents: {
    label: "Inc. Peligrosos",
    color: CHART_COLORS.violet,
  },
  materialDamage: {
    label: "Daño Material",
    color: CHART_COLORS.signal,
  },
  environmentalSpills: {
    label: "Daño Ambiental",
    color: CHART_COLORS.teal,
  },
} satisfies ChartConfig

export interface SstMonthlyPoint {
  month: string
  tasaFrecuencia: number
  tasaGravedad: number
  /** Incidentes con todos sus casos incluidos (`confirmed.accidents`). */
  confirmados: number
  /** Incidentes que sólo tienen casos pendientes: `provisional − confirmed`. */
  porCalificar: number
}

export interface MaterialEnvironmentalPoint {
  month: string
  dangerousIncidents: number
  materialDamage: number
  environmentalSpills: number
}

// ── 3. SST Trend Chart (Tasa Frecuencia y Tasa Gravedad) ─────────────────────

/**
 * Un eje por tasa. Comparten el rótulo "× 1.000.000 / HH" pero no la escala: la
 * de gravedad cuenta **días** perdidos y de cargo, la de frecuencia cuenta
 * **personas** lesionadas (`safety-indicators-calc.ts:187-188`). Un accidente
 * con 30 días de reposo mueve TG dos órdenes de magnitud más que TF, y en un eje
 * común la línea de frecuencia se aplanaba contra el cero.
 */
export function SstTrendChart({ data }: { data: SstMonthlyPoint[] }) {
  // Ambas tasas en cero todo el año: no hay línea que leer (I-03).
  if (!data.some((row) => row.tasaFrecuencia > 0 || row.tasaGravedad > 0)) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Tasas de Siniestralidad SST</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Tasa de Frecuencia (izq.) y Tasa de Gravedad (der.), cada una en su escala</p>
      </div>

      <ChartContainer config={sstChartConfig} className="h-48 w-full">
        <LineChart aria-label="Tasas de Siniestralidad SST" data={data} margin={{ top: 10, right: 6, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis yAxisId="tf" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis yAxisId="tg" orientation="right" tickLine={false} axisLine={false} tickMargin={4} width={44} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Line yAxisId="tf" type="monotone" dataKey="tasaFrecuencia" stroke={CHART_COLORS.blue} strokeWidth={2} dot={{ r: 3 }} />
          <Line yAxisId="tg" type="monotone" dataKey="tasaGravedad" stroke={CHART_COLORS.danger} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ChartContainer>
    </div>
  )
}

// ── 4. SST Accident Qualification Chart ──────────────────────────────────────

/**
 * Barra **apilada**: el alto de la columna es el total provisional del mes y los
 * segmentos lo parten en confirmado y por calificar. Apilado y no agrupado
 * porque las dos series son partes de un mismo total, no magnitudes a comparar
 * (ver `sstAccidentConfig`).
 */
export function SstAccidentChart({ data }: { data: SstMonthlyPoint[] }) {
  // Sin accidentes en el año la tarjeta pintaba sólo ejes y gridlines, con la
  // descripción "todos están confirmados" hablando de un conjunto vacío (I-03).
  if (!data.some((point) => point.confirmados + point.porCalificar > 0)) return null

  const hasPending = data.some((point) => point.porCalificar > 0)

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Accidentes por estado de calificación</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          {hasPending
            ? "Confirmados y pendientes por calificar en cada mes"
            : "Todos los accidentes del período están confirmados"}
        </p>
      </div>

      <ChartContainer config={sstAccidentConfig} className="h-48 w-full">
        <BarChart aria-label="Accidentes por estado de calificación" data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          {/* Un solo `stackId`: el tope de la columna es el total provisional. */}
          <Bar dataKey="confirmados" stackId="accidentes" fill={CHART_COLORS.danger} radius={hasPending ? [0, 0, 0, 0] : [4, 4, 0, 0]} maxBarSize={48} />
          <Bar dataKey="porCalificar" stackId="accidentes" fill={CHART_COLORS.signal} radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── 5. Material & Environmental Chart ───────────────────────────────────────

export function MaterialEnvironmentalChart({ data }: { data: MaterialEnvironmentalPoint[] }) {
  // Todo-en-cero → rejilla vacía + "el mes con más eventos es Ene" (I-03).
  if (!data.some((row) => row.dangerousIncidents + row.materialDamage + row.environmentalSpills > 0)) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Impacto Material y Ambiental</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Incidentes peligrosos, daños materiales y derrames ambientales</p>
      </div>

      <ChartContainer config={materialEnvConfig} className="h-48 w-full">
        <BarChart aria-label="Impacto Material y Ambiental" data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="dangerousIncidents" fill={CHART_COLORS.violet} radius={[4, 4, 0, 0]} maxBarSize={48} />
          <Bar dataKey="materialDamage" fill={CHART_COLORS.signal} radius={[4, 4, 0, 0]} maxBarSize={48} />
          <Bar dataKey="environmentalSpills" fill={CHART_COLORS.teal} radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}
