"use client"

import { Bar, CartesianGrid, ComposedChart, Legend, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { IDLE_COLORS, litersTick, pctTick, tooltipRow } from "./idle-chart-parts"
import { useChartMotion } from "@/components/ui/chart-interactions"
import { AXIS_TICK } from "../../../_shared/chart-shared"

export interface IdleLitersPoint { label: string; litersIdle: number | null; idleLitersPct: number | null }

const config = {
  litersIdle: { label: "Litros en vacío", color: IDLE_COLORS.idle },
  idleLitersPct: { label: "% de los litros", color: IDLE_COLORS.pct },
} satisfies ChartConfig

/** V-06 (segundo gráfico): litros gastados en vacío (eje izquierdo, L) y su % sobre los litros informados (eje derecho). */
export function IdleLitersChart({ data }: { data: IdleLitersPoint[] }) {
  const motion = useChartMotion()
  if (!data.some((point) => point.litersIdle !== null)) {
    return <ChartEmpty label="Sin litros informados" hint="El archivo de telemetría importado no trae litros en vacío para este período." />
  }
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full" role="img" aria-label="Litros en vacío por mes y su porcentaje sobre los litros informados">
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={AXIS_TICK} />
        <YAxis yAxisId="liters" tickLine={false} axisLine={false} width={48} tickFormatter={litersTick} tick={AXIS_TICK} label={{ value: "litros", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--color-text-muted)" }} />
        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} width={52} tickFormatter={pctTick} tick={AXIS_TICK} label={{ value: "% en vacío", angle: 90, position: "insideRight", fontSize: 11, fill: "var(--color-text-muted)" }} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value, name, item) => tooltipRow(value, name, item, (series) => (series === "Litros en vacío" ? "L" : "%"))} />} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="liters" dataKey="litersIdle" name="Litros en vacío" fill={IDLE_COLORS.idle} maxBarSize={44} radius={[3, 3, 0, 0]} {...motion} />
        <Line yAxisId="pct" type="monotone" dataKey="idleLitersPct" name="% de los litros" stroke={IDLE_COLORS.pct} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} {...motion} />
      </ComposedChart>
    </ChartContainer>
  )
}
