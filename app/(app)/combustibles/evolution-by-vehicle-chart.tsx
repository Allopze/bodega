"use client"

import Link from "next/link"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig, type ChartTooltipItem } from "@/components/ui/chart"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { CHART_COLORS } from "@/lib/chart-palette"
import { fuelEquipmentHref } from "@/lib/combustibles/routes"
import type { EvolutionPanel, EvolutionPanels } from "@/lib/combustibles/evolution-panels"
import { MONTH_LABELS, formatQty } from "@/lib/utils"
import { AXIS_TICK, compactNumber } from "./control/_charts/chart-shared"

/**
 * Evolución por equipo como *small multiples*: un panel por equipo, con el mismo
 * eje de tiempo y la misma escala vertical en todos. La comparación entre equipos
 * se hace por posición (qué línea sube más, cuál es más alta) y no por color; por
 * eso todas las líneas van en el color de la marca: el título del panel es lo que
 * identifica al equipo, y nunca hay más series que colores.
 *
 * Cada panel es una figura. Su dibujo es una imagen (`role="img"`) con nombre, y el
 * título —que enlaza a la ficha del equipo— queda **fuera** de ella: un enlace
 * dentro de una imagen no es accesible (axe `nested-interactive`).
 * Un período sin registro del equipo corta la línea (no es 0 L); con un punto
 * marcado en cada período con registro, un registro suelto también se ve.
 */

const config = { liters: { label: "Litros", color: CHART_COLORS.brand } } satisfies ChartConfig

const PERIOD_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `{ year, month, day }` de un período («YYYY-MM-DD»), o `null` si no es una fecha. */
function parts(period: string): { year: string; month: string; day: number } | null {
  const match = PERIOD_DATE.exec(period)
  if (!match) return null
  const month = (MONTH_LABELS[Number(match[2]) - 1] ?? match[2] ?? "").toLowerCase()
  return { year: match[1] ?? "", month, day: Number(match[3]) }
}

/** «1 jul 2026», para el tooltip y el nombre accesible: el período es una fecha («YYYY-MM-DD»). */
function periodLabel(period: string): string {
  const date = parts(period)
  return date ? `${date.day} ${date.month} ${date.year}` : period
}

/** «jul 26» cuando los períodos son meses (siempre el día 1), si no «1 jul». */
function tickLabel(period: string, monthly: boolean): string {
  const date = parts(period)
  if (!date) return period
  return monthly ? `${date.month} ${date.year.slice(2)}` : `${date.day} ${date.month}`
}

const liters = (value: number) => `${formatQty(value, undefined, { maximumFractionDigits: 0 })} L`

function PanelTooltip({ active, payload }: { active?: boolean; payload?: ChartTooltipItem[] }) {
  const row = payload?.[0]?.payload as { periodo: string; liters: number | null } | undefined
  if (!active || !row) return null
  return (
    <div className="border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs shadow-[var(--shadow-md)]">
      <p className="font-semibold text-[var(--color-text)]">{periodLabel(row.periodo)}</p>
      <p className="font-mono tabular-nums text-[var(--color-text)]">{row.liters === null ? "Sin registro" : liters(row.liters)}</p>
    </div>
  )
}

function Panel({ panel, periods, axisMax }: { panel: EvolutionPanel; periods: string[]; axisMax: number }) {
  const monthly = periods.every((period) => period.endsWith("-01"))
  const first = panel.series.find((item) => item.liters !== null)
  const last = [...panel.series].reverse().find((item) => item.liters !== null)
  const range = first && last && first !== last ? `, de ${liters(first.liters!)} el ${periodLabel(first.periodo)} a ${liters(last.liters!)} el ${periodLabel(last.periodo)}` : ""
  const name = `Litros por período de ${panel.label}, ${liters(panel.total)} en total${range}`
  const href = panel.vehicleId ? fuelEquipmentHref(panel.vehicleId) : null

  return (
    <figure className="m-0 min-w-0">
      <figcaption className="mb-1 flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--color-text)]">
          {href ? (
            <Link href={href} className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" title="Abrir la ficha del equipo">{panel.label}</Link>
          ) : panel.label}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{liters(panel.total)}</span>
      </figcaption>
      <ChartContainer config={config} className="aspect-auto h-32 w-full" role="img" aria-label={name}>
        <LineChart data={panel.series} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} strokeDasharray="2 5" />
          <XAxis
            dataKey="periodo" tickLine={false} axisLine={false} tick={{ ...AXIS_TICK, fontSize: 10 }} interval="preserveStartEnd" minTickGap={16}
            tickFormatter={(value: string) => tickLabel(value, monthly)}
          />
          <YAxis domain={[0, axisMax]} tickLine={false} axisLine={false} width={34} tick={{ ...AXIS_TICK, fontSize: 10 }} tickCount={3} tickFormatter={compactNumber} />
          <ChartTooltip cursor={false} isAnimationActive={false} filterNull={false} content={<PanelTooltip />} />
          <Line
            dataKey="liters" type="linear" stroke={CHART_COLORS.brand} strokeWidth={2} connectNulls={false} isAnimationActive={false}
            dot={{ r: 2.5, fill: CHART_COLORS.brand, stroke: CHART_COLORS.brand }} activeDot={{ r: 4 }}
          />
        </LineChart>
      </ChartContainer>
    </figure>
  )
}

export function EvolutionByVehicleChart({ view }: { view: EvolutionPanels }) {
  if (view.panels.length === 0) {
    return <ChartEmpty className="h-48" label="Sin litros por equipo en estos períodos" hint="Aparecen cuando hay reportes de tarjeta con litros de equipos de la flota o de patentes con consumo." />
  }
  if (view.periods.length < 2) {
    return <ChartEmpty className="h-48" label="Hace falta más de un período para ver la evolución" hint="Los reportes de tarjeta traen un total por mes: amplía el período a varios meses para ver cómo cambia cada equipo." />
  }
  return (
    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
      {view.panels.map((panel) => <Panel key={panel.plate} panel={panel} periods={view.periods} axisMax={view.axisMax} />)}
    </div>
  )
}
