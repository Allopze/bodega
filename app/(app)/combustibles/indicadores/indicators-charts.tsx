"use client"

import type { ReactNode } from "react"
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import {
  ChartActiveSync,
  ChartTooltipCard,
  ColumnHoverCursor,
  formatChartValue,
  seriesOpacity,
  useActiveIndex,
  useChartMotion,
  useTooltipProps,
} from "@/components/ui/chart-interactions"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
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
} from "@/components/charts/chart-parts"
import { CHART_COLORS } from "@/lib/chart-palette"
import type { LitersCostPoint } from "@/lib/combustibles/indicators/view"
import { countOf, formatCompactCLP, formatCompactQty, formatQty } from "@/lib/utils"

const config = {
  liters: { label: "Litros", color: CHART_COLORS.signal },
  amount: { label: "Costo", color: CHART_COLORS.brand },
} satisfies ChartConfig

/** El punto del costo: relleno de superficie para que se lea sobre las columnas. */
const COST_DOT = { r: 3, fill: SURFACE, strokeWidth: 2 } as const

/** Índice del primer mes parcial —los parciales son los últimos de la serie— o `-1` si no hay. */
const firstPartialIndex = (data: readonly LitersCostPoint[]) => data.findIndex((point) => point.partial)

function tooltipTitle(label: unknown, data: readonly LitersCostPoint[]): string {
  const month = String(label)
  const title = monthTitle(month)
  return data.find((point) => point.month === month)?.partial ? `${title} (parcial)` : title
}

function headlineCaption(at: LitersCostPoint | undefined, windowLabel: string): string {
  if (!at) return `litros en la ventana · ${windowLabel.toLowerCase()}`
  const name = monthFullName(at.month)
  if (at.providerGap) return `sin datos del proveedor en ${name}`
  return at.partial ? `litros cargados en ${name} (parcial)` : `litros cargados en ${name}`
}

/**
 * Litros (columna, eje izquierdo) y costo (línea, eje derecho) por mes, del libro del
 * proveedor. Litros y pesos tienen escalas distintas, así que no comparten eje (A5b); sin
 * `combustibles:view_costs` no hay línea ni eje de costo. Las cargas no tienen serie: van de
 * pie en el tooltip. La cifra grande es el total de litros de la ventana o el del mes
 * apuntado: una sola unidad por cabecera.
 *
 * Es la serie del tablero de Inicio (`FuelConsumptionChart`) con otra ventana; vive aquí
 * porque las pantallas no importan de `app/(app)/dashboard/**`.
 */
export function LitersCostChart({ data, showCosts, windowLabel, footer }: { data: LitersCostPoint[]; showCosts: boolean; windowLabel: string; footer?: ReactNode }) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  if (!data.some((point) => (point.liters ?? 0) > 0 || (showCosts && (point.amount ?? 0) > 0))) return null

  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
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
      title={showCosts ? "Litros y costo por mes" : "Litros por mes"}
      description={`${windowLabel} · libro de Copec (tarjetas y estanques)${partialFrom >= 0 ? " · el último mes es parcial" : ""}`}
      headline={
        <>
          <ChartHeadlineValue>{liters == null ? "—" : formatQty(liters, undefined, { maximumFractionDigits: 0 })}</ChartHeadlineValue>
          <ChartHeadlineCaption>{headlineCaption(at, windowLabel)}</ChartHeadlineCaption>
        </>
      }
    >
      <ChartContainer config={config} className={`h-56 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="bars">
        <ComposedChart
          accessibilityLayer
          aria-label={showCosts ? "Litros y costo de combustible por mes" : "Litros de combustible por mes"}
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
                labelFormatter={(label) => tooltipTitle(label, data)}
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
      <InteractiveLegend entries={legend} focus={focus} label="Series de litros y costo de combustible" />
      {footer}
    </ChartFrame>
  )
}
