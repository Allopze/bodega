"use client"

import { Bar, CartesianGrid, ComposedChart, Legend, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { IDLE_COLORS, hoursTick, pctTick, tooltipRow } from "./idle-chart-parts"

export interface IdleDailyPoint { label: string; operatingHours: number; idlePct: number | null }

const config = {
  operatingHours: { label: "Horas de funcionamiento", color: IDLE_COLORS.working },
  idlePct: { label: "% en vacío", color: IDLE_COLORS.pct },
} satisfies ChartConfig

/** V-07: un equipo, día a día. Barras = horas de funcionamiento (eje izquierdo), línea = % en vacío (eje derecho). */
export function IdleDailyChart({ data }: { data: IdleDailyPoint[] }) {
  if (data.length === 0) return <ChartEmpty label="Sin telemetría de este equipo en el período" hint="Elige otro equipo o cambia el período." />
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full" role="img" aria-label="Horas de funcionamiento por día y porcentaje en vacío del equipo elegido">
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} minTickGap={16} />
        <YAxis yAxisId="hours" tickLine={false} axisLine={false} width={44} tickFormatter={hoursTick} tick={{ fontSize: 11 }} label={{ value: "horas", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--color-text-muted)" }} />
        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} width={44} tickFormatter={pctTick} tick={{ fontSize: 11 }} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value, name, item) => tooltipRow(value, name, item, (series) => (series === "% en vacío" ? "%" : "h"))} />} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="hours" dataKey="operatingHours" name="Horas de funcionamiento" fill={IDLE_COLORS.working} maxBarSize={28} radius={[3, 3, 0, 0]} />
        <Line yAxisId="pct" type="monotone" dataKey="idlePct" name="% en vacío" stroke={IDLE_COLORS.pct} strokeWidth={2} dot={false} connectNulls={false} />
      </ComposedChart>
    </ChartContainer>
  )
}
