"use client"

import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps } from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
  type ChartTooltipItem,
} from "@/components/ui/chart"
import {
  RECONCILIATION_STATUS_META,
  RECONCILIATION_STATUS_ORDER,
  type ReconciliationMonth,
  type ReconciliationShape,
} from "@/lib/purchasing/reconciliation-charts"
import { MONTH_LABELS, formatCLP } from "@/lib/utils"
import { useChartMotion } from "@/components/ui/chart-interactions"

/**
 * OC emitidas por mes, apiladas por estado de conciliación (CHART-034a). El
 * monto por facturar va en el tooltip y en la frase de la sección: las barras
 * son conteos, y un conteo y un monto no comparten eje (A5b).
 *
 * Las capas siguen el orden de `RECONCILIATION_STATUS_ORDER` (lo que pide acción
 * en el piso del gráfico) y nunca llevan radio entre sí. El mes en curso va
 * tenue y punteado: todavía se emiten OC y no debe leerse como una caída.
 */

const config = Object.fromEntries(
  RECONCILIATION_STATUS_ORDER.map((status) => [status, { label: RECONCILIATION_STATUS_META[status].label, color: RECONCILIATION_STATUS_META[status].color }]),
) satisfies ChartConfig

const MARGIN = { top: 8, right: 8, left: 0, bottom: 0 }
const PARTIAL_FILL_OPACITY = 0.4
const PARTIAL_DASH = "4 3"

function MonthBar(props: BarShapeProps) {
  const partial = (props.payload as ReconciliationMonth | undefined)?.partial === true
  return <Rectangle {...props} {...(partial ? { fillOpacity: PARTIAL_FILL_OPACITY, stroke: props.fill, strokeWidth: 1.5, strokeDasharray: PARTIAL_DASH } : {})} />
}

/** «oct» o, si la ventana cruza de año, «oct 25»: el eje no repite el año en cada marca. */
function axisLabel(month: string, crossesYears: boolean): string {
  const name = MONTH_LABELS[Number(month.slice(5, 7)) - 1] ?? month
  return crossesYears ? `${name} ${month.slice(2, 4)}` : name
}

export function ReconciliationChart({ shape }: { shape: ReconciliationShape }) {
  const motion = useChartMotion()
  const crossesYears = new Set(shape.months.map((month) => month.month.slice(0, 4))).size > 1
  const data = shape.months.map((month) => ({ ...month, ...month.counts, axis: axisLabel(month.month, crossesYears) }))
  const hasPartial = shape.months.some((month) => month.partial)

  const title = (_label: unknown, payload: ChartTooltipItem[]) => {
    const month = payload[0]?.payload as ReconciliationMonth | undefined
    if (!month) return null
    return (
      <>
        {month.label}{month.partial ? " · en curso" : ""}
        <span className="mt-0.5 block text-xs font-normal text-[var(--color-text-muted)]">
          {month.total === 1 ? "1 OC" : `${month.total} OC`} · por facturar {formatCLP(month.toInvoice)}
        </span>
      </>
    )
  }

  return (
    <div>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <BarChart aria-label="Órdenes de compra por mes según su estado de conciliación con la factura" data={data} margin={MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="axis" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} interval={0} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={{ fontSize: 11 }} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" labelFormatter={title} />} />
          <ChartLegend content={<ChartLegendContent />} />
          {RECONCILIATION_STATUS_ORDER.map((status) => (
            <Bar key={status} dataKey={status} stackId="oc" fill={RECONCILIATION_STATUS_META[status].color} shape={MonthBar} {...motion} />
          ))}
        </BarChart>
      </ChartContainer>
      {hasPartial ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">La última columna, punteada, es el mes en curso: todavía se emiten OC.</p> : null}
    </div>
  )
}
