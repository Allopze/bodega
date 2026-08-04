"use client"

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { ChartLineUp } from "@phosphor-icons/react"
import type { VehicleEvolutionPoint } from "@/lib/combustibles/consumption-dashboard"
import { ChartDataTable } from "@/components/ui/chart-data-table"

const COLORS = [
  "var(--color-primary)", "var(--color-info)", "var(--color-success)", "var(--color-warning-ink)", "var(--color-signal-ink)",
  "var(--color-purple)", "var(--color-danger)", "var(--color-teal)",
]
const GRID_COLOR = "var(--color-border)"

function chartAxisProps() {
  return { axisLine: false, tickLine: false, tick: { fill: "var(--color-text-muted)", fontSize: 11 } }
}

function EmptyEvolution() {
  return (
    <div className="flex h-72 flex-col items-center justify-center border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-6 text-center">
      <ChartLineUp size={24} className="mb-2 text-[var(--color-text-subtle)]" aria-hidden />
      <p className="max-w-64 text-sm leading-5 text-[var(--color-text-muted)]">Sin datos de evolución para este filtro.</p>
    </div>
  )
}

/** Convierte una lista plana de puntos (periodo, patente, litros) al formato
 *  multi-serie que Recharts espera: una fila por período con columnas por patente. */
function pivotByPeriod(points: VehicleEvolutionPoint[], maxSeries = 8) {
  // Agrupar por patente para identificar top N por consumo total
  const byPlate = new Map<string, { label: string; total: number }>()
  for (const p of points) {
    const entry = byPlate.get(p.plate) ?? { label: p.vehicleCode ? `${p.vehicleCode} (${p.plate})` : p.plate, total: 0 }
    entry.total += p.liters
    byPlate.set(p.plate, entry)
  }
  const topPlates = [...byPlate.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, maxSeries)

  // Pivot: periodo → { periodo, patente1, patente2, ... }
  const byPeriod = new Map<string, Record<string, number>>()
  for (const p of points) {
    if (!topPlates.some(([plate]) => plate === p.plate)) continue
    const row = byPeriod.get(p.periodo) ?? {}
    row[p.plate] = (row[p.plate] ?? 0) + p.liters
    byPeriod.set(p.periodo, row)
  }

  const data = [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, values]) => {
      const entry: Record<string, unknown> = { periodo }
      for (const [plate] of topPlates) entry[plate] = values[plate] ?? null
      return entry
    })

  return { data, plates: topPlates.map(([plate, info]) => ({ key: plate, label: info.label, total: info.total })) }
}

function formatPeriod(period: unknown): string {
  const value = String(period ?? "")
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  const shortMonths = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
  return `${Number(match[3])} ${shortMonths[Number(match[2]) - 1]}`
}

export function EvolutionByVehicleChart({ points, maxSeries = 8 }: { points: VehicleEvolutionPoint[]; maxSeries?: number }) {
  const { data, plates } = pivotByPeriod(points, maxSeries)
  if (data.length === 0 || plates.length === 0) return <EmptyEvolution />

  // Ocho líneas del mismo grosor separadas sólo por color, y la leyenda
  // **desaparece** por encima de seis series: sin tabla no hay forma de saber
  // qué equipo es cada línea, ni con vista perfecta.
  const litros = (value: number) => `${Math.round(value).toLocaleString("es-CL")} L`
  const primerPeriodo = data[0]?.periodo
  const ultimoPeriodo = data[data.length - 1]?.periodo
  const filas = plates.map((plate) => {
    const inicio = Number(data[0]?.[plate.key] ?? 0)
    const fin = Number(data[data.length - 1]?.[plate.key] ?? 0)
    return { plate, inicio, fin, delta: fin - inicio }
  })
  const mayorAlza = filas.reduce((current, row) => row.delta > current.delta ? row : current, filas[0]!)
  const lider = filas.reduce((current, row) => row.plate.total > current.plate.total ? row : current, filas[0]!)

  return (
    <>
      <ChartDataTable
        title="Evolución de consumo por equipo"
        groupLabel="Equipo"
        columns={["Total", `Inicio (${formatPeriod(primerPeriodo)})`, `Fin (${formatPeriod(ultimoPeriodo)})`, "Variación"]}
        rows={filas.map((row) => ({
          label: row.plate.label,
          values: [litros(row.plate.total), litros(row.inicio), litros(row.fin), `${row.delta >= 0 ? "+" : "−"}${litros(Math.abs(row.delta))}`],
        }))}
        conclusion={filas.length === 1
          ? `Único equipo en el período: ${lider.plate.label}, ${litros(lider.plate.total)}.`
          : `${lider.plate.label} es el de mayor consumo total (${litros(lider.plate.total)}); el mayor aumento entre extremos es ${mayorAlza.plate.label}.`}
        caption={plates.length > 6
          ? "Con más de seis equipos el gráfico oculta su leyenda: esta tabla es la única forma de identificar cada línea."
          : "Comparación entre el primer y el último período del filtro."}
        className="mb-4 mt-0 border-b border-t-0 pb-3 pt-0"
      />
    <div className="h-80" aria-label="Evolución de consumo por equipo">
      <ResponsiveContainer width="100%" height="100%" debounce={200}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 20 }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="2 5" />
          <XAxis dataKey="periodo" tickFormatter={(v: unknown) => formatPeriod(String(v ?? ""))} interval="preserveStartEnd" {...chartAxisProps()} />
          <YAxis width={44} tickFormatter={(v) => `${Math.round(v / 100) * 100}`} {...chartAxisProps()} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div className="min-w-36 border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-md)] text-xs">
                  <p className="mb-1.5 font-semibold text-[var(--color-text)]">{formatPeriod(label ?? "")}</p>
                  {payload.filter((e) => e.value != null).map((entry) => (
                    <div key={entry.dataKey ? String(entry.dataKey) : entry.name} className="flex justify-between gap-4">
                      <span className="text-[var(--color-text-muted)]">{entry.name}</span>
                      <span className="font-mono">{Number(entry.value).toLocaleString("es-CL")} L</span>
                    </div>
                  ))}
                </div>
              )
            }}
          />
          {plates.map((plate, i) => (
            <Line
              key={plate.key}
              type="monotone"
              dataKey={plate.key}
              name={plate.label}
              stroke={COLORS[i % COLORS.length]!}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls
            />
          ))}
          {plates.length <= 6 && (
            <Legend
              formatter={(value: string) => <span className="text-xs text-[var(--color-text-muted)]">{value}</span>}
              iconType="line"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}
