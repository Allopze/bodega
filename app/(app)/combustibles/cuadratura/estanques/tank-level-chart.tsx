"use client"

import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, Rectangle, ReferenceArea, ReferenceLine, XAxis, YAxis, type BarShapeProps } from "recharts"
import { DenseChart } from "@/components/charts/dense-chart"
import { ChartContainer, ChartTooltip, type ChartConfig, type ChartTooltipItem } from "@/components/ui/chart"
import { useChartMotion } from "@/components/ui/chart-interactions"
import { CHART_COLORS, CHART_SERIES } from "@/lib/chart-palette"
import { tankLevelGranularityNote, type TankLevelBucket, type TankLevelSeries, type TankLevelView } from "@/lib/combustibles/tank-level"
import { formatCompactQty, formatQty } from "@/lib/utils"

/**
 * Nivel de cada estanque en el tiempo (CHART-020, P-5): una línea escalonada del nivel al cierre de
 * cada tramo y, debajo, lo que entró (hacia arriba) y salió (hacia abajo).
 *
 * **Dos paneles y no un eje doble (A5b).** El nivel son miles de litros y lo que entra o sale en un
 * día, cientos: sobre un mismo eje la serie chica queda pegada al piso, y con dos ejes de ceros
 * desalineados la línea y las barras se pisan. Cada panel tiene su escala, y ambos comparten el eje
 * del tiempo (mismo margen y mismo ancho de eje) para que un día caiga bajo el mismo punto.
 *
 * - **Una curva por estanque** (small multiples): cada uno tiene su capacidad, que va como línea de
 *   referencia punteada cuando está declarada. Sin capacidad no se inventa una escala.
 * - **Lo que falta del período se sombrea.** Un período en curso llega hasta hoy: los tramos que
 *   todavía no empiezan no tienen nivel (la línea se detiene, no cae a cero) y llevan una banda.
 * - **Una imagen con nombre** (`role="img"`) y sin la capa de accesibilidad de recharts (pone un foco
 *   dentro de la imagen y axe lo marca como `nested-interactive`). Los números exactos están en
 *   «Ver datos» del `ChartSection` que lo envuelve.
 * - **Bajo 360 px** el grupo de paneles se reemplaza por una lista (`DenseChart`).
 */

const config = {
  level: { label: "Nivel al cierre", color: CHART_SERIES[0] },
  inLiters: { label: "Entradas", color: CHART_SERIES[1] },
  outNegative: { label: "Salidas", color: CHART_SERIES[2] },
} satisfies ChartConfig

const MARGIN = { top: 8, right: 8, left: 0, bottom: 0 }
const AXIS_WIDTH = 44
const PARTIAL_FILL_OPACITY = 0.4
const PARTIAL_DASH = "4 3"
const TICK = { fontSize: 11 }

const litersWhole = (value: number): string => `${formatQty(value, undefined, { maximumFractionDigits: 0 })} L`

interface Row extends TankLevelBucket {
  /** Lo que salió, en negativo: las barras de salida cuelgan bajo el cero. */
  outNegative: number
}

/** Columna de un tramo en curso: tenue y con contorno punteado, para que no se lea como una caída. */
function BucketBar(props: BarShapeProps) {
  const partial = (props.payload as TankLevelBucket | undefined)?.partial === true
  return <Rectangle {...props} {...(partial ? { fillOpacity: PARTIAL_FILL_OPACITY, stroke: props.fill, strokeWidth: 1.5, strokeDasharray: PARTIAL_DASH } : {})} />
}

/** El mismo tooltip en los dos paneles: con el tramo apuntado, el nivel y lo que entró y salió. */
function BucketTooltip({ active, payload }: { active?: boolean; payload?: ChartTooltipItem[] }) {
  const bucket = payload?.[0]?.payload as TankLevelBucket | undefined
  if (!active || !bucket || bucket.future) return null
  return (
    <div className="min-w-44 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-[var(--shadow-md)]">
      <p className="mb-1 font-semibold text-[var(--color-text)]">{bucket.title}{bucket.partial ? " · en curso" : ""}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
        <dt className="text-[var(--color-text-muted)]">Nivel al cierre</dt>
        <dd className="text-right font-semibold text-[var(--color-text)]">{bucket.level === null ? "—" : litersWhole(bucket.level)}</dd>
        <dt className="text-[var(--color-text-muted)]">Entradas</dt>
        <dd className="text-right text-[var(--color-text)]">{litersWhole(bucket.inLiters)}</dd>
        <dt className="text-[var(--color-text-muted)]">Salidas</dt>
        <dd className="text-right text-[var(--color-text)]">{litersWhole(bucket.outLiters)}</dd>
      </dl>
    </div>
  )
}

