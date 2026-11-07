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
  partialTailLineShape,
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
  /**
   * El mes en curso (aún no termina): sus litros y su costo valen sólo los días transcurridos.
   * Se dibuja tenue/punteado y se dice «parcial» en la descripción y el tooltip, como en
   * Analítica, para que no se lea como una caída del consumo.
   */
  partial?: boolean
}

/** Índice del primer mes parcial —los parciales son los últimos de la serie— o `-1` si no hay. */
function firstPartialIndex(data: FuelMonthlyChartPoint[]): number {
  return data.findIndex((point) => point.partial === true)
}

/** Encabezado del tooltip: «Noviembre (parcial)». Igual que el de Analítica. */
export function fuelTooltipTitle(label: unknown, data: FuelMonthlyChartPoint[]): string {
  const month = String(label)
  const title = monthTitle(month)
  return data.find((point) => point.month === month)?.partial === true ? `${title} (parcial)` : title
}

/** Pie de la cifra grande de litros: el mes apuntado (con su aviso de parcial o de falta de datos) o el período. */
export function fuelHeadlineCaption(at: FuelMonthlyChartPoint | undefined): string {
  if (!at) return "litros cargados en el período"
  const name = monthFullName(at.month)
  if (at.providerGap === true) return `sin datos del proveedor en ${name}`
  return at.partial === true ? `litros cargados en ${name} (parcial)` : `litros cargados en ${name}`
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
  const liters = at ? at.liters : data.reduce((sum, point) => sum + (point.liters ?? 0), 0)
  const partialFrom = firstPartialIndex(data)
  const legend: LegendEntry[] = [
    { key: "liters", label: "Litros", color: CHART_COLORS.signal, swatch: "box", value: at ? (at.liters == null ? "—" : formatChartValue(at.liters, "liters")) : undefined },
    ...(showCosts
      ? [{ key: "amount", label: "Costo", color: CHART_COLORS.brand, value: at ? (at.amount == null ? "—" : formatCompactCLP(at.amount)) : undefined } satisfies LegendEntry]
      : []),
  ]

  return (
    <ChartFrame
      title="Consumo de combustibles"
      description={`${showCosts ? "Litros cargados y costo por mes" : "Litros cargados por mes"}${periodLabel ? ` · ${periodLabel}` : ""}${partialFrom >= 0 ? " · el último mes es parcial" : ""}`}
      headline={
        <>
          <ChartHeadlineValue>{liters == null ? "—" : formatQty(liters, undefined, { maximumFractionDigits: 0 })}</ChartHeadlineValue>
          <ChartHeadlineCaption>{fuelHeadlineCaption(at)}</ChartHeadlineCaption>
        </>
      }
    >
      <ChartContainer config={fuelChartConfig} className={`h-52 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="bars">
        <ComposedChart
          accessibilityLayer
          aria-label="Consumo de combustibles"
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
                labelFormatter={(label) => fuelTooltipTitle(label, data)}
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
            shape={dimmedBarShape("liters", active.activeIndex, focus.focusedKey, partialFrom)}
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
              shape={partialTailLineShape(partialFrom)}
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
