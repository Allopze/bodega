"use client"
import { useRouter } from "next/navigation"
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { DenseChart } from "@/components/charts/dense-chart"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { RankedList } from "@/components/ui/ranked-list"
import { useChartMotion } from "@/components/ui/chart-interactions"
import type { SpendByMonthRow } from "@/lib/services/analytics"
import { formatCLP, formatCompactCLP, formatPercent, pluralize } from "@/lib/utils"
import { CHART_COLORS, CHART_SERIES, chartTooltipStyle } from "@/lib/chart-palette"
import { areaChartRows, formatTrendMonth, formatTrendMonthShort, fuelGapMonthKeys, isIsolatedPoint, trendTooltipEntry } from "./analytics-trend"
import { paretoYAxisTicks, type ParetoRow } from "./analytics-pareto"

/*
 * Todo el color sale de `lib/chart-palette.ts` (tokens, nunca hex). Compras y combustible son dos
 * categorías sin semántica de alerta: las dos primeras de la serie, que son vecinas y se distinguen
 * por matiz (esmeralda contra azul tinta). La referencia (umbral, «Otros proveedores») va en gris.
 */
const PURCHASING_COLOR = CHART_SERIES[0]
const FUEL_COLOR = CHART_SERIES[1]
const REFERENCE_COLOR = CHART_COLORS.neutral
/** El acumulado del Pareto: pizarra oscura, para no repetir el azul que en esta pantalla es «combustible». */
const CUMULATIVE_COLOR = CHART_SERIES[5]

const AXIS_TICK = { fill: "var(--color-text-muted)", fontSize: 11 }

/** Punto de una serie con huecos: sólo donde no habría trazo (un valor entre dos huecos); el resto ya se ve en el borde. */
function isolatedDot(values: Array<number | null>, color: string) {
  function IsolatedDot({ cx, cy, index }: { cx?: number; cy?: number; index?: number }) {
    if (cx === undefined || cy === undefined || index === undefined || !isIsolatedPoint(values, index)) return <g />
    return <circle cx={cx} cy={cy} r={3.5} fill={color} />
  }
  return IsolatedDot
}

/** Marca de la leyenda: un cuadrado de color, o una guía punteada para lo que no es una serie. */
function LegendSwatch({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return dashed
    ? <span aria-hidden className="inline-block h-3 w-0 border-l-2 border-dashed" style={{ borderColor: color }} />
    : <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: color }} />
}

/**
 * Gasto mensual como áreas apiladas de compras y combustible (CHART-033). Sin una serie «Total»: es
 * la suma de las dos capas, y dibujarla repetía la cifra. La leyenda va debajo y nombra cada capa.
 *
 * Reglas de honestidad (DESIGN.md § Gráficos):
 * - un mes **sin datos del proveedor** de combustible corta la capa de combustible (no baja a
 *   cero) y lleva una guía punteada vertical; el hueco se nombra en la leyenda y en el tooltip;
 * - el **mes parcial** lleva un asterisco en el eje y «(parcial)» en el tooltip: sus pocos días
 *   no se leen como una caída;
 * - sin permiso de costos de combustible no existe la capa (`showFuel`).
 */
