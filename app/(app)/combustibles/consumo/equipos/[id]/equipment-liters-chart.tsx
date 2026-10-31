"use client"

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { CHART_COLORS } from "@/lib/chart-palette"
import type { EquipmentFileLitersMonth } from "@/lib/combustibles/equipment/types"
import { MONTH_LABELS, MONTH_NAMES, countOf, formatQty } from "@/lib/utils"
import { AXIS_TICK, compactNumber } from "../../../control/_charts/chart-shared"

/**
 * Opacidad de los meses fuera del período elegido. No baja de 0,6 porque una
 * barra es un objeto gráfico que hay que distinguir del fondo (WCAG 1.4.11,
 * 3:1): `--color-primary` al 60 % sobre blanco mide 3,1:1; al 45 %, 2,2:1.
 */
const OUT_OF_PERIOD_OPACITY = 0.6

const liters = (value: number) => `${formatQty(value, undefined, { maximumFractionDigits: 0 })} L`

/** «Mar 26», para el eje. */
function shortMonth(month: string): string {
  const [year = "", number = ""] = month.split("-")
  return `${MONTH_LABELS[Number(number) - 1] ?? month} ${year.slice(2)}`
}

/** «marzo de 2026», para una frase. */
function monthInSentence(month: string): string {
  const [year = "", number = ""] = month.split("-")
  return `${MONTH_NAMES[Number(number) - 1] ?? month} de ${year}`
}

/**
 * «Litros por mes» de un equipo: los 12 meses que terminan en el del período,
 * con 0 L en los que no hubo cargas. Un mes sin cargas no dibuja barra, pero
 * sigue en el eje (sin él, los vecinos quedarían pegados y el tiempo parecería
 * saltar) y su tooltip dice «0 L». Los meses del período elegido van en el color
 * pleno de la marca y el resto atenuado; eso no lo dice el color solo: lo dicen
 * el subtítulo de la sección y el tooltip. Una sola unidad en el eje (litros) y
 * sin animación, como los demás gráficos de Combustible: `prefers-reduced-motion`
 * se respeta por construcción.
 *
 * Es una imagen (`role="img"`) con nombre, así que sin la capa de accesibilidad
 * de Recharts (`accessibilityLayer={false}`): esa capa pone un foco
 * (`tabindex="0"`, `role="application"`) dentro de la imagen, y los hijos de una
 * imagen no pueden ser interactivos (axe: `nested-interactive`). El resumen va
 * en el nombre; el detalle de cada mes, en el tooltip al apuntar.
 */
export function EquipmentLitersChart({ months, periodMonths, vehicleLabel }: { months: EquipmentFileLitersMonth[]; periodMonths: string[]; vehicleLabel: string }) {
  if (months.every((point) => point.liters === 0)) {
    return <ChartEmpty label="Sin cargas en los últimos 12 meses" hint="Aparecen cuando el equipo tiene cargas que cuenten en alguno de esos meses." className="h-56" />
  }

  const inPeriod = new Set(periodMonths)
  const data = months.map((point) => {
    const sentence = monthInSentence(point.month)
    return {
      ...point,
      label: shortMonth(point.month),
      fullLabel: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`,
      inPeriod: inPeriod.has(point.month),
    }
  })
  const first = data[0]!
  const last = data[data.length - 1]!
  const peak = data.reduce((best, point) => (point.liters > best.liters ? point : best), first)
  const config: ChartConfig = { liters: { label: "Litros", color: CHART_COLORS.brand } }
  // Sin período que resaltar, todos los meses van en color pleno.
  const dimmed = (point: { inPeriod: boolean }) => periodMonths.length > 0 && !point.inPeriod

  return (
    <ChartErrorBoundary chartName="Litros por mes">
      <ChartContainer
        config={config}
        className="aspect-auto h-60 w-full"
        role="img"
        aria-label={`Litros por mes de ${vehicleLabel}, de ${liters(first.liters)} en ${monthInSentence(first.month)} a ${liters(last.liters)} en ${monthInSentence(last.month)}; el mes con más litros fue ${monthInSentence(peak.month)} (${liters(peak.liters)})`}
      >
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} strokeDasharray="2 5" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={8} />
          <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={52} tickFormatter={compactNumber} />
          <ChartTooltip
            isAnimationActive={false}
            content={
              <ChartTooltipContent
                hideIndicator
                labelFormatter={(_, payload) => String(payload[0]?.payload?.fullLabel ?? "")}
                formatter={(value, _name, item) => (
                  <div className="grid w-full gap-0.5">
                    <span className="font-mono tabular-nums text-[var(--color-text)]">{liters(Number(value))}</span>
                    <span className="text-[var(--color-text-muted)]">
                      {countOf(Number(item.payload?.loads ?? 0), "carga", "cargas")}
                      {item.payload?.inPeriod ? " · en el período elegido" : ""}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey="liters" name="Litros" fill={CHART_COLORS.brand} radius={[2, 2, 0, 0]} maxBarSize={36} isAnimationActive={false}>
            {data.map((point) => <Cell key={point.month} fillOpacity={dimmed(point) ? OUT_OF_PERIOD_OPACITY : 1} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartErrorBoundary>
  )
}