function TankPanel({ tank, view }: { tank: TankLevelSeries; view: TankLevelView }) {
  const motion = useChartMotion()
  const rows = useMemo<Row[]>(() => tank.buckets.map((bucket) => ({ ...bucket, outNegative: -bucket.outLiters })), [tank.buckets])
  const labelOf = useMemo(() => new Map(tank.buckets.map((bucket) => [bucket.start, bucket.label])), [tank.buckets])
  const firstFuture = tank.buckets.find((bucket) => bucket.future)?.start
  const lastStart = tank.buckets.at(-1)?.start
  const shade = firstFuture && lastStart
    ? <ReferenceArea x1={firstFuture} x2={lastStart} fill={CHART_COLORS.neutral} fillOpacity={0.18} stroke="none" ifOverflow="visible" />
    : null
  const negative = tank.buckets.some((bucket) => bucket.level !== null && bucket.level < 0)
  const scale = view.granularity === "day" ? "día" : view.granularity === "week" ? "semana" : "mes"
  const first = tank.buckets[0]
  const last = tank.buckets.at(-1)

  return (
    <div className="min-w-0" data-testid="estanque-nivel-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="min-w-0 truncate text-sm font-medium text-[var(--color-text)]">{tank.name}</h4>
        <p className="shrink-0 text-xs tabular-nums text-[var(--color-text-muted)]">
          {litersWhole(tank.openingLiters)} <span aria-hidden>→</span><span className="sr-only">a</span> {litersWhole(tank.closingLiters)}
        </p>
      </div>

      <ChartContainer
        config={config}
        className="mt-2 aspect-auto h-36 w-full"
        role="img"
        aria-label={`Nivel de ${tank.name} al cierre de cada ${scale}${first && last ? `, de ${first.title} a ${last.title}` : ""}${tank.capacityLiters ? `, contra su capacidad de ${litersWhole(tank.capacityLiters)}` : ""}`}
      >
        <LineChart data={rows} margin={MARGIN} accessibilityLayer={false}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="start" hide />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={AXIS_WIDTH}
            tick={TICK}
            tickCount={4}
            domain={[(dataMin: number) => Math.min(0, dataMin), "auto"]}
            tickFormatter={(value: number) => formatCompactQty(value)}
          />
          {shade}
          {negative ? <ReferenceLine y={0} stroke="var(--color-border-strong)" /> : null}
          {tank.capacityLiters ? (
            <ReferenceLine
              y={tank.capacityLiters}
              stroke={CHART_COLORS.neutral}
              strokeDasharray="4 3"
              ifOverflow="extendDomain"
              label={{ value: `Capacidad ${litersWhole(tank.capacityLiters)}`, position: "insideBottomRight", fontSize: 10, fill: "var(--color-text-muted)" }}
            />
          ) : null}
          <ChartTooltip content={<BucketTooltip />} />
          <Line
            dataKey="level"
            name="Nivel al cierre"
            type="stepAfter"
            stroke={CHART_SERIES[0]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            {...motion}
          />
        </LineChart>
      </ChartContainer>

      <ChartContainer
        config={config}
        className="aspect-auto h-24 w-full"
        role="img"
        aria-label={`Litros que entraron y salieron de ${tank.name} por ${scale}: las entradas hacia arriba y las salidas hacia abajo`}
      >
        <BarChart data={rows} margin={MARGIN} accessibilityLayer={false} stackOffset="sign" barCategoryGap="20%">
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="start"
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            tick={TICK}
            minTickGap={28}
            tickFormatter={(start: string) => labelOf.get(start) ?? start}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={AXIS_WIDTH}
            tick={TICK}
            tickCount={3}
            domain={[(dataMin: number) => Math.min(0, dataMin), (dataMax: number) => Math.max(0, dataMax)]}
            tickFormatter={(value: number) => formatCompactQty(Math.abs(value))}
          />
          {shade}
          <ReferenceLine y={0} stroke="var(--color-border-strong)" />
          <ChartTooltip content={<BucketTooltip />} cursor={{ fill: "var(--color-surface-2)" }} />
          <Bar dataKey="inLiters" name="Entradas" stackId="flujo" fill={CHART_SERIES[1]} maxBarSize={14} shape={BucketBar} {...motion} />
          <Bar dataKey="outNegative" name="Salidas" stackId="flujo" fill={CHART_SERIES[2]} maxBarSize={14} shape={BucketBar} {...motion} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

/** Qué es cada trazo, una sola vez para todos los estanques. El color no es lo único: cada serie va nombrada. */
function Legend({ view }: { view: TankLevelView }) {
  const hasCapacity = view.tanks.some((tank) => tank.capacityLiters)
  return (
    <ul className="mb-3 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-xs text-[var(--color-text-muted)]" aria-label="Qué dibuja cada trazo">
      <li className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4" style={{ background: CHART_SERIES[0] }} />Nivel al cierre (L)</li>
      <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-xs" style={{ background: CHART_SERIES[1] }} />Entradas (L), hacia arriba</li>
      <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-xs" style={{ background: CHART_SERIES[2] }} />Salidas (L), hacia abajo</li>
      {hasCapacity ? <li className="flex items-center gap-1.5"><span aria-hidden className="w-4 border-t-2 border-dashed" style={{ borderColor: CHART_COLORS.neutral }} />Capacidad</li> : null}
      {view.partial ? <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-xs" style={{ background: CHART_COLORS.neutral, opacity: 0.4 }} />Lo que falta del período</li> : null}
    </ul>
  )
}

/** Bajo 360 px: la misma información, como lista. */
function TankList({ view }: { view: TankLevelView }) {
  return (
    <ul className="grid list-none gap-2 p-0 text-sm" data-testid="estanque-nivel-lista">
      {view.tanks.map((tank) => (
        <li key={tank.storageLocationId} className="min-w-0">
          <span className="font-medium text-[var(--color-text)]">{tank.name}</span>
          <span className="block text-xs text-[var(--color-text-muted)]">
            De {litersWhole(tank.openingLiters)} a {litersWhole(tank.closingLiters)}: entraron {litersWhole(tank.inLiters)} y salieron {litersWhole(tank.outLiters)}.
          </span>
        </li>
      ))}
    </ul>
  )
}

export function TankLevelChart({ view }: { view: TankLevelView }) {
  const note = tankLevelGranularityNote(view)
  return (
    <div>
      <Legend view={view} />
      <DenseChart fallback={<TankList view={view} />}>
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2" data-testid="estanque-nivel-grafico">
          {view.tanks.map((tank) => <TankPanel key={tank.storageLocationId} tank={tank} view={view} />)}
        </div>
      </DenseChart>
      {note ? <p className="mt-3 text-xs text-[var(--color-text-muted)]">{note}</p> : null}
    </div>
  )
}
