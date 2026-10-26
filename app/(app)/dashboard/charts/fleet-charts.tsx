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
} from "@/components/ui/chart-interactions"
import { formatCompactCLP, formatCompactQty } from "@/lib/utils"
import { CHART_COLORS } from "@/lib/chart-palette"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "./chart-frame"
import {
  COUNT_DOMAIN,
  InteractiveLegend,
  MixedUnitsTooltipCard,
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

const maintenanceChartConfig = {
  completed: {
    label: "Completadas",
    color: CHART_COLORS.brand,
  },
  scheduled: {
    label: "Programadas",
    color: CHART_COLORS.blue,
  },
  amount: {
    label: "Costo",
    color: CHART_COLORS.violet,
  },
} satisfies ChartConfig

/** El punto del costo: relleno de superficie para que se lea sobre las columnas. */
const COST_DOT = { r: 3, fill: SURFACE, strokeWidth: 2 } as const

// ── 7. Fuel Consumption Chart ────────────────────────────────────────────────

export interface FuelMonthlyChartPoint {
  month: string
  liters: number
  amount: number | null
  loads: number
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

  if (!data.length || !data.some((d) => d.liters > 0 || (showCosts && (d.amount ?? 0) > 0))) return null

  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const liters = at ? at.liters : data.reduce((sum, point) => sum + point.liters, 0)
  const legend: LegendEntry[] = [
    { key: "liters", label: "Litros", color: CHART_COLORS.signal, swatch: "box", value: at ? formatChartValue(at.liters, "liters") : undefined },
    ...(showCosts
      ? [{ key: "amount", label: "Costo", color: CHART_COLORS.brand, value: at ? (at.amount == null ? "—" : formatCompactCLP(at.amount)) : undefined } satisfies LegendEntry]
      : []),
  ]

  return (
    <ChartFrame
      title="Consumo de Combustibles"
      description={`${showCosts ? "Litros cargados y costo por mes" : "Litros cargados por mes"}${periodLabel ? ` · ${periodLabel}` : ""}`}
      headline={
        <>
          <ChartHeadlineValue>{liters.toLocaleString("es-CL", { maximumFractionDigits: 0 })}</ChartHeadlineValue>
          <ChartHeadlineCaption>litros cargados en {at ? monthFullName(at.month) : "el período"}</ChartHeadlineCaption>
        </>
      }
    >
      <ChartContainer config={fuelChartConfig} className={`h-52 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="bars">
        <ComposedChart
          accessibilityLayer
          aria-label="Consumo de Combustibles"
          data={data}
          margin={{ top: 12, right: 0, left: 0, bottom: 0 }}
          onMouseMove={active.onMouseMove}
          onMouseLeave={active.onMouseLeave}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tick={emphasizedTick(at?.month)} />
          <YAxis yAxisId="liters" tickLine={false} axisLine={false} tickMargin={8} width={40} fontSize={11} tickFormatter={formatCompactQty} />
          {showCosts && <YAxis yAxisId="amount" orientation="right" tickLine={false} axisLine={false} tickMargin={4} width={52} fontSize={11} tickFormatter={formatCompactCLP} />}
          <ChartTooltip
            {...tooltip}
            cursor={<ColumnHoverCursor />}
            content={
              <MixedUnitsTooltipCard
                formats={{ liters: "liters", amount: "clp" }}
                labelFormatter={(label) => monthTitle(String(label))}
                footer={(payload) => {
                  const loads = payload[0]?.payload?.loads
                  return typeof loads === "number" ? `${loads.toLocaleString("es-CL")} ${loads === 1 ? "carga" : "cargas"}` : null
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

// ── 8. Maintenance Activity Chart ─────────────────────────────────────────────

export interface MaintenanceMonthlyChartPoint {
  month: string
  completed: number
  scheduled: number
  amount: number | null
}

/**
 * Conteos en barras (eje izquierdo) y costo en línea (eje derecho). El `amount`
 * ya lo calculaba `getMaintenanceMonthlyTrend` y se descartaba; sin él la
 * tarjeta contaba mantenciones sin decir lo que costaron.
 *
 * La cifra grande son las mantenciones completadas del período (o del mes
 * apuntado): es el conteo que responde "¿se está cumpliendo el plan?".
 */
export function MaintenanceTrendChart({ data, showCosts = true, periodLabel }: { data: MaintenanceMonthlyChartPoint[]; showCosts?: boolean; periodLabel?: string }) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  if (!data.length || !data.some((d) => d.completed > 0 || d.scheduled > 0 || (showCosts && (d.amount ?? 0) > 0))) return null

  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const completed = at ? at.completed : data.reduce((sum, point) => sum + point.completed, 0)
  const legend: LegendEntry[] = [
    { key: "completed", label: "Completadas", color: CHART_COLORS.brand, swatch: "box", value: at ? at.completed.toLocaleString("es-CL") : undefined },
    { key: "scheduled", label: "Programadas", color: CHART_COLORS.blue, swatch: "box", value: at ? at.scheduled.toLocaleString("es-CL") : undefined },
    ...(showCosts
      ? [{ key: "amount", label: "Costo", color: CHART_COLORS.violet, value: at ? (at.amount == null ? "—" : formatCompactCLP(at.amount)) : undefined } satisfies LegendEntry]
      : []),
  ]

  return (
    <ChartFrame
      title="Mantención de Flota"
      description={`${showCosts ? "Completadas vs. programadas y costo por mes" : "Completadas vs. programadas por mes"}${periodLabel ? ` · ${periodLabel}` : ""}`}
      headline={
        <>
          <ChartHeadlineValue>{completed.toLocaleString("es-CL")}</ChartHeadlineValue>
          <ChartHeadlineCaption>
            {completed === 1 ? "mantención completada" : "mantenciones completadas"} en {at ? monthFullName(at.month) : "el período"}
          </ChartHeadlineCaption>
        </>
      }
    >
      {/* Era el único gráfico del tablero sin lectura equivalente (I-15). */}
      <ChartContainer config={maintenanceChartConfig} className={`h-52 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="bars">
        <ComposedChart
          accessibilityLayer
          aria-label="Mantención de Flota"
          data={data}
          margin={{ top: 12, right: 0, left: 0, bottom: 0 }}
          onMouseMove={active.onMouseMove}
          onMouseLeave={active.onMouseLeave}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tick={emphasizedTick(at?.month)} />
          <YAxis yAxisId="count" tickLine={false} axisLine={false} tickMargin={8} width={32} fontSize={11} domain={COUNT_DOMAIN} tickCount={5} allowDecimals={false} />
          {showCosts && <YAxis yAxisId="amount" orientation="right" tickLine={false} axisLine={false} tickMargin={4} width={52} fontSize={11} tickFormatter={formatCompactCLP} />}
          <ChartTooltip
            {...tooltip}
            cursor={<ColumnHoverCursor />}
            content={
              <MixedUnitsTooltipCard
                formats={{ completed: "count", scheduled: "count", amount: "clp" }}
                labelFormatter={(label) => monthTitle(String(label))}
              />
            }
          />
          <Bar yAxisId="count" dataKey="completed" name="Completadas" fill={CHART_COLORS.brand} radius={[4, 4, 0, 0]} maxBarSize={36} shape={dimmedBarShape("completed", active.activeIndex, focus.focusedKey)} {...motion} />
          <Bar yAxisId="count" dataKey="scheduled" name="Programadas" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} maxBarSize={36} shape={dimmedBarShape("scheduled", active.activeIndex, focus.focusedKey)} {...motion} />
          {showCosts && (
            <Line
              yAxisId="amount"
              type="monotone"
              dataKey="amount"
              name="Costo"
              stroke={CHART_COLORS.violet}
              strokeWidth={2}
              strokeLinecap="round"
              strokeOpacity={seriesOpacity("amount", focus.focusedKey)}
              dot={COST_DOT}
              activeDot={activeDotFor(CHART_COLORS.violet)}
              {...motion}
            />
          )}
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de la mantención de flota" />
    </ChartFrame>
  )
}
