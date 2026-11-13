"use client"

import { Bar, CartesianGrid, ComposedChart, Legend, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { IDLE_COLORS, hoursTick, pctTick, tooltipRow } from "./idle-chart-parts"
import { useChartMotion } from "@/components/ui/chart-interactions"
import { AXIS_TICK } from "../../../_shared/chart-shared"

export interface IdleMonthlyPoint { label: string; workingHours: number; idleHours: number; idlePct: number | null }

const config = {
  workingHours: { label: "Horas trabajando", color: IDLE_COLORS.working },
  idleHours: { label: "Horas en vacío", color: IDLE_COLORS.idle },
  idlePct: { label: "% en vacío", color: IDLE_COLORS.pct },
} satisfies ChartConfig

/** V-06: horas trabajando y en vacío apiladas (eje izquierdo, h) y % en vacío (eje derecho). */
export function IdleMonthlyChart({ data }: { data: IdleMonthlyPoint[] }) {
  const motion = useChartMotion()
  if (data.length === 0) return <ChartEmpty label="Sin telemetría en el período" hint="Cambia el período o importa el archivo de telemetría del equipo." />
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full" role="img" aria-label="Horas trabajando y en vacío por mes, con el porcentaje en vacío">
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={AXIS_TICK} />
        <YAxis yAxisId="hours" tickLine={false} axisLine={false} width={44} tickFormatter={hoursTick} tick={AXIS_TICK} label={{ value: "horas", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--color-text-muted)" }} />
        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} width={52} tickFormatter={pctTick} tick={AXIS_TICK} label={{ value: "% en vacío", angle: 90, position: "insideRight", fontSize: 11, fill: "var(--color-text-muted)" }} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value, name, item) => tooltipRow(value, name, item, (series) => (series === "% en vacío" ? "%" : "h"))} />} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="hours" stackId="hours" dataKey="workingHours" name="Horas trabajando" fill={IDLE_COLORS.working} maxBarSize={44} {...motion} />
        <Bar yAxisId="hours" stackId="hours" dataKey="idleHours" name="Horas en vacío" fill={IDLE_COLORS.idle} maxBarSize={44} radius={[3, 3, 0, 0]} {...motion} />
        <Line yAxisId="pct" type="monotone" dataKey="idlePct" name="% en vacío" stroke={IDLE_COLORS.pct} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} {...motion} />
      </ComposedChart>
    </ChartContainer>
  )
}
