"use client"

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
  ColumnHoverCursor,
  formatChartValue,
  seriesOpacity,
  useActiveIndex,
  useChartMotion,
  useTooltipProps,
  ChartActiveSync,
  ChartTooltipCard,
} from "@/components/ui/chart-interactions"
import { countOf, formatCompactCLP, formatCompactQty, formatQty } from "@/lib/utils"
import { CHART_COLORS } from "@/lib/chart-palette"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "./chart-frame"
import {
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

const fuelChartConfig = {
  liters: {
    label: "Litros",
    color: CHART_COLORS.signal,
  },
  amount: {
    label: "Costo",
    color: CHART_COLORS.brand,
  },
  loads: {
    label: "Cargas",
    color: CHART_COLORS.teal,
  },
} satisfies ChartConfig

/** El punto del costo: relleno de superficie para que se lea sobre las columnas. */
const COST_DOT = { r: 3, fill: SURFACE, strokeWidth: 2 } as const

// ── 7. Fuel Consumption Chart ────────────────────────────────────────────────

export interface FuelMonthlyChartPoint {
  month: string
  /** `null` en un mes sin datos del proveedor (`providerGap`): un hueco, no un cero. */
  liters: number | null
  amount: number | null
  loads: number | null
  /** El proveedor no tiene datos del mes (C-4): sin barra ni punto, y se dice en la descripción y el tooltip. */
  providerGap?: boolean
}

/** «septiembre» o «agosto y septiembre»: los meses sin datos del proveedor, para el texto del gráfico. */
function gapMonthsText(data: FuelMonthlyChartPoint[]): string | null {
  const names = data.filter((point) => point.providerGap).map((point) => monthFullName(point.month))
  if (names.length === 0) return null
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
}

/**
 * Litros (barra, eje izquierdo) y costo (línea, eje derecho).
 *
 * Antes eran dos barras —litros y cargas— **en el mismo eje Y**: litros va en
 * miles y cargas en decenas, así que la serie "Cargas" quedaba pegada al piso e
 * ilegible. Y el costo, que es lo que gerencia mira, se consultaba en
 * `getFuelMonthlyTrend` y se descartaba.
 *
 * Las cargas no tienen eje ni serie: van como pie del tooltip, donde una cifra de
 * apoyo no compite por escala con nada. La cifra grande es el total de litros del
 * período, o el del mes apuntado (litros y no costo: una sola unidad por cabecera).
 */
export function FuelConsumptionChart({ data, showCosts = true, periodLabel }: { data: FuelMonthlyChartPoint[]; showCosts?: boolean; periodLabel?: string }) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  if (!data.length || !data.some((d) => (d.liters ?? 0) > 0 || (showCosts && (d.amount ?? 0) > 0))) return null

  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  // Un mes sin datos del proveedor no es «0 litros»: la cifra grande dice «—» y la leyenda también.
  const atGap = at?.providerGap === true
  const liters = at ? at.liters : data.reduce((sum, point) => sum + (point.liters ?? 0), 0)
  const gaps = gapMonthsText(data)
  const legend: LegendEntry[] = [
    { key: "liters", label: "Litros", color: CHART_COLORS.signal, swatch: "box", value: at ? (at.liters == null ? "—" : formatChartValue(at.liters, "liters")) : undefined },
    ...(showCosts
      ? [{ key: "amount", label: "Costo", color: CHART_COLORS.brand, value: at ? (at.amount == null ? "—" : formatCompactCLP(at.amount)) : undefined } satisfies LegendEntry]
      : []),
  ]

  return (
    <ChartFrame
      title="Consumo de Combustibles"
      description={`${showCosts ? "Litros cargados y costo por mes" : "Litros cargados por mes"}${periodLabel ? ` · ${periodLabel}` : ""}${gaps ? ` · sin datos del proveedor en ${gaps}` : ""}`}
      headline={
        <>
          <ChartHeadlineValue>{liters == null ? "—" : formatQty(liters, undefined, { maximumFractionDigits: 0 })}</ChartHeadlineValue>
          <ChartHeadlineCaption>{atGap ? `sin datos del proveedor en ${monthFullName(at!.month)}` : `litros cargados en ${at ? monthFullName(at.month) : "el período"}`}</ChartHeadlineCaption>
        </>
      }
    >
      <ChartContainer config={fuelChartConfig} className={`h-52 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="bars">
        <ComposedChart
          accessibilityLayer
          aria-label="Consumo de Combustibles"
          data={data}
          margin={{ top: 12, right: 0, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tick={emphasizedTick(at?.month)} />
          <ChartActiveSync labels={data.map((row) => row.month)} onIndex={active.setActiveIndex} />
          <YAxis yAxisId="liters" tickLine={false} axisLine={false} tickMargin={8} width={40} fontSize={11} tickFormatter={formatCompactQty} />
          {showCosts && <YAxis yAxisId="amount" orientation="right" tickLine={false} axisLine={false} tickMargin={4} width={52} fontSize={11} tickFormatter={formatCompactCLP} />}
          {/* `filterNull={false}`: recharts omite las series nulas, y un mes sin datos del proveedor se quedaría sin tooltip. */}
          <ChartTooltip
            {...tooltip}
            filterNull={false}
            cursor={<ColumnHoverCursor />}
            content={
              <ChartTooltipCard
                formats={{ liters: "liters", amount: "clp" }}
                labelFormatter={(label) => monthTitle(String(label))}
                footer={(payload) => {
                  if (payload[0]?.payload?.providerGap === true) return "Sin datos del proveedor este mes"
                  const loads = payload[0]?.payload?.loads
                  return typeof loads === "number" ? countOf(loads, "carga") : null
                }}
              />
            }
          />
          <Bar
            yAxisId="liters"
            dataKey="liters"
            name="Litros"
            fill={CHART_COLORS.signal}
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
            shape={dimmedBarShape("liters", active.activeIndex, focus.focusedKey)}
            {...motion}
          />
          {showCosts && (
            <Line
              yAxisId="amount"
              type="monotone"
              dataKey="amount"
              name="Costo"
              stroke={CHART_COLORS.brand}
              strokeWidth={2}
              strokeLinecap="round"
              strokeOpacity={seriesOpacity("amount", focus.focusedKey)}
              dot={COST_DOT}
              activeDot={activeDotFor(CHART_COLORS.brand)}
              {...motion}
            />
          )}
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series del consumo de combustibles" />
    </ChartFrame>
  )
}
