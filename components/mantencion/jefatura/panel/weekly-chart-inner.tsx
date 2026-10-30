"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { useChartMotion } from "@/components/ui/chart-interactions"
import { weekLabel, weekRangeLabel } from "@/lib/services/mantencion/panel-filters"
import { WEEKLY_COLORS } from "./weekly-chart-colors"

export interface WeeklyPoint { start: string; preventive: number; corrective: number }

const config = {
  preventive: { label: "Preventivas", color: WEEKLY_COLORS.preventive },
  corrective: { label: "Correctivas", color: WEEKLY_COLORS.corrective },
} satisfies ChartConfig

/**
 * Registros por semana, columnas apiladas (preventiva abajo, correctiva arriba).
 * Una sola unidad en el eje (registros), así que no hace falta eje doble (A5b).
 * La tabla «Ver datos» de la tarjeta repite estas mismas cifras en texto.
 *
 * La leyenda usa `ChartLegendContent`: la muestra lleva el color de la serie y el
 * TEXTO el color de texto. Con la `Legend` de recharts el texto heredaba el de la
 * serie y «Correctivas» medía 3,8:1 sobre blanco (falla AA 1.4.3); la serie sigue
 * siendo naranja, sólo el rótulo cambia.
 */
export function WeeklyChartInner({ data }: { data: WeeklyPoint[] }) {
  const motion = useChartMotion()
  const points = data.map((point) => ({ ...point, label: weekLabel(point.start), range: weekRangeLabel(point.start) }))
  if (points.every((point) => point.preventive + point.corrective === 0)) {
    return <ChartEmpty label="Sin registros en estas semanas" hint="Cuando los mecánicos firmen mantenciones, las verás aquí por semana." className="h-60" />
  }
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-60 w-full"
      role="img"
      aria-label="Registros por semana, preventivas y correctivas apiladas. Los mismos datos están en la tabla «Ver datos»."
    >
      <BarChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} tick={{ fontSize: 11 }} />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(_, payload) => `Semana del ${String(payload?.[0]?.payload?.range ?? "")}`} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="preventive" name="Preventivas" stackId="records" fill={WEEKLY_COLORS.preventive} maxBarSize={40} {...motion} />
        <Bar dataKey="corrective" name="Correctivas" stackId="records" fill={WEEKLY_COLORS.corrective} maxBarSize={40} radius={[3, 3, 0, 0]} {...motion} />
      </BarChart>
    </ChartContainer>
  )
}
