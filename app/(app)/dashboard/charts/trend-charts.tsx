"use client"

import * as React from "react"
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
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
  useSpotlight,
  useTooltipProps,
  ChartActiveSync,
  GlowFilter,
} from "@/components/ui/chart-interactions"
import { Delta } from "@/components/ui/delta"
import { MONTH_LABELS, formatCompactCLP, formatQty, formatPercent } from "@/lib/utils"
import { CHART_COLORS } from "@/lib/chart-palette"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "./chart-frame"
import {
  COUNT_DOMAIN,
  InteractiveLegend,
  SERIES_FADE_CLASS,
  activeDotFor,
  dimmedBarShape,
  emphasizedTick,
  lastPointDot,
  monthFullName,
  monthTitle,
  useChartUid,
  useSeriesFocus,
  type LegendEntry,
} from "./chart-parts"

type TrendKey = "requests" | "orders" | "receipts"

interface TrendSeries {
  key: TrendKey
  label: string
  /** Cómo se nombra la cifra en una frase ("35 recepciones", "14 solicitudes"). */
  noun: string
  color: string
}

const REQUESTS_SERIES: TrendSeries = { key: "requests", label: "Solicitudes", noun: "solicitudes", color: CHART_COLORS.brand }

/** En orden de prioridad para ser la serie protagonista y el de la leyenda. */
const TREND_SERIES: readonly TrendSeries[] = [
  REQUESTS_SERIES,
  { key: "orders", label: "OC emitidas", noun: "OC emitidas", color: CHART_COLORS.blue },
  { key: "receipts", label: "Recepciones", noun: "recepciones", color: CHART_COLORS.neutral },
]

const trendChartConfig = {
  requests: { label: "Solicitudes", color: CHART_COLORS.brand },
  orders: { label: "OC emitidas", color: CHART_COLORS.blue },
  receipts: { label: "Recepciones", color: CHART_COLORS.neutral },
} satisfies ChartConfig

const billingFlowConfig = {
  invoiced: { label: "Facturado", color: CHART_COLORS.neutral },
  collected: { label: "Cobrado", color: CHART_COLORS.brand },
} satisfies ChartConfig

// ── 1. Tendencia operativa ───────────────────────────────────────────────────

/**
 * Contenido del tooltip de la tendencia. recharts sólo aplica `tooltipType="none"`
 * e `itemSorter` en su contenido por defecto; con uno propio la fila del `<Area>`
 * de relleno llega igual (y `ChartTooltipCard` la pintaría como una serie más, "requests 0")
 * y las filas llegan en el orden en que se dibujaron las series, con la protagonista
 * al final. Acá se quita la fila del relleno y se ordenan como la leyenda.
 */
function TrendTooltip(props: React.ComponentProps<typeof ChartTooltipCard>) {
  const order = TREND_SERIES.map((series) => String(series.key))
  const payload = props.payload
    ?.filter((item) => (item as { type?: string }).type !== "none")
    .sort((left, right) => order.indexOf(String(left.dataKey)) - order.indexOf(String(right.dataKey)))
  return <ChartTooltipCard {...props} payload={payload} />
}

type TrendPoint = { month: string; requests: number; orders: number; receipts: number }

/**
 * Solicitudes, órdenes y recepciones de los últimos meses.
 *
 * Una serie protagonista (por defecto Solicitudes: trazo grueso, brillo y área
 * bajo la curva con foco de luz) y dos de apoyo más delgadas. La cifra grande de
 * la cabecera y los valores de la leyenda siguen al mes apuntado y, en reposo,
 * muestran el último.
 *
 * Si el rol no ve el volumen de solicitudes esa serie llega toda en 0; entonces
 * la protagonista pasa a la primera serie con datos, para que la cabecera no diga
 * "0 solicitudes" de algo que simplemente no puede ver.
 */
