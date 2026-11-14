"use client"

import type { ReactNode } from "react"
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import {
  ChartActiveSync,
  ChartTooltipCard,
  ColumnHoverCursor,
  seriesOpacity,
  useActiveIndex,
  useChartMotion,
  useTooltipProps,
} from "@/components/ui/chart-interactions"
import { ChartDataTable, type ChartDataExcel } from "@/components/charts/chart-data-table"
import {
  InteractiveLegend,
  SERIES_FADE_CLASS,
  activeDotFor,
  dimmedBarShape,
  emphasizedTick,
  partialTailLineShape,
  useSeriesFocus,
  COUNT_DOMAIN,
  type LegendEntry,
} from "@/components/charts/chart-parts"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import { bucketLabel, type IndicatorGranularity } from "@/lib/indicators/period"
import { CHART_COLORS } from "@/lib/chart-palette"
import { formatPercent, formatQty } from "@/lib/utils"

/**
 * Gráficos de los Indicadores de mantención. Todo recharts vive aquí y se carga diferido
 * (`indicators-charts-lazy.tsx`); la página nunca importa este archivo de forma estática.
 *
 * Cada gráfico devuelve `null` sin datos (su `ChartSlot` se oculta) y declara una sola unidad
 * por eje (A5b): OT, registros y días-equipo nunca comparten escala.
 */

export interface BucketPoint {
  /** Clave del balde: `YYYY-MM-DD` (día) o `YYYY-MM` (mes). */
  key: string
  /** El balde en curso: sus cifras valen sólo hasta hoy. */
  partial: boolean
}

interface ChartCommon {
  granularity: IndicatorGranularity
  /** Ventana y alcance, tal como se dicen bajo el título: «1 sept 2026 al 13 nov 2026 · todas las faenas». */
  scopeNote: string
  /** Descarga de la tabla «Ver datos»; sólo con el permiso de exportar del módulo. */
  excel?: ChartDataExcel
}

/** «3 nov 2026» o «nov 2026»: el balde completo, para el tooltip y la tabla. */
export function bucketFullLabel(key: string, granularity: IndicatorGranularity): string {
  if (granularity === "month") return bucketLabel(key, "month")
  return `${bucketLabel(key, "day")} ${key.slice(0, 4)}`
}

/** Los puntos con su rótulo de eje (único por balde): el eje X y el tooltip se indexan por él. */
function withLabels<T extends BucketPoint>(data: T[], granularity: IndicatorGranularity): Array<T & { label: string }> {
  return data.map((point) => ({ ...point, label: bucketLabel(point.key, granularity) }))
}

function describePartial(points: BucketPoint[], granularity: IndicatorGranularity) {
  const partial = points.some((point) => point.partial)
  return partial ? ` · el ${granularity === "day" ? "último día" : "último mes"} es parcial` : ""
}

/**
 * El balde con el valor más alto de `pick`. Con empate no hay un «mayor» que nombrar: devuelve cuántos
 * baldes empatan (y ningún balde), para que el titular no corone a uno solo.
 */
export function peakOf<T extends BucketPoint>(points: readonly T[], pick: (point: T) => number): { value: number; tied: number; point: T | null } {
  const value = Math.max(0, ...points.map(pick))
  const leaders = points.filter((point) => pick(point) === value)
  return { value, tied: leaders.length, point: leaders.length === 1 ? leaders[0]! : null }
}

const formatDays = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 1 })

// ── Barras por balde (apiladas o una sola serie) ───────────────────────────

interface StackSeries<K extends string> {
  key: K
  label: string
  color: string
}

