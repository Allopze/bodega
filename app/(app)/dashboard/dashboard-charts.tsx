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
  Line,
  LineChart,
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
import { CHART_COLORS, CHART_SERIES } from "./chart-palette"

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
  if (data.length === 0) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Tendencia Operativa</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Solicitudes, órdenes y recepciones — últimos 6 meses</p>
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
        <BarChart data={counts} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="module" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent hideLabel indicator="line" />} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {counts.map((entry, index) => (
              <Cell key={`cell-${entry.module}`} fill={CHART_SERIES[index % CHART_SERIES.length]} />
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
  if (data.length === 0) return null

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
  if (data.length === 0) return null

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
          <Bar dataKey="confirmados" stackId="accidentes" fill={CHART_COLORS.danger} radius={hasPending ? [0, 0, 0, 0] : [4, 4, 0, 0]} />
          <Bar dataKey="porCalificar" stackId="accidentes" fill={CHART_COLORS.signal} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── 5. Material & Environmental Chart ───────────────────────────────────────

export function MaterialEnvironmentalChart({ data }: { data: MaterialEnvironmentalPoint[] }) {
  if (data.length === 0) return null

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
          <Bar dataKey="dangerousIncidents" fill={CHART_COLORS.violet} radius={[4, 4, 0, 0]} />
          <Bar dataKey="materialDamage" fill={CHART_COLORS.signal} radius={[4, 4, 0, 0]} />
          <Bar dataKey="environmentalSpills" fill={CHART_COLORS.teal} radius={[4, 4, 0, 0]} />
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
  if (worksites.length === 0) return null

  const data = [...worksites].sort((a, b) => b.totalCost - a.totalCost).slice(0, 6)

  const hasCost = data.some((d) => d.totalCost > 0)
  if (!hasCost) return null

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Inversión por Faena</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Monto comprometido por centro de costos — acumulado histórico</p>
      </div>

      <ChartContainer config={worksiteChartConfig} className="h-56 w-full">
        <BarChart data={data} layout="vertical" margin={{ top: 10, right: 15, left: 10, bottom: 0 }}>
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
                formatter={(value) => [formatCLP(Number(value)), "Inversión acumulada"]}
              />
            }
          />
          <Bar dataKey="totalCost" fill={CHART_COLORS.brand} radius={[0, 6, 6, 0]} />
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

