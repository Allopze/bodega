"use client"
import { ChartEmpty } from "@/components/ui/chart-empty"

import { useRouter } from "next/navigation"
import { BarChart, Bar, Cell, ErrorBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { ChartLineUp } from "@phosphor-icons/react"
import type { PerformanceGroup } from "@/lib/combustibles/equipment-performance"

const NORMAL_COLOR = "var(--color-primary)"
const LOW_RELIABILITY_COLOR = "var(--color-warning-ink)"
const GRID_COLOR = "var(--color-border)"
const UNIT_LABEL: Record<string, string> = { km_per_liter: "km/L", liters_per_hour: "L/h" }

function chartAxisProps() {
  return { axisLine: false, tickLine: false, tick: { fill: "var(--color-text-muted)", fontSize: 11 } }
}

function truncate(label: string, max = 18) {
  return label.length > max ? `${label.slice(0, max)}…` : label
}


/**
 * Barra de rendimiento medio por grupo, con la desviación estándar como barra de
 * error y el rango esperado del grupo comparable como línea de referencia. Nunca
 * mezcla unidades: se le pasan sólo los grupos de una unidad — el llamador ya
 * separó km/L de L/h antes de renderizar (equipment-performance.ts lo garantiza).
 */
export function PerformanceGroupChart({ groups, drilldownHref }: { groups: PerformanceGroup[]; drilldownHref: (group: PerformanceGroup) => string }) {
  const router = useRouter()
  if (groups.length === 0) return <ChartEmpty icon={<ChartLineUp size={24} className="mb-2 text-[var(--color-text-subtle)]" aria-hidden />} className="border-[var(--color-border-strong)]" label="Sin observaciones de rendimiento para este filtro." />

  const unit = groups[0]!.unit
  const unitLabel = UNIT_LABEL[unit] ?? unit
  const chartData = groups.slice(0, 12).map((group) => ({
    name: truncate(group.label, 16),
    mean: group.stats.mean,
    // Simétrico: Recharts calcula [mean - stdDev, mean + stdDev] a partir de este único valor.
    stdDev: group.stats.stdDev,
    reliability: group.reliability,
    count: group.stats.count,
    group,
  }))
  // Línea de referencia: promedio del rango esperado combinado (si todos los
  // grupos visibles comparten uno) — evita una banda distinta por barra, que
  // en Recharts sólo se puede dibujar como líneas horizontales de ancho fijo.
  const expectedRanges = groups.map((g) => g.expectedRange).filter((r): r is { low: number; high: number } => r != null)
  const commonExpected = expectedRanges.length === groups.length && expectedRanges.length > 0
    ? { low: Math.min(...expectedRanges.map((r) => r.low)), high: Math.max(...expectedRanges.map((r) => r.high)) }
    : null


  return (
    <>
    <div className="h-72" aria-label={`Rendimiento medio por grupo, en ${unitLabel}`}>
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 12, left: -8, bottom: 40 }}
          title={`Rendimiento medio por grupo (${unitLabel}). Las barras ámbar tienen muestra insuficiente o baja confiabilidad. Selecciona una barra para ver sus cargas.`}
        >
          <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="2 5" />
          <XAxis dataKey="name" interval={0} angle={-30} textAnchor="end" height={56} {...chartAxisProps()} />
          <YAxis width={44} tickFormatter={(v) => Number(v).toFixed(1)} {...chartAxisProps()} />
          {commonExpected && <ReferenceLine y={commonExpected.low} stroke="var(--color-text-subtle)" strokeDasharray="4 4" />}
          {commonExpected && <ReferenceLine y={commonExpected.high} stroke="var(--color-text-subtle)" strokeDasharray="4 4" />}
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const point = payload[0]!.payload as (typeof chartData)[number]
              return (
                <div className="min-w-44 border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-md)] text-xs">
                  <p className="mb-1.5 font-semibold text-[var(--color-text)]">{point.group.label}</p>
                  <div className="flex justify-between gap-4"><span className="text-[var(--color-text-muted)]">Promedio</span><span className="font-mono">{point.mean} {unitLabel}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-[var(--color-text-muted)]">Desv. estándar</span><span className="font-mono">±{point.group.stats.stdDev}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-[var(--color-text-muted)]">Observaciones</span><span className="font-mono">{point.count}</span></div>
                  {point.reliability === "insuficiente" && <p className="mt-1 text-[var(--color-warning-ink)]">Muestra no concluyente</p>}
                </div>
              )
            }}
          />
          <Bar
            dataKey="mean"
            radius={[2, 2, 0, 0]}
            name="Rendimiento medio"
            maxBarSize={34}
            style={{ cursor: "pointer" }}
            onClick={(entry) => router.push(drilldownHref((entry as unknown as { payload: { group: PerformanceGroup } }).payload.group))}
            animationDuration={420}
            animationEasing="ease-out"
          >
            <ErrorBar dataKey="stdDev" direction="y" width={4} strokeWidth={1.5} stroke="var(--color-text-subtle)" />
            {chartData.map((point) => <Cell key={point.group.key} fill={point.reliability === "confiable" ? NORMAL_COLOR : LOW_RELIABILITY_COLOR} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    </>
  )
}
