"use client"

import * as React from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { formatCLP, formatCompactCLP } from "@/lib/utils"
import { CHART_COLORS, CHART_SERIES } from "@/lib/chart-palette"


const workloadChartConfig = {
  count: {
    label: "Tareas Pendientes",
    color: CHART_COLORS.blue,
  },
} satisfies ChartConfig

const worksiteChartConfig = {
  totalCost: {
    label: "Inversión Acumulada",
    color: CHART_COLORS.brand,
  },
} satisfies ChartConfig

// ── 2. Workload Distribution Bar Chart ────────────────────────────────────────

export interface ModuleWorkloadPoint {
  module: string
  count: number
}

/**
 * Distribución del backlog **completo** por módulo.
 *
 * Antes agrupaba las filas cargadas en la cola del dashboard (25 de N) y
 * rotulaba el muestreo como si fuera el total (D-02). Ahora recibe
 * `queue.summary.moduleCounts`, que el servicio calcula sobre toda la
 * población autorizada.
 */
export function ModuleWorkloadChart({ data, total }: { data: ModuleWorkloadPoint[]; total: number }) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const counts = React.useMemo(() => [...data].sort((a, b) => b.count - a.count), [data])
  if (counts.length === 0) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Distribución por Módulo</h3>
          <p className="text-xs text-[var(--color-text-muted)]">Pendiente al día de hoy</p>
        </div>
        <span className="font-mono text-xs font-semibold text-[var(--color-text-muted)]">
          {total} {total === 1 ? "tarea" : "tareas"}
        </span>
      </div>

      <ChartContainer config={workloadChartConfig} className="h-48 w-full">
        <BarChart
          aria-label="Distribución por Módulo"
          data={counts}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          onMouseLeave={() => setActiveIndex(null)}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="module" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, _name, item) => {
                  const count = Number(value)
                  const moduleName = String(item?.payload?.module ?? "")
                  const share = total > 0 ? ` (${Math.round((count / total) * 100)}%)` : ""
                  return `${moduleName}: ${count} ${count === 1 ? "tarea" : "tareas"}${share}`
                }}
              />
            }
          />
          {/* Cada módulo recibe un color diferenciado y armónico con micro-interacción de foco en hover. */}
          <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
            {counts.map((entry, index) => (
              <Cell
                key={entry.module || index}
                fill={CHART_SERIES[index % CHART_SERIES.length]}
                opacity={activeIndex === null || activeIndex === index ? 1 : 0.35}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                className="cursor-pointer transition-opacity duration-200"
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}


// ── 6. Worksite Activity Horizontal Bar Chart ─────────────────────────────────

/**
 * Sólo pide lo que dibuja. Antes recibía las 6 columnas de `worksitesBreakdown`
 * y mapeaba `requestsCount`/`pendingCount` a un `data` donde ninguna serie las
 * leía: campos muertos que hacían creer que la tarjeta comparaba más de una
 * dimensión.
 */
export function WorksiteActivityChart({
  worksites,
}: {
  worksites: { name: string; totalCost: number }[]
}) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  if (worksites.length === 0) return null

  // `getDashboardData` ya devuelve ordenado por `totalCost` descendente, así que
  // acá sólo se corta el top-N. Reordenar era trabajo repetido en el cliente.
  const data = worksites.slice(0, 6)

  const hasCost = data.some((d) => d.totalCost > 0)
  if (!hasCost) return null

  const totalCostSum = data.reduce((sum, d) => sum + d.totalCost, 0)

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Inversión por Faena</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Monto comprometido por centro de costos (acumulado histórico)</p>
      </div>

      <ChartContainer config={worksiteChartConfig} className="h-56 w-full">
        <BarChart
          aria-label="Inversión por Faena"
          data={data}
          layout="vertical"
          margin={{ top: 10, right: 15, left: 10, bottom: 0 }}
          onMouseLeave={() => setActiveIndex(null)}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCompactCLP}
          />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            width={110}
            tick={{ fontSize: 11 }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, _name, item) => {
                  const cost = Number(value)
                  const name = String(item?.payload?.name ?? "")
                  const share = totalCostSum > 0 ? ` (${Math.round((cost / totalCostSum) * 100)}%)` : ""
                  return `${name}: ${formatCLP(cost)}${share}`
                }}
              />
            }
          />
          {/* barSize acotado: con 1-2 faenas la barra ocupaba ~150px de grosor. Cada faena recibe un color diferenciado con foco en hover. */}
          <Bar dataKey="totalCost" radius={[0, 6, 6, 0]} barSize={22}>
            {data.map((entry, index) => (
              <Cell
                key={entry.name || index}
                fill={CHART_SERIES[index % CHART_SERIES.length]}
                opacity={activeIndex === null || activeIndex === index ? 1 : 0.35}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                className="cursor-pointer transition-opacity duration-200"
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}


// ── 10. Barra horizontal con semáforo por umbral ─────────────────────────────

export interface ThresholdBar {
  name: string
  value: number
  /** Texto de apoyo del tooltip: "12 de 15 ejecutadas". */
  detail?: string
}

/**
 * Ranking horizontal donde **el color codifica el umbral**, no la categoría.
 *
 * Patrón tomado de `pdtp-dashboard-charts.tsx`, donde ya se usaba para
 * cumplimiento por faena. Sirve para cualquier "% contra meta" y para déficits:
 * el largo ordena y el color dice si está bien, en el límite o mal, sin obligar
 * a leer el eje.
 */
export function ThresholdRankingChart({
  data,
  title,
  description,
  unit = "%",
  format = "plain",
  goodAtOrAbove = 80,
  warnAtOrAbove = 50,
  invert = false,
  max,
  colorMode,
}: {
  data: ThresholdBar[]
  title: string
  description: string
  unit?: string
  /**
   * `"clp"` formatea eje y tooltip como dinero. Sin esto, un ranking de gasto
   * mostraba "31416" pelado en el eje — lo destapó la pasada visual.
   * Discriminador y no función: lo instancia un Server Component.
   */
  format?: "plain" | "clp"
  goodAtOrAbove?: number
  warnAtOrAbove?: number
  /** `true` cuando más alto es peor (déficit de stock, atrasos). */
  invert?: boolean
  max?: number
  colorMode?: "threshold" | "palette"
}) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const rows = React.useMemo(
    () => [...data].sort((left, right) => (invert ? right.value - left.value : left.value - right.value)).slice(-8),
    [data, invert],
  )
  if (rows.length === 0) return null

  const isThreshold = colorMode
    ? colorMode === "threshold"
    : Number.isFinite(goodAtOrAbove) && Number.isFinite(warnAtOrAbove)

  const totalSum = rows.reduce((sum, r) => sum + r.value, 0)

  const colorFor = (value: number, index: number) => {
    if (isThreshold) {
      if (invert) {
        if (value >= goodAtOrAbove) return CHART_COLORS.danger
        if (value >= warnAtOrAbove) return CHART_COLORS.signal
        return CHART_COLORS.brand
      }
      if (value >= goodAtOrAbove) return CHART_COLORS.brand
      if (value >= warnAtOrAbove) return CHART_COLORS.signal
      return CHART_COLORS.danger
    }
    return CHART_SERIES[index % CHART_SERIES.length]
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </div>

      {rows.length <= 2 ? (
        /* I-09: 1-2 barras dentro de un plot de 224 px eran una tarjeta casi
           vacía. La misma lectura cabe en un medidor compacto por fila; el
           color sigue codificando el umbral y la tabla de arriba ya da el
           detalle exacto. */
        <div className="space-y-3">
          {rows.map((row, index) => {
            const shown = format === "clp" ? formatCLP(row.value) : `${row.value}${unit}`
            const scale = max ?? (unit === "%" ? 100 : null)
            const color = colorFor(row.value, index)
            return (
              <div key={index}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--color-text)]">{row.name}</span>
                  <span className="font-mono text-lg font-bold" style={{ color }}>{shown}</span>
                </div>
                {scale !== null && (
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]" aria-hidden>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (row.value / scale) * 100)}%`, background: color }} />
                  </div>
                )}
                {row.detail && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{row.detail}</p>}
              </div>
            )
          })}
        </div>
      ) : (
      <ChartContainer config={{ value: { label: title } }} className="h-56 w-full">
        <BarChart
          aria-label={title}
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
          onMouseLeave={() => setActiveIndex(null)}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" domain={[0, max ?? (unit === "%" ? 100 : "dataMax")]} tickFormatter={(value) => (format === "clp" ? formatCompactCLP(Number(value)) : `${value}${unit}`)} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={116} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(value, _name, item) => {
            const val = Number(value)
            const shown = format === "clp" ? formatCLP(val) : `${val}${unit}`
            const name = String(item?.payload?.name ?? "")
            const detail = item?.payload?.detail ? ` · ${String(item.payload.detail)}` : ""
            const share = !isThreshold && totalSum > 0 ? ` (${Math.round((val / totalSum) * 100)}%)` : ""
            return `${name}: ${shown}${share}${detail}`
          }} />} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
            {/* Key posicional: `row.name` puede repetirse (dos personas con el
                mismo nombre completo) y React descartaba una barra (UI/UX
                2026-08-05, C3). Las Cell son 1:1 con `rows`, el índice es estable. */}
            {rows.map((row, index) => (
              <Cell
                key={index}
                fill={colorFor(row.value, index)}
                opacity={activeIndex === null || activeIndex === index ? 1 : 0.35}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                className="cursor-pointer transition-opacity duration-200"
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      )}
    </div>
  )
}