export function MonthlySpendChart({ data, showFuel }: { data: SpendByMonthRow[]; showFuel: boolean }) {
  const motion = useChartMotion()
  const rows = areaChartRows(data, showFuel)
  const gapMonths = showFuel ? fuelGapMonthKeys(data) : []
  const partialMonths = new Set(data.filter((row) => row.partial).map((row) => row.month))
  const config = {
    purchasingAmount: { label: "Compras", color: PURCHASING_COLOR },
    fuelAmount: { label: "Combustible", color: FUEL_COLOR },
  } satisfies ChartConfig

  return (
    <>
      <ChartContainer config={config} className="aspect-auto h-72 w-full">
        <AreaChart accessibilityLayer aria-label="Gasto mensual en compras y combustible, áreas apiladas" data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={8}
            tick={AXIS_TICK}
            tickFormatter={(month: string) => `${formatTrendMonthShort(month)}${partialMonths.has(month) ? "*" : ""}`}
          />
          <YAxis tickLine={false} axisLine={false} width={58} tick={AXIS_TICK} tickFormatter={formatCompactCLP} />
          {/* `filterNull={false}`: recharts omite del tooltip las series nulas, y el mes sin datos del proveedor perdería su aviso. */}
          <Tooltip
            contentStyle={chartTooltipStyle()}
            filterNull={false}
            labelFormatter={(label) => {
              const month = String(label)
              return partialMonths.has(month) ? `${formatTrendMonth(month)} (parcial)` : formatTrendMonth(month)
            }}
            formatter={(value, name) => trendTooltipEntry(String(name), value == null ? null : Number(value), formatCLP)}
          />
          {gapMonths.map((month) => (
            <ReferenceLine key={month} x={month} stroke={REFERENCE_COLOR} strokeDasharray="4 3" />
          ))}
          <Area
            type="monotone"
            dataKey="purchasingAmount"
            name="Compras"
            stackId="gasto"
            stroke={PURCHASING_COLOR}
            strokeWidth={1.5}
            fill={PURCHASING_COLOR}
            fillOpacity={0.7}
            {...motion}
          />
          {showFuel && (
            <Area
              type="monotone"
              dataKey="fuelAmount"
              name="Combustible"
              stackId="gasto"
              stroke={FUEL_COLOR}
              strokeWidth={1.5}
              fill={FUEL_COLOR}
              fillOpacity={0.7}
              dot={isolatedDot(rows.map((row) => row.fuelAmount), FUEL_COLOR)}
              {...motion}
            />
          )}
        </AreaChart>
      </ChartContainer>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <li className="inline-flex items-center gap-1.5"><LegendSwatch color={PURCHASING_COLOR} />Compras</li>
        {showFuel && <li className="inline-flex items-center gap-1.5"><LegendSwatch color={FUEL_COLOR} />Combustible</li>}
        {gapMonths.length > 0 && <li className="inline-flex items-center gap-1.5"><LegendSwatch color={REFERENCE_COLOR} dashed />Mes sin datos del proveedor de combustible</li>}
        {partialMonths.size > 0 && <li>* Mes parcial</li>}
      </ul>
    </>
  )
}

export interface ParetoChartRow extends ParetoRow {
  /** Lista que explica la barra (OC del proveedor); ausente si el usuario no puede abrirla. */
  href?: string
}

/** El nombre del proveedor en el eje: lo que cabe; el completo va en el tooltip y en «Ver datos». */
function shortenLabel(label: string, max = 14): string {
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label
}

function ParetoTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ParetoChartRow }> }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  const detail = row.isOther
    ? "Todos los demás proveedores y el gasto sin proveedor identificado"
    : `${row.module ?? "Compras"} · ${row.count} ${row.module === "Combustible" ? pluralize(row.count, "carga") : "OC"}`
  return (
    <div style={chartTooltipStyle()} className="max-w-64 px-3 py-2">
      <p className="font-semibold">{row.label}</p>
      <p className="text-xs text-[var(--color-text-muted)]">{detail}</p>
      <p className="mt-1.5 tabular-nums">Gasto: <strong>{formatCLP(row.amount)}</strong> ({formatPercent(row.sharePct, 1)})</p>
      <p className="tabular-nums">Acumulado: <strong>{formatPercent(row.cumulativePct, 1)}</strong></p>
    </div>
  )
}