export function OperationalTrendChart({ data }: { data: TrendPoint[] }) {
  const uid = useChartUid()
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const spot = useSpotlight(360)
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  const hasData = data.some((row) => row.requests + row.orders + row.receipts > 0)
  const emphasized = TREND_SERIES.find((series) => data.some((row) => row[series.key] > 0)) ?? REQUESTS_SERIES

  /** El máximo de todas las series juntas, para anotarlo sobre la curva que lo alcanza. */
  const peak = React.useMemo(() => {
    let best: { series: TrendSeries; index: number; value: number } | undefined
    for (const series of TREND_SERIES) {
      for (let index = 0; index < data.length; index++) {
        const value = data[index]?.[series.key] ?? 0
        if (value > (best?.value ?? 0)) best = { series, index, value }
      }
    }
    return best
  }, [data])

  // Sin datos no hay línea que leer: una rejilla vacía con la conclusión "el mes
  // de mayor actividad es Mar: 0" es peor que nada (I-03). Los hooks ya corrieron.
  if (!hasData) return null

  const lastIndex = data.length - 1
  const at = Math.min(active.activeIndex ?? lastIndex, lastIndex)
  const current = data[at]
  if (!current) return null
  const previous = at > 0 ? data[at - 1] : undefined

  const gradientId = `trend-fill-${uid}`
  const glowId = `trend-glow-${uid}`
  const hovering = active.activeIndex !== null
  // La protagonista se dibuja al final para quedar sobre las otras.
  const drawOrder = [...TREND_SERIES.filter((series) => series.key !== emphasized.key), emphasized]

  const legend: LegendEntry[] = TREND_SERIES.map((series) => ({
    key: series.key,
    label: series.label,
    color: series.color,
    value: formatQty(current[series.key]),
  }))

  return (
    <ChartFrame
      title="Tendencia Operativa"
      description="Solicitudes, órdenes y recepciones (últimos 6 meses)"
      headline={
        <>
          <ChartHeadlineValue>{formatQty(current[emphasized.key])}</ChartHeadlineValue>
          <ChartHeadlineCaption>{emphasized.noun} en {monthFullName(current.month)}</ChartHeadlineCaption>
          {previous && (
            <Delta
              value={current[emphasized.key] - previous[emphasized.key]}
              polarity="neutral"
              comparisonLabel={`vs. ${previous.month.toLowerCase()}`}
            />
          )}
        </>
      }
    >
      <ChartContainer config={trendChartConfig} className={`h-56 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="lines">
        <ComposedChart
          accessibilityLayer
          aria-label="Tendencia Operativa"
          data={data}
          margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={emphasized.color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={emphasized.color} stopOpacity={0} />
            </linearGradient>
            {spot.defs}
            <GlowFilter id={glowId} />
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tick={emphasizedTick(current.month)} />
          <ChartActiveSync labels={data.map((row) => row.month)} onIndex={active.setActiveIndex} onX={spot.setX} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} fontSize={11} domain={COUNT_DOMAIN} tickCount={5} allowDecimals={false} />
          <ChartTooltip
            {...tooltip}
            content={<TrendTooltip valueFormat="count" labelFormatter={(label) => monthTitle(String(label))} />}
          />
          {/* Sólo el relleno: el trazo lo pone la <Line> de abajo para poder darle brillo. */}
          <Area
            dataKey={emphasized.key}
            type="monotone"
            stroke="none"
            fill={`url(#${gradientId})`}
            fillOpacity={seriesOpacity(emphasized.key, focus.focusedKey)}
            mask={spot.mask}
            tooltipType="none"
            legendType="none"
            activeDot={false}
            {...motion}
          />
          {drawOrder.map((series) => {
            const isEmphasized = series.key === emphasized.key
            return (
              <Line
                key={series.key}
                dataKey={series.key}
                name={series.label}
                type="monotone"
                stroke={series.color}
                strokeWidth={isEmphasized ? 2.5 : 1.7}
                strokeLinecap="round"
                strokeOpacity={seriesOpacity(series.key, focus.focusedKey)}
                filter={isEmphasized ? `url(#${glowId})` : undefined}
                dot={lastPointDot(series.color, lastIndex, hovering, isEmphasized ? 4 : 3)}
                activeDot={activeDotFor(series.color, isEmphasized ? 5.5 : 4)}
                {...motion}
              />
            )
          })}
          {/* La anotación se esconde al apuntar: chocaría con la guía y el tooltip. */}
          {peak && !hovering && data[peak.index] && (
            <ReferenceDot
              x={data[peak.index]?.month}
              y={peak.value}
              r={3.5}
              fill={peak.series.color}
              stroke="none"
              ifOverflow="extendDomain"
              label={{
                value: `Máx. ${formatQty(peak.value)} ${peak.series.noun} · ${(data[peak.index]?.month ?? "").toLowerCase()}`,
                position: peak.index > lastIndex / 2 ? "left" : "right",
                offset: 10,
                fill: "var(--color-text)",
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de la tendencia operativa" />
    </ChartFrame>
  )
}

// ── 12. Facturado y cobrado ──────────────────────────────────────────────────

/**
 * "2026-07" → "Jul 2026". El eje mostraba la clave cruda del período, mientras
 * el resto de los gráficos del tablero rotula los meses en español (INI,
 * auditoría 2026-10-05). Una clave que no calza se deja tal cual.
 */
export function billingPeriodLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  const label = match ? MONTH_LABELS[Number(match[2]) - 1] : undefined
  return match && label ? `${label} ${match[1]}` : period
}

/** Hasta esta cantidad de períodos se dibujan columnas pareadas; sobre ella, líneas. */
const BILLING_MAX_BARS = 6

type BillingRow = { period: string; invoiced: number; collected: number }

/** "julio" o, si la ventana cruza de año, "julio de 2025". */
function periodName(label: string, withYear: boolean): string {
  const year = /\b(\d{4})\b/.exec(label)?.[1]
  return withYear && year ? `${monthFullName(label)} de ${year}` : monthFullName(label)
}

/**
 * Facturado contra cobrado, mes a mes.
 *
 * Las dos series son dinero en la misma moneda y la misma escala, así que
 * comparten eje (A5b sólo prohíbe mezclar unidades distintas). La brecha entre
 * ambas **es** la lectura: lo emitido que todavía no entra en caja.
 *
 * Con pocos períodos las columnas pareadas se leen mejor; con muchos, las líneas
 * siguen siendo legibles. Cobrado se agrupa por mes de emisión de la factura
 * (`paidAmount` de las facturas emitidas ese mes), así que "% cobrado" tiene
 * sentido período a período.
 */
export function BillingFlowChart({ data: rawData }: {
  data: Array<{ period: string; invoiced: number; collected: number }>
}) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()
  const uid = useChartUid()

  const data = React.useMemo<BillingRow[]>(
    () => rawData.map((row) => ({ ...row, period: billingPeriodLabel(row.period) })),
    [rawData],
  )
  // Todo-en-cero también se oculta: una rejilla vacía con conclusión absurda
  // ("el mayor facturado se registró en Mar: $0") es peor que nada (I-03).
  if (!data.some((row) => row.invoiced + row.collected > 0)) return null

  const asBars = data.length <= BILLING_MAX_BARS
  const lastIndex = data.length - 1
  const hovering = active.activeIndex !== null
  const focusedRow = hovering ? data[Math.min(active.activeIndex ?? 0, lastIndex)] : undefined

  const totals = data.reduce((sum, row) => ({ invoiced: sum.invoiced + row.invoiced, collected: sum.collected + row.collected }), { invoiced: 0, collected: 0 })
  const shown = focusedRow ?? totals

  const years = new Set(data.map((row) => /\b(\d{4})\b/.exec(row.period)?.[1]).filter(Boolean))
  const crossesYears = years.size > 1
  const first = data[0]
  const last = data[lastIndex]
  const windowText = !first || !last || data.length === 1
    ? `en ${periodName(first?.period ?? "", crossesYears)}`
    : `entre ${periodName(first.period, crossesYears)} y ${periodName(last.period, crossesYears)}`
  const scope = focusedRow ? `en ${periodName(focusedRow.period, crossesYears)}` : windowText

  const invoicedGradient = `billing-invoiced-${uid}`
  const collectedGradient = `billing-collected-${uid}`
  const glowId = `billing-glow-${uid}`

  const legend: LegendEntry[] = [
    { key: "invoiced", label: "Facturado", color: CHART_COLORS.neutral, swatch: asBars ? "box" : "line", value: focusedRow ? formatCompactCLP(focusedRow.invoiced) : undefined },
    { key: "collected", label: "Cobrado", color: CHART_COLORS.brand, swatch: asBars ? "box" : "line", value: focusedRow ? formatCompactCLP(focusedRow.collected) : undefined },
  ]

  return (
    <ChartFrame
      title="Facturado y cobrado"
      description="Emisión contra pagos confirmados, por mes"
      headline={
        <>
          <ChartHeadlineValue>{formatCompactCLP(shown.collected)}</ChartHeadlineValue>
          <ChartHeadlineCaption>cobrado de {formatCompactCLP(shown.invoiced)} facturado {scope}</ChartHeadlineCaption>
        </>
      }
    >
      <ChartContainer
        config={billingFlowConfig}
        className={`h-56 w-full ${SERIES_FADE_CLASS}`}
        data-chart-kind={asBars ? "bars" : "lines"}
      >
        <ComposedChart
          accessibilityLayer
          aria-label="Facturado y cobrado"
          data={data}
          margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
          barCategoryGap="28%"
          barGap={8}
        >
          <defs>
            <linearGradient id={invoicedGradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.neutral} stopOpacity={1} />
              <stop offset="100%" stopColor={CHART_COLORS.neutral} stopOpacity={0.5} />
            </linearGradient>
            <linearGradient id={collectedGradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.brand} stopOpacity={1} />
              <stop offset="100%" stopColor={CHART_COLORS.brand} stopOpacity={0.5} />
            </linearGradient>
            <GlowFilter id={glowId} />
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tick={emphasizedTick(focusedRow?.period ?? last?.period)} />
          <ChartActiveSync labels={data.map((row) => row.period)} onIndex={active.setActiveIndex} />
          <YAxis tickLine={false} axisLine={false} width={56} fontSize={11} tickFormatter={formatCompactCLP} />
          <ChartTooltip
            {...tooltip}
            cursor={asBars ? <ColumnHoverCursor /> : tooltip.cursor}
            content={
              <ChartTooltipCard
                valueFormat="clp"
                labelFormatter={(label) => monthTitle(String(label))}
                footer={(payload) => {
                  const row = payload[0]?.payload
                  const invoiced = Number(row?.invoiced)
                  const collected = Number(row?.collected)
                  if (!Number.isFinite(invoiced) || !Number.isFinite(collected)) return null
                  if (invoiced <= 0) return "Sin facturación en el mes"
                  return `${formatPercent((collected / invoiced) * 100)} de lo facturado está cobrado`
                }}
              />
            }
          />
          {asBars ? (
            <>
              <Bar
                dataKey="invoiced"
                name="Facturado"
                fill={`url(#${invoicedGradient})`}
                radius={[6, 6, 0, 0]}
                maxBarSize={44}
                minPointSize={3}
                shape={dimmedBarShape("invoiced", active.activeIndex, focus.focusedKey)}
                {...motion}
              />
              <Bar
                dataKey="collected"
                name="Cobrado"
                fill={`url(#${collectedGradient})`}
                radius={[6, 6, 0, 0]}
                maxBarSize={44}
                minPointSize={3}
                shape={dimmedBarShape("collected", active.activeIndex, focus.focusedKey)}
                {...motion}
              />
            </>
          ) : (
            <>
              <Line
                dataKey="invoiced"
                name="Facturado"
                type="monotone"
                stroke={CHART_COLORS.neutral}
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeOpacity={seriesOpacity("invoiced", focus.focusedKey)}
                dot={lastPointDot(CHART_COLORS.neutral, lastIndex, hovering, 3)}
                activeDot={activeDotFor(CHART_COLORS.neutral, 4)}
                {...motion}
              />
              <Line
                dataKey="collected"
                name="Cobrado"
                type="monotone"
                stroke={CHART_COLORS.brand}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeOpacity={seriesOpacity("collected", focus.focusedKey)}
                filter={`url(#${glowId})`}
                dot={lastPointDot(CHART_COLORS.brand, lastIndex, hovering, 4)}
                activeDot={activeDotFor(CHART_COLORS.brand, 5.5)}
                {...motion}
              />
            </>
          )}
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de facturado y cobrado" />
    </ChartFrame>
  )
}
