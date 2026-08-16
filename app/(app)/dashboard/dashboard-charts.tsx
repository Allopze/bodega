"use client"

import * as React from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { formatCLP } from "@/lib/utils"
import { CHART_COLORS, CHART_SERIES } from "@/lib/chart-palette"

// ── Configuration for Charts ──────────────────────────────────────────────────

const trendChartConfig = {
  requests: {
    label: "Solicitudes",
    color: CHART_COLORS.blue,
  },
  orders: {
    label: "OC Emitidas",
    color: CHART_COLORS.violet,
  },
  receipts: {
    label: "Recepciones",
    color: CHART_COLORS.brand,
  },
} satisfies ChartConfig

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

const sstChartConfig = {
  tasaFrecuencia: {
    label: "Tasa de Frecuencia (TF)",
    color: CHART_COLORS.blue,
  },
  tasaGravedad: {
    label: "Tasa de Gravedad (TG)",
    color: CHART_COLORS.danger,
  },
} satisfies ChartConfig

/**
 * Accidentes por estado de calificación, **no** por gravedad.
 *
 * Antes rotulaba "Accidentes CTP / STP" dos series que salían de `confirmed` y
 * `provisional`, y esas no son clases de gravedad: `provisional` es
 * confirmados **más** pendientes (`safety-indicators-calc.ts:217-219`), o sea un
 * superconjunto. El gráfico mostraba la barra chica contenida dentro de la
 * grande como si fueran categorías excluyentes, y ninguna de las dos tenía que
 * ver con tiempo perdido.
 *
 * `IndicatorMetricSet` no expone desglose de tiempo perdido — el dato existe a
 * nivel de caso (`absenceAtLeastNormalShift`) pero el motor canónico no lo
 * agrega. Así que el gráfico deja de prometerlo y grafica la partición que sí
 * es real y sí le sirve a gerencia: cuánto del total ya está confirmado y
 * cuánto sigue por calificar.
 */
const sstAccidentConfig = {
  confirmados: {
    label: "Confirmados",
    color: CHART_COLORS.danger,
  },
  porCalificar: {
    label: "Por calificar",
    color: CHART_COLORS.signal,
  },
} satisfies ChartConfig

const materialEnvConfig = {
  dangerousIncidents: {
    label: "Inc. Peligrosos",
    color: CHART_COLORS.violet,
  },
  materialDamage: {
    label: "Daño Material",
    color: CHART_COLORS.signal,
  },
  environmentalSpills: {
    label: "Daño Ambiental",
    color: CHART_COLORS.teal,
  },
} satisfies ChartConfig

/**
 * Formato compacto para ejes de dinero: `formatCLP` completo no cabe en un tick
 * de 52px y obliga a rotarlo. El valor exacto vive en el tooltip.
 */