/**
 * Pareto de proveedores (CHART-033): barras de un tono con el gasto de cada proveedor, de mayor a
 * menor, y una línea con el % acumulado del gasto total. «Otros proveedores» va al final en gris
 * (no es un proveedor) y el umbral de concentración de la alerta es una guía punteada en el eje de
 * porcentaje. Dos unidades, dos ejes (A5b): pesos a la izquierda, % acumulado a la derecha.
 *
 * El clic en una barra abre la lista de OC del proveedor, pero es sólo una comodidad del puntero:
 * el camino por teclado y por lector de pantalla son los enlaces de «Ver datos».
 *
 * Bajo 360 px las etiquetas en diagonal de diez barras no se leen: `DenseChart` las reemplaza
 * por el gasto de cada proveedor como `RankedList` (mismo orden, con su enlace a las OC); el
 * % acumulado sigue en «Ver datos».
 */
export function SupplierParetoChart({ rows, thresholdPct }: { rows: ParetoChartRow[]; thresholdPct: number }) {
  const motion = useChartMotion()
  const router = useRouter()
  const config = {
    amount: { label: "Gasto", color: PURCHASING_COLOR },
    cumulativePct: { label: "% acumulado", color: CUMULATIVE_COLOR },
  } satisfies ChartConfig
  const ranking = (
    <RankedList
      ariaLabel="Gasto por proveedor, de mayor a menor"
      format="clp"
      order="input"
      limit={rows.length}
      items={rows.map((row) => ({ key: row.key, label: row.label, value: row.amount, href: row.href }))}
    />
  )

  return (
    <DenseChart fallback={ranking}>
      <ChartContainer config={config} className="aspect-auto h-80 w-full">
        <ComposedChart accessibilityLayer aria-label="Pareto de proveedores: gasto por proveedor y porcentaje acumulado" data={rows} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            interval={0}
            angle={-30}
            textAnchor="end"
            height={72}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            tick={AXIS_TICK}
            tickFormatter={(label: string) => shortenLabel(label)}
          />
          <YAxis yAxisId="amount" tickLine={false} axisLine={false} width={58} tick={AXIS_TICK} tickFormatter={formatCompactCLP} />
          <YAxis
            yAxisId="pct"
            orientation="right"
            domain={[0, 100]}
            ticks={paretoYAxisTicks(thresholdPct)}
            tickLine={false}
            axisLine={false}
            width={44}
            tick={AXIS_TICK}
            tickFormatter={(value: number) => `${value}%`}
          />
          <Tooltip content={<ParetoTooltip />} cursor={{ fill: "var(--color-surface-2)" }} />
          <ReferenceLine
            yAxisId="pct"
            y={thresholdPct}
            stroke={REFERENCE_COLOR}
            strokeDasharray="4 3"
            label={{ value: `Umbral de alerta ${thresholdPct}%`, position: "insideTopLeft", fill: "var(--color-text-muted)", fontSize: 11 }}
          />
          <Bar
            yAxisId="amount"
            dataKey="amount"
            name="Gasto"
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
            onClick={(entry) => {
              const datum = entry as unknown as Partial<ParetoChartRow> & { payload?: ParetoChartRow }
              const href = datum.payload?.href ?? datum.href
              if (href) router.push(href)
            }}
            {...motion}
          >
            {rows.map((row) => (
              <Cell key={row.key} fill={row.isOther ? REFERENCE_COLOR : PURCHASING_COLOR} cursor={row.href ? "pointer" : "default"} />
            ))}
          </Bar>
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="cumulativePct"
            name="% acumulado"
            stroke={CUMULATIVE_COLOR}
            strokeWidth={2}
            dot={{ r: 3, fill: CUMULATIVE_COLOR, stroke: "var(--color-surface)", strokeWidth: 1 }}
            {...motion}
          />
        </ComposedChart>
      </ChartContainer>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <li className="inline-flex items-center gap-1.5"><LegendSwatch color={PURCHASING_COLOR} />Gasto por proveedor (eje izquierdo)</li>
        <li className="inline-flex items-center gap-1.5"><LegendSwatch color={CUMULATIVE_COLOR} />% acumulado del gasto total (eje derecho)</li>
        <li className="inline-flex items-center gap-1.5"><LegendSwatch color={REFERENCE_COLOR} />Otros proveedores</li>
      </ul>
    </DenseChart>
  )
}
