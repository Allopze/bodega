"use client"

import * as React from "react"
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart"
import {
  ChartActiveSync,
  ChartTooltipCard,
  ColumnHoverCursor,
  GlowFilter,
  seriesOpacity,
  useActiveIndex,
  useChartMotion,
  useTooltipProps,
} from "@/components/ui/chart-interactions"
import { formatMoney } from "@/lib/services/billing/money"
import { billingPeriodLabel } from "@/lib/services/billing/summary-charts"
import { CHART_COLORS } from "@/lib/chart-palette"
import { formatCompactCLP, formatPercent } from "@/lib/utils"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "./chart-frame"
import {
  InteractiveLegend,
  SERIES_FADE_CLASS,
  activeDotFor,
  dimmedBarShape,
  emphasizedTick,
  lastPointDot,
  monthFullName,
  monthTitle,
  partialTailLineShape,
  useChartUid,
  useSeriesFocus,
  type LegendEntry,
} from "./chart-parts"

/**
 * Facturado contra cobrado, mes a mes.
 *
 * Vive en `components/charts/` desde CHART-036: lo usan el tablero (Finanzas) y
 * `/facturacion`, y no debe depender de la ruta de ninguno. `variant` elige
 * quién pone el marco: en el tablero (`framed`, el defecto) es un `ChartFrame`
 * con titular que sigue al mes apuntado; en una pantalla de módulo (`plain`) lo
 * pone `ChartSection` —título, frase, «Ver datos»— y acá quedan el trazado y la
 * leyenda.
 *
 * **Una sola moneda por gráfico.** Facturado y cobrado son dinero en la misma
 * moneda y la misma escala, así que comparten eje (A5b sólo prohíbe mezclar
 * unidades distintas); quien llama separa por moneda y dibuja uno por cada una,
 * porque 1.000 USD en el mismo eje que 900.000 CLP no se leería.
 */

/** "julio" o, si la ventana cruza de año, "julio de 2025". */
function periodName(label: string, withYear: boolean): string {
  const year = /\b(\d{4})\b/.exec(label)?.[1]
  return withYear && year ? `${monthFullName(label)} de ${year}` : monthFullName(label)
}

const billingFlowConfig = {
  invoiced: { label: "Facturado", color: CHART_COLORS.neutral },
  collected: { label: "Cobrado", color: CHART_COLORS.brand },
} satisfies ChartConfig

/** Hasta esta cantidad de períodos se dibujan columnas pareadas; sobre ella, líneas. */
const BILLING_MAX_BARS = 6

/** Eje de una moneda que no es CLP: `formatCompactCLP` pondría un signo de peso que no corresponde. */
const COMPACT_NUMBER = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 })

type BillingRow = { period: string; invoiced: number; collected: number }

export interface BillingFlowChartProps {
  data: Array<{ period: string; invoiced: number; collected: number }>
  /** ISO-4217 de las dos series. CLP se compacta ($2.489M); otra moneda va completa. */
  currency?: string
  /** `framed`: `ChartFrame` con titular (tablero). `plain`: sólo trazado y leyenda. */
  variant?: "framed" | "plain"
  /**
   * Período (`YYYY-MM`) que aún no termina. Se dibuja como estimación —columna
   * tenue con contorno punteado, tramo final punteado— y no como una caída.
   */
  partialPeriod?: string
}

/**
 * Cobrado se agrupa por mes de emisión de la factura (`paidAmount` de las
 * facturas emitidas ese mes), así que "% cobrado" tiene sentido período a
 * período. Con pocos períodos las columnas pareadas se leen mejor; con muchos,
 * las líneas siguen siendo legibles. La brecha entre ambas **es** la lectura: lo
 * emitido que todavía no entra en caja.
 */