function compactCLPTick(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}k`
  return `$${value}`
}

const fuelChartConfig = {
  liters: {
    label: "Litros",
    color: CHART_COLORS.signal,
  },
  amount: {
    label: "Costo",
    color: CHART_COLORS.brand,
  },
  loads: {
    label: "Cargas",
    color: CHART_COLORS.teal,
  },
} satisfies ChartConfig

const billingFlowConfig = {
  invoiced:  { label: "Facturado", color: CHART_COLORS.brand },
  collected: { label: "Cobrado",   color: CHART_COLORS.blue },
} satisfies ChartConfig

const maintenanceChartConfig = {
  completed: {
    label: "Completadas",
    color: CHART_COLORS.brand,
  },
  scheduled: {
    label: "Programadas",
    color: CHART_COLORS.blue,
  },
  amount: {
    label: "Costo",
    color: CHART_COLORS.violet,
  },
} satisfies ChartConfig

export interface SstMonthlyPoint {
  month: string
  tasaFrecuencia: number
  tasaGravedad: number
  /** Incidentes con todos sus casos incluidos (`confirmed.accidents`). */
  confirmados: number
  /** Incidentes que sólo tienen casos pendientes: `provisional − confirmed`. */
  porCalificar: number
}

export interface MaterialEnvironmentalPoint {
  month: string
  dangerousIncidents: number
  materialDamage: number
  environmentalSpills: number
}

// ── 1. Operational Trend Area Chart (supports 6+ data points) ───────────────

export function OperationalTrendChart({ data }: { data: Array<{ month: string; requests: number; orders: number; receipts: number }> }) {
  // Todo-en-cero también se oculta: una rejilla vacía con conclusión absurda
  // ("el mes de mayor actividad es Mar: 0") es peor que nada (I-03).
  if (!data.some((row) => row.requests + row.orders + row.receipts > 0)) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Tendencia Operativa</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Solicitudes, órdenes y recepciones (últimos 6 meses)</p>
      </div>

      <ChartContainer config={trendChartConfig} className="h-48 w-full">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="fillRequests" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_COLORS.blue} stopOpacity={0.35} />
              <stop offset="95%" stopColor={CHART_COLORS.blue} stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="fillOrders" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_COLORS.violet} stopOpacity={0.35} />
              <stop offset="95%" stopColor={CHART_COLORS.violet} stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="fillReceipts" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_COLORS.brand} stopOpacity={0.35} />
              <stop offset="95%" stopColor={CHART_COLORS.brand} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Area type="monotone" dataKey="requests" stroke={CHART_COLORS.blue} strokeWidth={2} fillOpacity={1} fill="url(#fillRequests)" />
          <Area type="monotone" dataKey="orders" stroke={CHART_COLORS.violet} strokeWidth={2} fillOpacity={1} fill="url(#fillOrders)" />
          <Area type="monotone" dataKey="receipts" stroke={CHART_COLORS.brand} strokeWidth={2} fillOpacity={1} fill="url(#fillReceipts)" />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}

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
          <p className="text-xs text-[var(--color-text-muted)]">Backlog pendiente al día de hoy</p>
        </div>
        <span className="font-mono text-xs font-semibold text-[var(--color-text-muted)]">
          {total} {total === 1 ? "tarea" : "tareas"}
        </span>
      </div>

      <ChartContainer config={workloadChartConfig} className="h-48 w-full">
        <BarChart
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

// ── 3. SST Trend Chart (Tasa Frecuencia y Tasa Gravedad) ─────────────────────

/**
 * Un eje por tasa. Comparten el rótulo "× 1.000.000 / HH" pero no la escala: la
 * de gravedad cuenta **días** perdidos y de cargo, la de frecuencia cuenta
 * **personas** lesionadas (`safety-indicators-calc.ts:187-188`). Un accidente
 * con 30 días de reposo mueve TG dos órdenes de magnitud más que TF, y en un eje
 * común la línea de frecuencia se aplanaba contra el cero.
 */
export function SstTrendChart({ data }: { data: SstMonthlyPoint[] }) {
  // Ambas tasas en cero todo el año: no hay línea que leer (I-03).
  if (!data.some((row) => row.tasaFrecuencia > 0 || row.tasaGravedad > 0)) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Tasas de Siniestralidad SST</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Tasa de Frecuencia (izq.) y Tasa de Gravedad (der.), cada una en su escala</p>
      </div>

      <ChartContainer config={sstChartConfig} className="h-48 w-full">
        <LineChart data={data} margin={{ top: 10, right: 6, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis yAxisId="tf" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis yAxisId="tg" orientation="right" tickLine={false} axisLine={false} tickMargin={4} width={44} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Line yAxisId="tf" type="monotone" dataKey="tasaFrecuencia" stroke={CHART_COLORS.blue} strokeWidth={2} dot={{ r: 3 }} />
          <Line yAxisId="tg" type="monotone" dataKey="tasaGravedad" stroke={CHART_COLORS.danger} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ChartContainer>
    </div>
  )
}

// ── 4. SST Accident Qualification Chart ──────────────────────────────────────

/**
 * Barra **apilada**: el alto de la columna es el total provisional del mes y los
 * segmentos lo parten en confirmado y por calificar. Apilado y no agrupado
 * porque las dos series son partes de un mismo total, no magnitudes a comparar
 * (ver `sstAccidentConfig`).
 */
export function SstAccidentChart({ data }: { data: SstMonthlyPoint[] }) {
  // Sin accidentes en el año la tarjeta pintaba sólo ejes y gridlines, con la
  // descripción "todos están confirmados" hablando de un conjunto vacío (I-03).
  if (!data.some((point) => point.confirmados + point.porCalificar > 0)) return null

  const hasPending = data.some((point) => point.porCalificar > 0)

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Accidentes por estado de calificación</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          {hasPending
            ? "Confirmados y pendientes por calificar en cada mes"
            : "Todos los accidentes del período están confirmados"}
        </p>
      </div>

      <ChartContainer config={sstAccidentConfig} className="h-48 w-full">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          {/* Un solo `stackId`: el tope de la columna es el total provisional. */}
          <Bar dataKey="confirmados" stackId="accidentes" fill={CHART_COLORS.danger} radius={hasPending ? [0, 0, 0, 0] : [4, 4, 0, 0]} maxBarSize={48} />
          <Bar dataKey="porCalificar" stackId="accidentes" fill={CHART_COLORS.signal} radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── 5. Material & Environmental Chart ───────────────────────────────────────

export function MaterialEnvironmentalChart({ data }: { data: MaterialEnvironmentalPoint[] }) {
  // Todo-en-cero → rejilla vacía + "el mes con más eventos es Ene" (I-03).
  if (!data.some((row) => row.dangerousIncidents + row.materialDamage + row.environmentalSpills > 0)) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Impacto Material y Ambiental</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Incidentes peligrosos, daños materiales y derrames ambientales</p>
      </div>

      <ChartContainer config={materialEnvConfig} className="h-48 w-full">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="dangerousIncidents" fill={CHART_COLORS.violet} radius={[4, 4, 0, 0]} maxBarSize={48} />
          <Bar dataKey="materialDamage" fill={CHART_COLORS.signal} radius={[4, 4, 0, 0]} maxBarSize={48} />
          <Bar dataKey="environmentalSpills" fill={CHART_COLORS.teal} radius={[4, 4, 0, 0]} maxBarSize={48} />
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
            tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
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

// ── 7. Fuel Consumption Chart ────────────────────────────────────────────────

export interface FuelMonthlyChartPoint {
  month: string
  liters: number
  amount: number
  loads: number
}

/**
 * Litros (barra, eje izquierdo) y costo (línea, eje derecho).
 *
 * Antes eran dos barras —litros y cargas— **en el mismo eje Y**: litros va en
 * miles y cargas en decenas, así que la serie "Cargas" quedaba pegada al piso e
 * ilegible. Y el costo, que es lo que gerencia mira, se consultaba en
 * `getFuelMonthlyTrend` y se descartaba.
 *
 * Las cargas siguen disponibles en el tooltip, que es donde una cifra de apoyo
 * no compite por escala con nada.
 */
export function FuelConsumptionChart({ data }: { data: FuelMonthlyChartPoint[] }) {
  if (!data.length || !data.some((d) => d.liters > 0 || d.amount > 0)) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Consumo de Combustibles</h3>
          <p className="text-xs text-[var(--color-text-muted)]">Litros cargados y costo por mes</p>
        </div>
      </div>

      <ChartContainer config={fuelChartConfig} className="h-48 w-full">
        <ComposedChart data={data} margin={{ top: 10, right: 6, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis yAxisId="liters" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis yAxisId="amount" orientation="right" tickLine={false} axisLine={false} tickMargin={4} tickFormatter={compactCLPTick} width={52} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar yAxisId="liters" dataKey="liters" fill={CHART_COLORS.signal} radius={[4, 4, 0, 0]} />
          <Line yAxisId="amount" type="monotone" dataKey="amount" stroke={CHART_COLORS.brand} strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ChartContainer>
    </div>
  )
}

// ── 8. Maintenance Activity Chart ─────────────────────────────────────────────

export interface MaintenanceMonthlyChartPoint {
  month: string
  completed: number
  scheduled: number
  amount: number
}

/**
 * Conteos en barras (eje izquierdo) y costo en línea (eje derecho). El `amount`
 * ya lo calculaba `getMaintenanceMonthlyTrend` y se descartaba; sin él la
 * tarjeta contaba mantenciones sin decir lo que costaron.
 */
export function MaintenanceTrendChart({ data }: { data: MaintenanceMonthlyChartPoint[] }) {
  if (!data.length || !data.some((d) => d.completed > 0 || d.scheduled > 0 || d.amount > 0)) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Mantención de Flota</h3>
          <p className="text-xs text-[var(--color-text-muted)]">Completadas vs. programadas y costo por mes</p>
        </div>
      </div>

      {/* Era el único gráfico del tablero sin lectura equivalente (I-15). */}
      <ChartContainer config={maintenanceChartConfig} className="h-48 w-full">
        <ComposedChart data={data} margin={{ top: 10, right: 6, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis yAxisId="count" tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
          <YAxis yAxisId="amount" orientation="right" tickLine={false} axisLine={false} tickMargin={4} tickFormatter={compactCLPTick} width={52} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar yAxisId="count" dataKey="completed" fill={CHART_COLORS.brand} radius={[4, 4, 0, 0]} />
          <Bar yAxisId="count" dataKey="scheduled" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} />
          <Line yAxisId="amount" type="monotone" dataKey="amount" stroke={CHART_COLORS.violet} strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ChartContainer>
    </div>
  )
}


// ── 9. Dona de composición ───────────────────────────────────────────────────

export interface CompositionSlice {
  key: string
  label: string
  value: number
}

/**
 * Dona para **composición de un total** (gasto por módulo, estados
 * documentales): responde "de qué está hecho" mejor que una barra, porque el
 * total va al centro y cada arco se lee como parte de él.
 *
 * Sólo para composición. Para comparar magnitudes entre categorías la barra
 * sigue ganando —los ángulos se comparan peor que las longitudes—, y por eso el
 * ranking por faena o por producto no usa esto.
 */
export function CompositionDonutChart({ data, title, description, totalLabel, format = "count" }: {
  data: CompositionSlice[]
  title: string
  description: string
  totalLabel: string
  /**
   * Discriminador y **no** una función: este componente lo instancia un Server
   * Component, y las funciones no cruzan la frontera RSC — pasar `formatCLP`
   * directo tiraba la página entera al `error.tsx` del dashboard.
   */
  format?: "count" | "clp"
}) {
  /*
   * Se fusionan las porciones que comparten etiqueta antes de dibujar.
   *
   * `spendByModule` mapea varios módulos a "Otros", así que la leyenda mostraba
   * **"Otros" dos veces** con dos colores: dos porciones indistinguibles entre
   * sí. Lo detectó la pasada visual; ningún test lo veía.
   */
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const slices = React.useMemo(() => {
    const merged = new Map<string, CompositionSlice>()
    for (const slice of data) {
      if (slice.value <= 0) continue
      const current = merged.get(slice.label)
      if (current) current.value += slice.value
      else merged.set(slice.label, { ...slice })
    }
    return [...merged.values()].sort((left, right) => right.value - left.value)
  }, [data])
  const total = React.useMemo(() => slices.reduce((sum, slice) => sum + slice.value, 0), [slices])
  const config = React.useMemo<ChartConfig>(
    () => Object.fromEntries(slices.map((slice, index) => [slice.key, { label: slice.label, color: CHART_SERIES[index % CHART_SERIES.length] }])),
    [slices],
  )
  if (slices.length === 0) return null

  const formatted = (value: number) => (format === "clp" ? formatCLP(value) : value.toLocaleString("es-CL"))

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </div>

      {slices.length <= 2 ? (
        /* I-09: una dona de 1-2 categorías es decoración (Tufte) — la misma
           composición cabe en una barra apilada de 12 px y la tarjeta deja de
           reservar 192 px de alto para un solo dato. */
        <div>
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-[var(--color-text)]">{formatted(total)}</span>
            <span className="text-[11px] text-[var(--color-text-muted)]">{totalLabel}</span>
          </p>
          <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]" aria-hidden>
            {slices.map((slice, index) => (
              <div key={slice.key} style={{ width: `${(slice.value / total) * 100}%`, background: CHART_SERIES[index % CHART_SERIES.length] }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {slices.map((slice, index) => (
              <li key={slice.key} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <span className="size-2 rounded-full" style={{ background: CHART_SERIES[index % CHART_SERIES.length] }} aria-hidden />
                {slice.label}: <span className="font-mono font-semibold text-[var(--color-text)]">{formatted(slice.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ChartContainer config={config} className="h-48 w-full">
          <PieChart onMouseLeave={() => setActiveIndex(null)}>
            <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => [formatted(Number(value)), String(name)]} />} />
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius={52} outerRadius={78} strokeWidth={2} paddingAngle={2}>
              {slices.map((slice, index) => (
                <Cell
                  key={slice.key}
                  fill={CHART_SERIES[index % CHART_SERIES.length]}
                  opacity={activeIndex === null || activeIndex === index ? 1 : 0.4}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  className="cursor-pointer transition-opacity duration-200"
                />
              ))}
              <Label content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox)) return null
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={viewBox.cy} className="fill-[var(--color-text)] font-mono text-lg font-bold">{formatted(total)}</tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-[var(--color-text-muted)] text-[11px]">{totalLabel}</tspan>
                  </text>
                )
              }} />
            </Pie>
            <ChartLegend content={<ChartLegendContent />} />
          </PieChart>
        </ChartContainer>
      )}
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
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
          onMouseLeave={() => setActiveIndex(null)}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" domain={[0, max ?? (unit === "%" ? 100 : "dataMax")]} tickFormatter={(value) => (format === "clp" ? compactCLPTick(Number(value)) : `${value}${unit}`)} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
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

// ── 11. Barra apilada 100% de estados ────────────────────────────────────────

export interface StatusShare {
  key: string
  label: string
  value: number
  /**
   * Color semántico de la categoría (brand/signal/danger/neutral). Sin él se
   * asigna por índice sobre las categorías **presentes**, y eso pintaba "Por
   * mejorar" con el verde de marca cuando "Satisfactorios" venía en cero
   * (I-11): quien tenga semántica de estado debe declararla.
   */
  color?: string
}

/**
 * Una sola barra al 100% partida por estado.
 *
 * Para "cómo se reparte una población entre estados" cuando el total absoluto
 * ya está dicho en el KPI de al lado: la proporción se lee de un vistazo y no
 * compite con la cifra. Los conteos exactos van en el tooltip y en la leyenda.
 */
export function StatusShareBar({ data, title, description }: {
  data: StatusShare[]
  title: string
  description: string
}) {
  const slices = React.useMemo(() => data.filter((slice) => slice.value > 0), [data])
  const total = React.useMemo(() => slices.reduce((sum, slice) => sum + slice.value, 0), [slices])
  if (total === 0) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </div>

      <div className="flex h-6 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]" role="img" aria-label={slices.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        {slices.map((slice, index) => (
          <div
            key={slice.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(slice.value / total) * 100}%`, backgroundColor: slice.color ?? CHART_SERIES[index % CHART_SERIES.length] }}
            title={`${slice.label}: ${slice.value} (${Math.round((slice.value / total) * 100)}%)`}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {slices.map((slice, index) => (
          <li key={slice.key} className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: slice.color ?? CHART_SERIES[index % CHART_SERIES.length] }} aria-hidden />
            {slice.label}
            <span className="font-mono tabular-nums text-[var(--color-text)]">{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── 12. Billing Flow Chart ───────────────────────────────────────────────────

/**
 * Facturado contra cobrado, mes a mes.
 *
 * Las dos series son dinero en la misma moneda y la misma escala, así que
 * comparten eje (A5b sólo prohíbe mezclar unidades distintas). La brecha entre
 * ambas líneas **es** la lectura: lo emitido que todavía no entra en caja.
 */
export function BillingFlowChart({ data }: {
  data: Array<{ period: string; invoiced: number; collected: number }>
}) {
  // Todo-en-cero también se oculta: una rejilla vacía con conclusión absurda
  // ("el mayor facturado se registró en Mar: $0") es peor que nada (I-03).
  if (!data.some((row) => row.invoiced + row.collected > 0)) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Facturado y cobrado</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Emisión contra pagos confirmados, por mes</p>
      </div>

      <ChartContainer config={billingFlowConfig} className="h-56 w-full">
        <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={52} fontSize={11} tickFormatter={compactCLPTick} />
          <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => `${String(name)}: ${formatCLP(Number(value))}`} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Line dataKey="invoiced" type="monotone" stroke={CHART_COLORS.brand} strokeWidth={2} dot={false} />
          <Line dataKey="collected" type="monotone" stroke={CHART_COLORS.blue} strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </div>
  )
}

