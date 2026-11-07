"use client"

import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts"
import { activeDotFor, partialTailLineShape, SURFACE } from "@/components/charts/chart-parts"
import { ChartContainer, ChartTooltip, type ChartConfig, type ChartTooltipItem } from "@/components/ui/chart"
import { CHART_COLORS } from "@/lib/chart-palette"
import { PERFORMANCE_UNIT_LABELS } from "@/lib/combustibles/control/contracts"
import { MIN_RATE_SEGMENTS, type MeterRateSeries } from "@/lib/combustibles/meter-rate-series"
import { RATE_BAND_PCT, meterRateChartData, rateAxisDomain, type MeterRateChartRow } from "@/lib/combustibles/meter-rate-view"
import { countOf, formatQty } from "@/lib/utils"
import { AXIS_TICK } from "./chart-shared"
import { useChartMotion } from "@/components/ui/chart-interactions"

/**
 * CHART-016: rendimiento por mes (km/L o L/h), una sola unidad por gráfico.
 *
 * - **La línea es la tasa.** Antes había que dividir de cabeza barras de kilómetros
 *   contra una línea de litros; ahora se dibuja lo que se gestiona.
 * - **Banda de ±10 % alrededor del global** de la ventana (la tolerancia con que
 *   Consumo juzga «rinde peor»): un mes dentro de la banda es ruido; fuera, una señal.
 * - **Un mes sin datos del proveedor es un hueco**: la línea se corta y el eje dice
 *   «sin datos». Nunca una caída a cero (C-4).
 * - **Un mes con pocos tramos no dibuja punto** y su tooltip dice «datos
 *   insuficientes». El n de cada mes va bajo su rótulo en el eje.
 * - **El mes en curso** va punteado: todavía no termina.
 *
 * Es una imagen (`role="img"`) con nombre y sin la capa de accesibilidad de Recharts
 * (esa capa pone un foco dentro de la imagen y axe lo marca como `nested-interactive`).
 * El detalle por mes está en «Ver datos» del `ChartSection` que lo envuelve.
 */

const config = { rate: { label: "Rendimiento", color: CHART_COLORS.brand } } satisfies ChartConfig

/** Lo que recibe un tick de recharts: las coordenadas llegan como número o texto según el eje. */
interface TickProps { x?: number | string; y?: number | string; index?: number }

/** Rótulo del mes y, debajo, su n (o «sin datos»). */
function monthTick(rows: MeterRateChartRow[]) {
  return function MonthTick({ x = 0, y = 0, index = 0 }: TickProps) {
    const row = rows[index]
    if (!row) return <g />
    return (
      <g transform={`translate(${Number(x)},${Number(y)})`}>
        <text textAnchor="middle" dy={12} fontSize={11} fill="var(--color-text-muted)">{row.label}</text>
        <text textAnchor="middle" dy={26} fontSize={11} fill="var(--color-text-muted)" fontStyle={row.status === "gap" ? "italic" : undefined}>{row.caption}</text>
      </g>
    )
  }
}

function RateTooltip({ unit, active, payload }: { unit: string; active?: boolean; payload?: ChartTooltipItem[] }) {
  const row = payload?.[0]?.payload as MeterRateChartRow | undefined
  if (!active || !row) return null
  return (
    <div className="min-w-44 border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-[var(--shadow-md)]">
      <p className="mb-1 font-semibold text-[var(--color-text)]">{row.fullLabel}</p>
      {row.status === "gap" ? (
        <p className="text-[var(--color-text-muted)]">Sin datos del proveedor: no se sabe qué rendimiento tuvo, no es cero.</p>
      ) : (
        <>
          {row.rate === null ? (
            <p className="font-medium text-[var(--color-text)]">Datos insuficientes <span className="font-normal text-[var(--color-text-muted)]">({row.segments} de {MIN_RATE_SEGMENTS} tramos)</span></p>
          ) : (
            <p className="font-mono text-sm font-semibold tabular-nums text-[var(--color-text)]">{formatQty(row.rate, undefined, { maximumFractionDigits: 2 })} {unit}</p>
          )}
          <p className="mt-0.5 text-[var(--color-text-muted)]">{countOf(row.segments, "tramo", "tramos")} · {countOf(row.equipment, "equipo", "equipos")}</p>
          <p className="text-[var(--color-text-muted)]">{formatQty(row.measure, undefined, { maximumFractionDigits: 0 })} {unit === "km/L" ? "km" : "h"} · {formatQty(row.liters, undefined, { maximumFractionDigits: 0 })} L</p>
          {row.discarded > 0 ? <p className="text-[var(--color-text-muted)]">{countOf(row.discarded, "par descartado", "pares descartados")}</p> : null}
          {row.partial ? <p className="mt-0.5 text-[var(--color-text-muted)]">Mes en curso: puede cambiar.</p> : null}
        </>
      )}
    </div>
  )
}

export function MeterRateChart({ series }: { series: MeterRateSeries }) {
  const motion = useChartMotion()
  const unit = PERFORMANCE_UNIT_LABELS[series.unit]
  const { data, partialFrom } = meterRateChartData(series)
  const global = series.rate
  const domain = rateAxisDomain(data.flatMap((row) => (row.rate === null ? [] : [row.rate])), global)
  const first = data[0]
  const last = data[data.length - 1]

  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-64 w-full"
      role="img"
      aria-label={`Rendimiento por mes en ${unit}${first && last ? `, de ${first.label} a ${last.label}` : ""}, con la banda de ±${RATE_BAND_PCT} % del global; bajo cada mes, el número de tramos`}
    >
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} accessibilityLayer={false}>
        <CartesianGrid vertical={false} strokeDasharray="2 5" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} height={40} tick={monthTick(data)} />
        <YAxis
          domain={domain}
          tickLine={false}
          axisLine={false}
          width={44}
          tick={AXIS_TICK}
          tickFormatter={(value: number) => formatQty(value, undefined, { maximumFractionDigits: 1 })}
          label={{ value: unit, angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--color-text-muted)" }}
        />
        {global !== null ? (
          <ReferenceArea y1={global * (1 - RATE_BAND_PCT / 100)} y2={global * (1 + RATE_BAND_PCT / 100)} fill={CHART_COLORS.neutral} fillOpacity={0.2} ifOverflow="visible" />
        ) : null}
        {global !== null ? (
          <ReferenceLine y={global} stroke={CHART_COLORS.neutral} strokeDasharray="4 3" ifOverflow="visible" />
        ) : null}
        <ChartTooltip cursor={false} isAnimationActive={false} filterNull={false} content={<RateTooltip unit={unit} />} />
        <Line
          dataKey="rate"
          name="Rendimiento"
          type="linear"
          stroke={CHART_COLORS.brand}
          strokeWidth={2}
          connectNulls={false}
          dot={{ r: 3.5, fill: SURFACE, stroke: CHART_COLORS.brand, strokeWidth: 2 }}
          activeDot={activeDotFor(CHART_COLORS.brand)}
          {...(partialFrom >= 0 ? { shape: partialTailLineShape(partialFrom) } : {})}
          {...motion}
        />
      </LineChart>
    </ChartContainer>
  )
}
