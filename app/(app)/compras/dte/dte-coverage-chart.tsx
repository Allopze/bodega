"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
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
import { SegmentedControl } from "@/components/ui/segmented-control"
import {
  DTE_LINK_META,
  DTE_LINK_ORDER,
  dteListHref,
  type DteCoverageMonth,
  type DteCoverageShape,
  type DteLink,
} from "@/lib/purchasing/reconciliation-charts"
import { MONTH_LABELS, formatCLP, formatCompactCLP } from "@/lib/utils"

/**
 * DTE recibidos por período, apilados por vínculo (CHART-034b): a una factura de
 * OC, a una carga de combustible o sin vincular. Una sola medida a la vez —cantidad
 * o monto en pesos— con un interruptor: son dos preguntas distintas y juntas no
 * comparten eje (A5b).
 *
 * Clic en una barra lleva a la lista del mismo período y vínculo, que cuenta lo
 * mismo que el gráfico. Sin puntero, el enlace «Ver sin vincular» de la sección
 * llega al mismo lugar. El mes en curso va tenue y punteado.
 */

type Measure = "count" | "amount"

const config = Object.fromEntries(
  DTE_LINK_ORDER.map((link) => [link, { label: DTE_LINK_META[link].label, color: DTE_LINK_META[link].color }]),
) satisfies ChartConfig

const MARGIN = { top: 8, right: 8, left: 0, bottom: 0 }
const PARTIAL_FILL_OPACITY = 0.4
const PARTIAL_DASH = "4 3"

function MonthBar(props: BarShapeProps) {
  const partial = (props.payload as { partial?: boolean } | undefined)?.partial === true
  return <Rectangle {...props} style={{ cursor: "pointer" }} {...(partial ? { fillOpacity: PARTIAL_FILL_OPACITY, stroke: props.fill, strokeWidth: 1.5, strokeDasharray: PARTIAL_DASH } : {})} />
}

function axisLabel(month: string, crossesYears: boolean): string {
  const name = MONTH_LABELS[Number(month.slice(5, 7)) - 1] ?? month
  return crossesYears ? `${name} ${month.slice(2, 4)}` : name
}

export function DteCoverageChart({ shape }: { shape: DteCoverageShape }) {
  const router = useRouter()
  const [measure, setMeasure] = React.useState<Measure>("count")
  const crossesYears = new Set(shape.months.map((month) => month.month.slice(0, 4))).size > 1
  const hasPartial = shape.months.some((month) => month.partial)
  const asAmount = measure === "amount"

  const data = shape.months.map((month: DteCoverageMonth) => ({
    month: month.month,
    axis: axisLabel(month.month, crossesYears),
    partial: month.partial,
    label: month.label,
    total: month.total,
    ...(asAmount ? month.amounts : month.counts),
  }))

  const title = (_label: unknown, payload: ChartTooltipItem[]) => {
    const datum = payload[0]?.payload as { label?: string; partial?: boolean; total?: number } | undefined
    if (!datum) return null
    return (
      <>
        {datum.label}{datum.partial ? " · en curso" : ""}
        <span className="mt-0.5 block text-xs font-normal text-[var(--color-text-muted)]">
          {datum.total === 1 ? "1 DTE" : `${datum.total} DTE`} · clic para ver la lista
        </span>
      </>
    )
  }

  const open = (month: string, link: DteLink) => router.push(dteListHref(month, link))

  return (
    <div>
      <SegmentedControl
        ariaLabel="Medida del gráfico de cobertura DTE"
        variant="segmented"
        className="mb-2"
        items={[
          { key: "count", label: "Cantidad", active: !asAmount, onClick: () => setMeasure("count") },
          { key: "amount", label: "Monto", active: asAmount, onClick: () => setMeasure("amount") },
        ]}
      />
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <BarChart data={data} margin={MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="axis" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} interval={0} />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={asAmount ? 52 : 32}
            tick={{ fontSize: 11 }}
            // Una nota de crédito puede dejar el neto de un vínculo bajo cero: el eje cede ese lugar.
            domain={[(dataMin: number) => Math.min(0, dataMin), "auto"]}
            tickFormatter={asAmount ? (value: number) => formatCompactCLP(value) : undefined}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                indicator="dot"
                labelFormatter={title}
                formatter={asAmount ? (value, _name, item) => (
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[var(--color-text-muted)]">
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: String(item.color ?? item.fill ?? "") }} />
                      {DTE_LINK_META[item.dataKey as DteLink]?.label ?? String(item.name ?? "")}
                    </span>
                    <span className="font-mono font-medium tabular-nums text-[var(--color-text)]">{formatCLP(Number(value))}</span>
                  </span>
                ) : undefined}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {DTE_LINK_ORDER.map((link) => (
            <Bar
              key={link}
              dataKey={link}
              stackId="dte"
              fill={DTE_LINK_META[link].color}
              shape={MonthBar}
              onClick={(entry: unknown) => {
                const month = (entry as { payload?: { month?: string } } | undefined)?.payload?.month
                if (month) open(month, link)
              }}
            />
          ))}
        </BarChart>
      </ChartContainer>
      {hasPartial ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">La última columna, punteada, es el período en curso: el portal sigue entregando documentos.</p> : null}
    </div>
  )
}