export function BillingFlowChart({ data: rawData, currency = "CLP", variant = "framed", partialPeriod }: BillingFlowChartProps) {
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

  const isClp = currency === "CLP"
  const compact = isClp ? formatCompactCLP : (amount: number) => formatMoney(amount, currency)
  const axisTick = isClp ? formatCompactCLP : (amount: number) => COMPACT_NUMBER.format(amount)

  const asBars = data.length <= BILLING_MAX_BARS
  const lastIndex = data.length - 1
  const hovering = active.activeIndex !== null
  const focusedRow = hovering ? data[Math.min(active.activeIndex ?? 0, lastIndex)] : undefined
  const partialFrom = partialPeriod ? rawData.findIndex((row) => row.period === partialPeriod) : -1
  const isPartialLabel = (label: unknown) => partialFrom >= 0 && data.findIndex((row) => row.period === label) >= partialFrom

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
  const chartLabel = `Facturado y cobrado${isClp ? "" : ` en ${currency}`}`

  const legend: LegendEntry[] = [
    { key: "invoiced", label: "Facturado", color: CHART_COLORS.neutral, swatch: asBars ? "box" : "line", value: focusedRow ? compact(focusedRow.invoiced) : undefined },
    { key: "collected", label: "Cobrado", color: CHART_COLORS.brand, swatch: asBars ? "box" : "line", value: focusedRow ? compact(focusedRow.collected) : undefined },
  ]

  const body = (
    <>
      <ChartContainer
        config={billingFlowConfig}
        className={`h-56 w-full ${SERIES_FADE_CLASS}`}
        data-chart-kind={asBars ? "bars" : "lines"}
      >
        <ComposedChart
          accessibilityLayer
          aria-label={chartLabel}
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
          <YAxis tickLine={false} axisLine={false} width={56} fontSize={11} tickFormatter={axisTick} />
          <ChartTooltip
            {...tooltip}
            cursor={asBars ? <ColumnHoverCursor /> : tooltip.cursor}
            content={
              <ChartTooltipCard
                // `ChartTooltipCard` sólo sabe de pesos: en otra moneda va el número
                // y la moneda se dice en el pie, no un «$» que no corresponde.
                valueFormat={isClp ? "clp" : "count"}
                labelFormatter={(label) => `${monthTitle(String(label))}${isPartialLabel(label) ? " (parcial)" : ""}`}
                footer={(payload) => {
                  const row = payload[0]?.payload
                  const invoiced = Number(row?.invoiced)
                  const collected = Number(row?.collected)
                  if (!Number.isFinite(invoiced) || !Number.isFinite(collected)) return null
                  const currencyNote = isClp ? "" : `Montos en ${currency}. `
                  if (invoiced <= 0) return `${currencyNote}Sin facturación en el mes`
                  return `${currencyNote}${formatPercent((collected / invoiced) * 100)} de lo facturado está cobrado`
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
                shape={dimmedBarShape("invoiced", active.activeIndex, focus.focusedKey, partialFrom)}
                {...motion}
              />
              <Bar
                dataKey="collected"
                name="Cobrado"
                fill={`url(#${collectedGradient})`}
                radius={[6, 6, 0, 0]}
                maxBarSize={44}
                minPointSize={3}
                shape={dimmedBarShape("collected", active.activeIndex, focus.focusedKey, partialFrom)}
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
                {...(partialFrom >= 0 ? { shape: partialTailLineShape(partialFrom) } : {})}
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
                {...(partialFrom >= 0 ? { shape: partialTailLineShape(partialFrom) } : {})}
                {...motion}
              />
            </>
          )}
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de facturado y cobrado" />
    </>
  )

  if (variant === "plain") return body

  return (
    <ChartFrame
      title="Facturado y cobrado"
      description="Emisión contra pagos confirmados, por mes"
      headline={
        <>
          <ChartHeadlineValue>{compact(shown.collected)}</ChartHeadlineValue>
          <ChartHeadlineCaption>cobrado de {compact(shown.invoiced)} facturado {scope}</ChartHeadlineCaption>
        </>
      }
    >
      {body}
    </ChartFrame>
  )
}
