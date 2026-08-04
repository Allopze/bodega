"use client"

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { ChartLineUp } from "@phosphor-icons/react"
import type { HistogramBin } from "@/lib/combustibles/performance-statistics"
import { countOf } from "@/lib/utils"
import { ChartDataTable } from "@/components/ui/chart-data-table"

const BAR_COLOR = "var(--color-primary)"
const MEAN_COLOR = "var(--color-warning-ink)"
const GRID_COLOR = "var(--color-border)"

function chartAxisProps() {
  return { axisLine: false, tickLine: false, tick: { fill: "var(--color-text-muted)", fontSize: 11 } }
}

function EmptyHistogram() {
  return (
    <div className="flex h-64 flex-col items-center justify-center border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-6 text-center">
      <ChartLineUp size={24} className="mb-2 text-[var(--color-text-subtle)]" aria-hidden />
      <p className="max-w-64 text-sm leading-5 text-[var(--color-text-muted)]">Sin observaciones para este filtro.</p>
    </div>
  )
}

export function HistogramChart({ bins, mean, unitLabel }: { bins: HistogramBin[]; mean: number; unitLabel: string }) {
  if (bins.length === 0) return <EmptyHistogram />
  const chartData = bins.map((b) => ({ ...b }))
  // El eje X oculta etiquetas cuando hay más de ocho tramos (`interval`), así
  // que parte de la distribución no se puede leer en el propio gráfico.
  const total = bins.reduce((sum, bin) => sum + bin.count, 0)
  const moda = bins.reduce((current, bin) => bin.count > current.count ? bin : current, bins[0]!)

  return (
    <>
      <ChartDataTable
        title={`Histograma de rendimientos en ${unitLabel}`}
        groupLabel={`Tramo (${unitLabel})`}
        columns={["Observaciones", "Del total"]}
        rows={bins.map((bin) => ({ label: bin.label, values: [bin.count, total === 0 ? "0%" : `${Math.round((bin.count / total) * 100)}%`] }))}
        conclusion={`El tramo más frecuente es ${moda.label} ${unitLabel} con ${countOf(moda.count, "observación")}. Media: ${mean.toFixed(1)} ${unitLabel}.`}
        caption={`${countOf(total, "observación")} en ${bins.length} tramos. Con más de ocho tramos el gráfico oculta parte de las etiquetas del eje.`}
        className="mb-4 mt-0 border-b border-t-0 pb-3 pt-0"
      />
    <div className="h-72" aria-label={`Histograma de rendimientos en ${unitLabel}`}>
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <BarChart data={chartData} margin={{ top: 4, right: 12, left: -8, bottom: 40 }}>
          <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="2 5" />
          <XAxis dataKey="label" interval={Math.max(0, Math.floor(bins.length / 8))} angle={bins.length > 6 ? -30 : 0} textAnchor="end" height={bins.length > 6 ? 56 : 32} {...chartAxisProps()} />
          <YAxis width={36} allowDecimals={false} {...chartAxisProps()} />
          <ReferenceLine x={mean} stroke={MEAN_COLOR} strokeDasharray="3 3" strokeWidth={1.5} label={{ value: `Media ${mean.toFixed(1)}`, position: "top", fill: MEAN_COLOR, fontSize: 10 }} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const bin = payload[0]!.payload as HistogramBin
              return (
                <div className="border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-md)] text-xs">
                  <p className="font-semibold text-[var(--color-text)]">{bin.label} {unitLabel}</p>
                  <p className="text-[var(--color-text-muted)]">{countOf(bin.count, "observación")}</p>
                </div>
              )
            }}
          />
          <Bar dataKey="count" fill={BAR_COLOR} radius={[2, 2, 0, 0]} maxBarSize={32} animationDuration={420} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}
