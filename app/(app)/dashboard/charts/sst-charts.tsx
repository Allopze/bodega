"use client"

import { formatQty } from "@/lib/utils"
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
import {
  ChartTooltipCard,
  ColumnHoverCursor,
  seriesOpacity,
  useActiveIndex,
  useChartMotion,
  useTooltipProps,
  ChartActiveSync,
} from "@/components/ui/chart-interactions"
import { CHART_COLORS } from "@/lib/chart-palette"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "./chart-frame"
import {
  COUNT_DOMAIN,
  InteractiveLegend,
  SERIES_FADE_CLASS,
  SURFACE,
  activeDotFor,
  dimmedBarShape,
  emphasizedTick,
  monthFullName,
  monthTitle,
  useSeriesFocus,
  type LegendEntry,
} from "./chart-parts"

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

/** Las tasas llevan hasta 2 decimales: con 1 una TG de 0,04 se leería como 0. */
const formatRate = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 2 })

/**
 * Un eje por tasa. Comparten el rótulo "× 1.000.000 / HH" pero no la escala: la
 * de gravedad cuenta **días** perdidos y de cargo, la de frecuencia cuenta
 * **personas** lesionadas (`safety-indicators-calc.ts:187-188`). Un accidente
 * con 30 días de reposo mueve TG dos órdenes de magnitud más que TF, y en un eje
 * común la línea de frecuencia se aplanaba contra el cero.
 *
 * Sin cifra grande en la cabecera: son dos unidades y una sola cifra privilegiaría
 * a una. Los valores del mes apuntado salen en la leyenda.
 */
