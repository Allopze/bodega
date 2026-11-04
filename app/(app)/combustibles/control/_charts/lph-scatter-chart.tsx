"use client"

import { CartesianGrid, LabelList, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig, type ChartTooltipItem } from "@/components/ui/chart"
import { CHART_COLORS } from "@/lib/chart-palette"
import { LPH_BAND_PCT, type LphComparisonView, type LphPoint } from "@/lib/combustibles/control/calc/lph-comparison"
import { MONTH_LABELS, countOf, formatQty } from "@/lib/utils"
import { AXIS_TICK } from "./chart-shared"

/**
 * CHART-021: telemetría contra cargas, un punto por equipo y mes.
 *
 * - **Diagonal y = x**: sobre ella la telemetría y las cargas coinciden. Las dos
 *   líneas punteadas son la banda de ±15 %.
 * - **Los dos ejes miden L/h** con la misma escala, así que la diagonal sí es «igual»
 *   (una unidad por eje, A5b).
 * - **Fuera de la banda**: rombo en el color de peligro y con rótulo; dentro, círculo
 *   verde. La forma, además del color, dice qué es cada punto.
 *
 * Es una imagen (`role="img"`): nada dentro es interactivo, ni siquiera un enlace
 * (axe `nested-interactive`). Los enlaces a la ficha de cada equipo fuera de la
 * banda van en la lista de abajo, fuera de la imagen.
 */

const config = {
  inside: { label: "Dentro de la banda", color: CHART_COLORS.brand },
  outside: { label: "Fuera de la banda", color: CHART_COLORS.danger },
} satisfies ChartConfig

type ChartPoint = LphPoint & { label: string }

/** «mar» — el mes en el rótulo del punto. */
const monthWord = (month: string) => (MONTH_LABELS[Number(month.slice(5, 7)) - 1] ?? month).toLowerCase()

/** «KA-1 · mar»: el código del equipo (o la patente, si no tiene código) y el mes. */
function pointLabel(point: LphPoint): string {
  const short = point.equipment.split(" · ")[0] ?? point.equipment
  return `${short} · ${monthWord(point.month)}`
}

const lph = (value: number) => `${formatQty(value, undefined, { maximumFractionDigits: 1 })} L/h`

function LphTooltip({ active, payload }: { active?: boolean; payload?: ChartTooltipItem[] }) {
  const point = payload?.[0]?.payload as ChartPoint | undefined
  if (!active || !point) return null
  const diff = `${point.differencePct > 0 ? "+" : point.differencePct < 0 ? "−" : ""}${formatQty(Math.abs(point.differencePct), undefined, { maximumFractionDigits: 1 })} %`
  return (
    <div className="min-w-44 border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-[var(--shadow-md)]">
      <p className="font-semibold text-[var(--color-text)]">{point.equipment}</p>
      <p className="mb-1 text-[var(--color-text-muted)]">{monthWord(point.month)} {point.month.slice(0, 4)}</p>
      <div className="flex justify-between gap-4"><span className="text-[var(--color-text-muted)]">Telemetría</span><span className="font-mono tabular-nums">{lph(point.y)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-[var(--color-text-muted)]">Cargas ({countOf(point.loadCount, "carga", "cargas")})</span><span className="font-mono tabular-nums">{lph(point.x)}</span></div>
      <div className="mt-1 flex justify-between gap-4 font-medium"><span>Diferencia</span><span className="font-mono tabular-nums">{diff}</span></div>
    </div>
  )
}

export function LphScatterChart({ view }: { view: LphComparisonView }) {
  const max = view.axisMax
  const band = LPH_BAND_PCT / 100
  const inside: ChartPoint[] = view.points.filter((point) => !point.outside).map((point) => ({ ...point, label: pointLabel(point) }))
  const outside: ChartPoint[] = view.points.filter((point) => point.outside).map((point) => ({ ...point, label: pointLabel(point) }))

  return (
    <div>
      <ChartContainer
        config={config}
        className="aspect-auto h-72 w-full"
        role="img"
        aria-label={`Litros por hora según la telemetría contra los que salen de las cargas, un punto por equipo y mes: ${view.points.length - view.outside.length} dentro de la banda de ±${LPH_BAND_PCT} % y ${view.outside.length} fuera`}
      >
        <ScatterChart margin={{ top: 12, right: 24, left: 4, bottom: 28 }} accessibilityLayer={false}>
          <CartesianGrid strokeDasharray="2 5" />
          <XAxis
            type="number" dataKey="x" name="Cargas" domain={[0, max]} tickLine={false} axisLine={false} tick={AXIS_TICK} allowDecimals={false}
            label={{ value: "L/h según las cargas", position: "insideBottom", offset: -14, fontSize: 11, fill: "var(--color-text-muted)" }}
          />
          <YAxis
            type="number" dataKey="y" name="Telemetría" domain={[0, max]} tickLine={false} axisLine={false} width={44} tick={AXIS_TICK} allowDecimals={false}
            label={{ value: "L/h según la telemetría", angle: -90, position: "insideLeft", offset: 8, fontSize: 11, fill: "var(--color-text-muted)" }}
          />
          <ZAxis range={[70, 70]} />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke={CHART_COLORS.neutral} strokeWidth={1.5} ifOverflow="hidden" />
          {/* La recta de arriba (y = 1,15·x) termina donde toca el tope del eje, para no salirse del área de trazado. */}
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max / (1 + band), y: max }]} stroke={CHART_COLORS.neutral} strokeDasharray="4 3" ifOverflow="hidden" />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max * (1 - band) }]} stroke={CHART_COLORS.neutral} strokeDasharray="4 3" ifOverflow="hidden" />
          <ChartTooltip cursor={false} isAnimationActive={false} content={<LphTooltip />} />
          <Scatter name="Dentro de la banda" data={inside} fill={CHART_COLORS.brand} shape="circle" isAnimationActive={false} />
          <Scatter name="Fuera de la banda" data={outside} fill={CHART_COLORS.danger} shape="diamond" isAnimationActive={false}>
            <LabelList dataKey="label" position="top" offset={8} fontSize={11} fill="var(--color-text)" />
          </Scatter>
        </ScatterChart>
      </ChartContainer>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: CHART_COLORS.brand }} />Dentro de la banda</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rotate-45" style={{ background: CHART_COLORS.danger }} />Fuera de la banda</span>
        <span>La línea continua es la diagonal (telemetría = cargas); las punteadas, ±{LPH_BAND_PCT} %.</span>
      </p>
    </div>
  )
}