function StackedBucketsChart<K extends string>({
  title,
  source,
  ariaLabel,
  series,
  data,
  granularity,
  scopeNote,
  excel,
  stacked,
  allowDecimals,
  headline,
}: ChartCommon & {
  title: string
  /** De dónde salen los datos («órdenes de trabajo»). */
  source: string
  ariaLabel: string
  series: ReadonlyArray<StackSeries<K>>
  data: Array<BucketPoint & Record<K, number>>
  stacked: boolean
  allowDecimals?: boolean
  /** Cifra grande y su pie: de todo el rango o del balde apuntado. */
  headline: (at: (BucketPoint & Record<K, number>) | undefined, all: Array<BucketPoint & Record<K, number>>) => { value: ReactNode; caption: string }
}) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  if (!data.length || !data.some((point) => series.some((item) => point[item.key] > 0))) return null

  const rows = withLabels(data, granularity)
  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const atLabel = active.activeIndex === null ? undefined : rows[Math.min(active.activeIndex, rows.length - 1)]?.label
  const partialFrom = data.findIndex((point) => point.partial)
  const config = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }])) as ChartConfig
  const { value, caption } = headline(at, data)
  const legend: LegendEntry[] = series.map((item) => ({
    key: item.key,
    label: item.label,
    color: item.color,
    swatch: "box",
    value: at ? (allowDecimals ? formatDays(at[item.key]) : formatQty(at[item.key])) : undefined,
  }))
  const names = Object.fromEntries(series.map((item) => [item.key, item.label]))
  const lastIndex = series.length - 1

  return (
    <ChartFrame
      title={title}
      description={`${scopeNote} · Fuente: ${source}${describePartial(data, granularity)}`}
      headline={
        <>
          <ChartHeadlineValue>{value}</ChartHeadlineValue>
          <ChartHeadlineCaption>{caption}</ChartHeadlineCaption>
        </>
      }
    >
      <ChartContainer config={config} className={`h-52 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="bars">
        <ComposedChart accessibilityLayer aria-label={ariaLabel} data={rows} margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={11}
            minTickGap={granularity === "day" ? 18 : 8}
            interval={granularity === "day" ? "preserveStartEnd" : 0}
            tick={emphasizedTick(atLabel)}
          />
          <ChartActiveSync labels={rows.map((point) => point.label)} onIndex={active.setActiveIndex} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={36}
            fontSize={11}
            allowDecimals={allowDecimals ?? false}
            {...(allowDecimals ? {} : { domain: COUNT_DOMAIN, tickCount: 5 })}
            tickFormatter={(tick: number) => (allowDecimals ? formatDays(tick) : formatQty(tick))}
          />
          <ChartTooltip
            {...tooltip}
            cursor={<ColumnHoverCursor />}
            content={
              <ChartTooltipCard
                names={names}
                labelFormatter={(label) => {
                  const point = rows.find((row) => row.label === String(label))
                  return point ? `${bucketFullLabel(point.key, granularity)}${point.partial ? " (parcial)" : ""}` : String(label)
                }}
              />
            }
          />
          {series.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.label}
              fill={item.color}
              {...(stacked ? { stackId: "stack" } : {})}
              {...(!stacked || index === lastIndex ? { radius: [4, 4, 0, 0] as [number, number, number, number] } : {})}
              maxBarSize={granularity === "day" ? 18 : 44}
              shape={dimmedBarShape(item.key, active.activeIndex, focus.focusedKey, partialFrom)}
              {...motion}
            />
          ))}
        </ComposedChart>
      </ChartContainer>
      {series.length > 1 && <InteractiveLegend entries={legend} focus={focus} label={`Series: ${title}`} />}
      <ChartDataTable
        caption={title}
        headers={["Período", ...series.map((item) => item.label)]}
        rows={data.map((point) => [
          `${bucketFullLabel(point.key, granularity)}${point.partial ? " (parcial)" : ""}`,
          ...series.map((item) => (allowDecimals ? formatDays(point[item.key]) : point[item.key])),
        ])}
        excel={excel}
      />
    </ChartFrame>
  )
}

// ── (b) Reparación vs mantención ───────────────────────────────────────────

export interface WorkOrderMixPoint extends BucketPoint {
  repairOnly: number
  maintenanceOnly: number
  both: number
}

const MIX_SERIES = [
  { key: "repairOnly", label: "Reparación", color: CHART_COLORS.blue },
  { key: "maintenanceOnly", label: "Mantención", color: CHART_COLORS.brand },
  { key: "both", label: "Reparación y mantención", color: CHART_COLORS.amber },
] as const

export function WorkOrderMixChart(props: ChartCommon & { data: WorkOrderMixPoint[] }) {
  return (
    <StackedBucketsChart
      {...props}
      title="Reparación y mantención"
      source="órdenes de trabajo creadas"
      ariaLabel="Órdenes de trabajo creadas por período, reparación y mantención apiladas"
      series={MIX_SERIES}
      stacked
      headline={(at, all) => {
        const rows = at ? [at] : all
        const total = rows.reduce((sum, point) => sum + point.repairOnly + point.maintenanceOnly + point.both, 0)
        const repairs = rows.reduce((sum, point) => sum + point.repairOnly + point.both, 0)
        return {
          value: total > 0 ? formatPercent((repairs / total) * 100, 0) : "—",
          caption: `de las OT creadas son reparaciones (${formatQty(repairs)} de ${formatQty(total)}${at ? `, ${bucketFullLabel(at.key, props.granularity)}` : ""})`,
        }
      }}
    />
  )
}

// ── (d) Registros preventivos vs correctivos ───────────────────────────────

export interface RecordsPoint extends BucketPoint {
  preventive: number
  corrective: number
}

const RECORD_SERIES = [
  { key: "preventive", label: "Preventivos", color: CHART_COLORS.brand },
  { key: "corrective", label: "Correctivos", color: CHART_COLORS.blue },
] as const

export function RecordsKindChart(props: ChartCommon & { data: RecordsPoint[] }) {
  return (
    <StackedBucketsChart
      {...props}
      title="Registros preventivos y correctivos"
      source="registros firmados vigentes"
      ariaLabel="Registros firmados por período, preventivos y correctivos apilados"
      series={RECORD_SERIES}
      stacked
      headline={(at, all) => {
        const rows = at ? [at] : all
        const preventive = rows.reduce((sum, point) => sum + point.preventive, 0)
        const corrective = rows.reduce((sum, point) => sum + point.corrective, 0)
        const total = preventive + corrective
        // El titular no repite el tile «Registros preventivos»: dice qué parte del trabajo firmado fue correctivo.
        return {
          value: total > 0 ? formatPercent((corrective / total) * 100, 0) : "—",
          caption: `de los registros fueron correctivos (${formatQty(corrective)} de ${formatQty(total)}${at ? `, ${bucketFullLabel(at.key, props.granularity)}` : ""})`,
        }
      }}
    />
  )
}

// ── (f) Días fuera de servicio ─────────────────────────────────────────────

export interface OutOfServicePoint extends BucketPoint {
  days: number
}

const DAYS_SERIES = [{ key: "days", label: "Días fuera de servicio", color: CHART_COLORS.amber }] as const

export function OutOfServiceChart(props: ChartCommon & { data: OutOfServicePoint[] }) {
  return (
    <StackedBucketsChart
      {...props}
      title="Días fuera de servicio"
      source="estado operacional de los equipos (mantención o fuera de servicio)"
      ariaLabel="Días-equipo fuera de servicio por período"
      series={DAYS_SERIES}
      stacked={false}
      allowDecimals
      headline={(at, all) => {
        // El total del período es el del tile (se calcula y redondea una sola vez, en el servicio): aquí se
        // dice cuándo se concentró, que es lo que el tile no dice.
        if (at) return { value: formatDays(at.days), caption: `días-equipo fuera de servicio en ${bucketFullLabel(at.key, props.granularity)}` }
        const peak = peakOf(all, (point) => point.days)
        return {
          value: formatDays(peak.value),
          caption: peak.point
            ? `días-equipo fuera de servicio en ${bucketFullLabel(peak.point.key, props.granularity)}, el período con más`
            : `días-equipo fuera de servicio en cada uno de ${peak.tied} períodos, el máximo del rango`,
        }
      }}
    />
  )
}

// ── (a) OT creadas vs cerradas y backlog ───────────────────────────────────

export interface WorkOrderFlowPoint extends BucketPoint {
  created: number
  closed: number
  backlog: number
}

const FLOW_CONFIG = {
  created: { label: "Creadas", color: CHART_COLORS.blue },
  closed: { label: "Cerradas", color: CHART_COLORS.brand },
  backlog: { label: "En cola", color: CHART_COLORS.signal },
} satisfies ChartConfig

/**
 * Barras: OT creadas y cerradas por período. Línea: OT en cola al terminar el período (pedidas y
 * aún no cerradas ni anuladas). Las tres son OT, una sola unidad: comparten eje sin engañar.
 */
export function WorkOrderFlowChart({ data, granularity, scopeNote, excel }: ChartCommon & { data: WorkOrderFlowPoint[] }) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  if (!data.length || !data.some((point) => point.created + point.closed + point.backlog > 0)) return null

  const rowsWithLabel = withLabels(data, granularity)
  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const atLabel = active.activeIndex === null ? undefined : rowsWithLabel[Math.min(active.activeIndex, rowsWithLabel.length - 1)]?.label
  const partialFrom = data.findIndex((point) => point.partial)
  // El titular no repite los tiles de la sección (OT abiertas, OT cerradas): dice cuándo se pidió más trabajo.
  const peak = peakOf(data, (point) => point.created)
  const headlineValue = at ? at.created : peak.value
  const headlineCaption = at
    ? `OT creadas en ${bucketFullLabel(at.key, granularity)} · ${formatQty(at.closed)} cerradas y ${formatQty(at.backlog)} en cola al cierre`
    : peak.point
      ? `OT creadas en ${bucketFullLabel(peak.point.key, granularity)}, el período con más`
      : `OT creadas en cada uno de ${peak.tied} períodos, el máximo del rango`
  const legend: LegendEntry[] = [
    { key: "created", label: "Creadas", color: CHART_COLORS.blue, swatch: "box", value: at ? formatQty(at.created) : undefined },
    { key: "closed", label: "Cerradas", color: CHART_COLORS.brand, swatch: "box", value: at ? formatQty(at.closed) : undefined },
    { key: "backlog", label: "En cola", color: CHART_COLORS.signal, value: at ? formatQty(at.backlog) : undefined },
  ]

  return (
    <ChartFrame
      title="Órdenes de trabajo: creadas, cerradas y en cola"
      description={`${scopeNote} · Fuente: órdenes de trabajo${describePartial(data, granularity)}`}
      headline={
        <>
          <ChartHeadlineValue>{formatQty(headlineValue)}</ChartHeadlineValue>
          <ChartHeadlineCaption>{headlineCaption}</ChartHeadlineCaption>
        </>
      }
    >
      <ChartContainer config={FLOW_CONFIG} className={`h-52 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="bars">
        <ComposedChart accessibilityLayer aria-label="Órdenes de trabajo creadas y cerradas por período, y órdenes en cola al cierre de cada período" data={rowsWithLabel} margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={11}
            minTickGap={granularity === "day" ? 18 : 8}
            interval={granularity === "day" ? "preserveStartEnd" : 0}
            tick={emphasizedTick(atLabel)}
          />
          <ChartActiveSync labels={rowsWithLabel.map((point) => point.label)} onIndex={active.setActiveIndex} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={36} fontSize={11} allowDecimals={false} domain={COUNT_DOMAIN} tickCount={5} tickFormatter={(tick: number) => formatQty(tick)} />
          <ChartTooltip
            {...tooltip}
            cursor={<ColumnHoverCursor />}
            content={
              <ChartTooltipCard
                names={{ created: "Creadas", closed: "Cerradas", backlog: "En cola al cierre" }}
                labelFormatter={(label) => {
                  const point = rowsWithLabel.find((row) => row.label === String(label))
                  return point ? `${bucketFullLabel(point.key, granularity)}${point.partial ? " (parcial)" : ""}` : String(label)
                }}
              />
            }
          />
          <Bar dataKey="created" name="Creadas" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} maxBarSize={granularity === "day" ? 10 : 24} shape={dimmedBarShape("created", active.activeIndex, focus.focusedKey, partialFrom)} {...motion} />
          <Bar dataKey="closed" name="Cerradas" fill={CHART_COLORS.brand} radius={[4, 4, 0, 0]} maxBarSize={granularity === "day" ? 10 : 24} shape={dimmedBarShape("closed", active.activeIndex, focus.focusedKey, partialFrom)} {...motion} />
          <Line
            type="monotone"
            dataKey="backlog"
            name="En cola"
            stroke={CHART_COLORS.signal}
            strokeWidth={2}
            strokeLinecap="round"
            strokeOpacity={seriesOpacity("backlog", focus.focusedKey)}
            shape={partialTailLineShape(partialFrom)}
            dot={granularity === "month" ? { r: 3, fill: "var(--color-surface)", strokeWidth: 2 } : false}
            activeDot={activeDotFor(CHART_COLORS.signal)}
            {...motion}
          />
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de las órdenes de trabajo" />
      <ChartDataTable
        caption="Órdenes de trabajo: creadas, cerradas y en cola"
        headers={["Período", "Creadas", "Cerradas", "En cola al cierre"]}
        rows={data.map((point) => [`${bucketFullLabel(point.key, granularity)}${point.partial ? " (parcial)" : ""}`, point.created, point.closed, point.backlog])}
        excel={excel}
      />
    </ChartFrame>
  )
}