// ── 13. Radial Gauge ─────────────────────────────────────────────────────────

const gaugeConfig = {
  value: { label: "Avance", color: CHART_COLORS.brand },
} satisfies ChartConfig

/**
 * Medidor radial para una sola tasa contra su meta.
 *
 * Un porcentaje anual no es una serie: dibujarlo como línea de un punto o como
 * barra suelta desperdicia la tarjeta. El arco declara la meta y el color dice
 * si está bajo ella — `signal` (naranja) por debajo, marca por encima, que es
 * exactamente el rol reservado del naranja en DESIGN.md: "pendiente".
 */
export function RadialGaugeChart({ title, description, percent, targetPercent, footer }: {
  title: string
  description: string
  /** 0-100 ya redondeado por el llamador. */
  percent: number
  /** Meta en la misma escala. Omitida, el arco siempre va en color de marca. */
  targetPercent?: number
  footer?: string
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  const belowTarget = targetPercent !== undefined && value < targetPercent

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </div>

      <ChartContainer config={gaugeConfig} className="mx-auto aspect-[2/1] max-h-44 w-full">
        <RadialBarChart data={[{ name: title, value }]} startAngle={200} endAngle={-20} innerRadius="72%" outerRadius="100%">
          {/* Sin el eje polar explícito recharts escala el arco al máximo del
              dato, así que un 41% dibujaba el círculo completo. */}
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            dataKey="value" angleAxisId={0} background cornerRadius={999}
            fill={belowTarget ? CHART_COLORS.signal : CHART_COLORS.brand}
            isAnimationActive={false}
          />
          {/* Centrado en el hueco del arco, no en la abertura de abajo.
              Con `y="78%"` la cifra caía entre las dos puntas del arco —que
              están a ~67% de la altura— y el texto mide 30px **fijos** mientras
              la geometría escala con el ancho de la columna: en la retícula de
              dos columnas el arco se encoge, la cifra no, y se solapaban. El
              interior (innerRadius 72%) es la zona ancha y vacía, así que
              centrarla ahí no puede chocar con nada a ningún ancho. */}
          <text
            x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
            className="fill-[var(--color-text)] font-mono text-3xl font-bold"
          >
            {`${value}%`}
          </text>
        </RadialBarChart>
      </ChartContainer>

      {(footer || targetPercent !== undefined) && (
        <p className="mt-1 text-center text-xs text-[var(--color-text-muted)]">
          {footer ?? `Meta ${targetPercent}%`}
        </p>
      )}
    </div>
  )
}