export function SstTrendChart({ data }: { data: SstMonthlyPoint[] }) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  // Ambas tasas en cero todo el año: no hay línea que leer (I-03).
  if (!data.some((row) => row.tasaFrecuencia > 0 || row.tasaGravedad > 0)) return null

  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const legend: LegendEntry[] = [
    { key: "tasaFrecuencia", label: "Tasa de Frecuencia (TF)", color: CHART_COLORS.blue, value: at ? formatRate(at.tasaFrecuencia) : undefined },
    { key: "tasaGravedad", label: "Tasa de Gravedad (TG)", color: CHART_COLORS.danger, value: at ? formatRate(at.tasaGravedad) : undefined },
  ]

  return (
    <ChartFrame
      title="Tasas de Siniestralidad SST"
      description="Tasa de Frecuencia (izq.) y Tasa de Gravedad (der.), cada una en su escala"
    >
      <ChartContainer config={sstChartConfig} className={`h-52 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="lines">
        <ComposedChart
          accessibilityLayer
          aria-label="Tasas de Siniestralidad SST"
          data={data}
          margin={{ top: 12, right: 0, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tick={emphasizedTick(at?.month)} />
          <ChartActiveSync labels={data.map((row) => row.month)} onIndex={active.setActiveIndex} />
          <YAxis yAxisId="tf" tickLine={false} axisLine={false} tickMargin={8} width={36} fontSize={11} />
          <YAxis yAxisId="tg" orientation="right" tickLine={false} axisLine={false} tickMargin={4} width={44} fontSize={11} />
          <ChartTooltip
            {...tooltip}
            content={<ChartTooltipCard valueFormat="count" labelFormatter={(label) => monthTitle(String(label))} />}
          />
          <Line
            yAxisId="tf"
            type="monotone"
            dataKey="tasaFrecuencia"
            name="Tasa de Frecuencia (TF)"
            stroke={CHART_COLORS.blue}
            strokeWidth={2}
            strokeLinecap="round"
            strokeOpacity={seriesOpacity("tasaFrecuencia", focus.focusedKey)}
            dot={{ r: 2.5, fill: SURFACE, strokeWidth: 1.8 }}
            activeDot={activeDotFor(CHART_COLORS.blue)}
            {...motion}
          />
          <Line
            yAxisId="tg"
            type="monotone"
            dataKey="tasaGravedad"
            name="Tasa de Gravedad (TG)"
            stroke={CHART_COLORS.danger}
            strokeWidth={2}
            strokeLinecap="round"
            strokeOpacity={seriesOpacity("tasaGravedad", focus.focusedKey)}
            dot={{ r: 2.5, fill: SURFACE, strokeWidth: 1.8 }}
            activeDot={activeDotFor(CHART_COLORS.danger)}
            {...motion}
          />
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de las tasas de siniestralidad" />
    </ChartFrame>
  )
}

// ── 4. SST Accident Qualification Chart ──────────────────────────────────────

/**
 * Barra **apilada**: el alto de la columna es el total provisional del mes y los
 * segmentos lo parten en confirmado y por calificar. Apilado y no agrupado
 * porque las dos series son partes de un mismo total, no magnitudes a comparar
 * (ver `sstAccidentConfig`).
 *
 * La cifra grande es el total de accidentes (confirmados + por calificar) del
 * período graficado, o el del mes apuntado.
 */
export function SstAccidentChart({ data }: { data: SstMonthlyPoint[] }) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  // Sin accidentes en el año la tarjeta pintaba sólo ejes y gridlines, con la
  // descripción "todos están confirmados" hablando de un conjunto vacío (I-03).
  if (!data.some((point) => point.confirmados + point.porCalificar > 0)) return null

  const hasPending = data.some((point) => point.porCalificar > 0)
  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const total = at
    ? at.confirmados + at.porCalificar
    : data.reduce((sum, point) => sum + point.confirmados + point.porCalificar, 0)
  const legend: LegendEntry[] = [
    { key: "confirmados", label: "Confirmados", color: CHART_COLORS.danger, swatch: "box", value: at ? formatQty(at.confirmados) : undefined },
    { key: "porCalificar", label: "Por calificar", color: CHART_COLORS.signal, swatch: "box", value: at ? formatQty(at.porCalificar) : undefined },
  ]

  return (
    <ChartFrame
      title="Accidentes por estado de calificación"
      description={hasPending
        ? "Confirmados y pendientes por calificar en cada mes"
        : "Todos los accidentes del período están confirmados"}
      headline={
        <>
          <ChartHeadlineValue>{formatQty(total)}</ChartHeadlineValue>
          <ChartHeadlineCaption>
            {total === 1 ? "accidente" : "accidentes"} en {at ? monthFullName(at.month) : data.length === 12 ? "el año" : "el período"}
          </ChartHeadlineCaption>
        </>
      }
    >
      <ChartContainer config={sstAccidentConfig} className="h-52 w-full" data-chart-kind="bars">
        <ComposedChart
          accessibilityLayer
          aria-label="Accidentes por estado de calificación"
          data={data}
          margin={{ top: 12, right: 0, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tick={emphasizedTick(at?.month)} />
          <ChartActiveSync labels={data.map((row) => row.month)} onIndex={active.setActiveIndex} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} fontSize={11} domain={COUNT_DOMAIN} tickCount={5} allowDecimals={false} />
          <ChartTooltip
            {...tooltip}
            cursor={<ColumnHoverCursor />}
            content={
              <ChartTooltipCard
                valueFormat="count"
                labelFormatter={(label) => monthTitle(String(label))}
                footer={(payload) => `Total del mes: ${formatQty(payload.reduce((sum, item) => sum + (Number(item.value) || 0), 0))}`}
              />
            }
          />
          {/* Un solo `stackId`: el tope de la columna es el total provisional. */}
          <Bar
            dataKey="confirmados"
            name="Confirmados"
            stackId="accidentes"
            fill={CHART_COLORS.danger}
            radius={hasPending ? [0, 0, 0, 0] : [4, 4, 0, 0]}
            maxBarSize={48}
            shape={dimmedBarShape("confirmados", active.activeIndex, focus.focusedKey)}
            {...motion}
          />
          <Bar
            dataKey="porCalificar"
            name="Por calificar"
            stackId="accidentes"
            fill={CHART_COLORS.signal}
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
            shape={dimmedBarShape("porCalificar", active.activeIndex, focus.focusedKey)}
            {...motion}
          />
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de accidentes por estado" />
    </ChartFrame>
  )
}

// ── 5. Material & Environmental Chart ───────────────────────────────────────

export function MaterialEnvironmentalChart({ data }: { data: MaterialEnvironmentalPoint[] }) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  // Todo-en-cero → rejilla vacía + "el mes con más eventos es Ene" (I-03).
  if (!data.some((row) => row.dangerousIncidents + row.materialDamage + row.environmentalSpills > 0)) return null

  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const legend: LegendEntry[] = [
    { key: "dangerousIncidents", label: "Inc. Peligrosos", color: CHART_COLORS.violet, swatch: "box", value: at ? formatQty(at.dangerousIncidents) : undefined },
    { key: "materialDamage", label: "Daño Material", color: CHART_COLORS.signal, swatch: "box", value: at ? formatQty(at.materialDamage) : undefined },
    { key: "environmentalSpills", label: "Daño Ambiental", color: CHART_COLORS.teal, swatch: "box", value: at ? formatQty(at.environmentalSpills) : undefined },
  ]

  return (
    <ChartFrame
      title="Impacto Material y Ambiental"
      description="Incidentes peligrosos, daños materiales y derrames ambientales"
    >
      <ChartContainer config={materialEnvConfig} className="h-52 w-full" data-chart-kind="bars">
        <ComposedChart
          accessibilityLayer
          aria-label="Impacto Material y Ambiental"
          data={data}
          margin={{ top: 12, right: 0, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tick={emphasizedTick(at?.month)} />
          <ChartActiveSync labels={data.map((row) => row.month)} onIndex={active.setActiveIndex} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} fontSize={11} domain={COUNT_DOMAIN} tickCount={5} allowDecimals={false} />
          <ChartTooltip
            {...tooltip}
            cursor={<ColumnHoverCursor />}
            content={<ChartTooltipCard valueFormat="count" labelFormatter={(label) => monthTitle(String(label))} />}
          />
          <Bar dataKey="dangerousIncidents" name="Inc. Peligrosos" fill={CHART_COLORS.violet} radius={[4, 4, 0, 0]} maxBarSize={48} shape={dimmedBarShape("dangerousIncidents", active.activeIndex, focus.focusedKey)} {...motion} />
          <Bar dataKey="materialDamage" name="Daño Material" fill={CHART_COLORS.signal} radius={[4, 4, 0, 0]} maxBarSize={48} shape={dimmedBarShape("materialDamage", active.activeIndex, focus.focusedKey)} {...motion} />
          <Bar dataKey="environmentalSpills" name="Daño Ambiental" fill={CHART_COLORS.teal} radius={[4, 4, 0, 0]} maxBarSize={48} shape={dimmedBarShape("environmentalSpills", active.activeIndex, focus.focusedKey)} {...motion} />
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de impacto material y ambiental" />
    </ChartFrame>
  )
}
