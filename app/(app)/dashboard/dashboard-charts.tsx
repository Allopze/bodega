"use client"

import * as React from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import type { DashboardTask } from "./dashboard-control-center"

// ── Configuration for Charts ──────────────────────────────────────────────────

const trendChartConfig = {
  requests: {
    label: "Solicitudes",
    color: "#2563eb",
  },
  orders: {
    label: "OC Emitidas",
    color: "#0891b2",
  },
  receipts: {
    label: "Recepciones",
    color: "#16a34a",
  },
} satisfies ChartConfig

const workloadChartConfig = {
  count: {
    label: "Tareas Pendientes",
    color: "#4f46e5",
  },
} satisfies ChartConfig

const worksiteChartConfig = {
  totalCost: {
    label: "Inversión Acumulada",
    color: "#0f172a",
  },
} satisfies ChartConfig

const sstChartConfig = {
  tasaFrecuencia: {
    label: "Tasa de Frecuencia (TF)",
    color: "#2563eb",
  },
  tasaGravedad: {
    label: "Tasa de Gravedad (TG)",
    color: "#dc2626",
  },
} satisfies ChartConfig

const sstAccidentConfig = {
  accConTiempoPerdido: {
    label: "Accidentes CTP",
    color: "#dc2626",
  },
  accSinTiempoPerdido: {
    label: "Accidentes STP",
    color: "#d97706",
  },
} satisfies ChartConfig

const materialEnvConfig = {
  dangerousIncidents: {
    label: "Inc. Peligrosos",
    color: "#7c3aed",
  },
  materialDamage: {
    label: "Daño Material",
    color: "#d97706",
  },
  environmentalSpills: {
    label: "Daño Ambiental",
    color: "#0891b2",
  },
} satisfies ChartConfig

const fuelChartConfig = {
  liters: {
    label: "Litros",
    color: "#d97706",
  },
  loads: {
    label: "Cargas",
    color: "#0891b2",
  },
} satisfies ChartConfig

const maintenanceChartConfig = {
  completed: {
    label: "Completadas",
    color: "#16a34a",
  },
  scheduled: {
    label: "Programadas",
    color: "#2563eb",
  },
} satisfies ChartConfig

export interface SstMonthlyPoint {
  month: string
  tasaFrecuencia: number
  tasaGravedad: number
  accConTiempoPerdido: number
  accSinTiempoPerdido: number
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
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Tendencia Operativa</h3>
        <p className="text-xs text-slate-500">Solicitudes, órdenes y recepciones — últimos 6 meses</p>
      </div>

      <ChartContainer config={trendChartConfig} className="h-48 w-full">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="fillRequests" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="fillOrders" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0891b2" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#0891b2" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="fillReceipts" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#16a34a" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#16a34a" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Area type="monotone" dataKey="requests" stroke="#2563eb" strokeWidth={2} fillOpacity={1} fill="url(#fillRequests)" />
          <Area type="monotone" dataKey="orders" stroke="#0891b2" strokeWidth={2} fillOpacity={1} fill="url(#fillOrders)" />
          <Area type="monotone" dataKey="receipts" stroke="#16a34a" strokeWidth={2} fillOpacity={1} fill="url(#fillReceipts)" />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}

// ── 2. Workload Distribution Bar Chart ────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  request_followup: "Solicitudes",
  approval: "Aprobaciones",
  purchase: "Compras",
  receipt: "Recepciones",
  warehouse_delivery: "Entregas",
  pdtp: "PDTP",
  capa: "CAPA",
  inspection: "Inspecciones",
  documentation: "Documentos",
  ppa: "PPA",
  sst: "SST",
}

const BAR_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#0891b2",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#64748b",
]

export function ModuleWorkloadChart({ tasks }: { tasks: DashboardTask[] }) {
  const counts = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const task of tasks) {
      const label = MODULE_LABELS[task.type] || task.type
      map.set(label, (map.get(label) || 0) + 1)
    }
    return Array.from(map.entries()).map(([module, count]) => ({
      module,
      count,
    })).sort((a, b) => b.count - a.count)
  }, [tasks])

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Distribución por Módulo</h3>
          <p className="text-xs text-slate-500">Volumen de acciones operacionales pendientes</p>
        </div>
        <span className="font-mono text-xs font-semibold text-slate-600">
          {tasks.length} {tasks.length === 1 ? "tarea" : "tareas"}
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
              <Cell key={`cell-${entry.module}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── 3. SST Trend Chart (Tasa Frecuencia y Tasa Gravedad) ─────────────────────

export function SstTrendChart({ data }: { data: SstMonthlyPoint[] }) {
  if (data.length === 0) return null

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Tasas de Siniestralidad SST</h3>
        <p className="text-xs text-slate-500">Tasa de Frecuencia (TF) y Tasa de Gravedad (TG) mensual</p>
      </div>

      <ChartContainer config={sstChartConfig} className="h-48 w-full">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Line type="monotone" dataKey="tasaFrecuencia" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="tasaGravedad" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ChartContainer>
    </div>
  )
}

// ── 4. SST Accident Breakdown Chart ──────────────────────────────────────────

export function SstAccidentChart({ data }: { data: SstMonthlyPoint[] }) {
  if (data.length === 0) return null

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Accidentes CTP vs. STP</h3>
        <p className="text-xs text-slate-500">Eventos con y sin tiempo perdido por mes</p>
      </div>

      <ChartContainer config={sstAccidentConfig} className="h-48 w-full">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="accConTiempoPerdido" fill="#dc2626" radius={[4, 4, 0, 0]} />
          <Bar dataKey="accSinTiempoPerdido" fill="#d97706" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── 5. Material & Environmental Chart ───────────────────────────────────────

export function MaterialEnvironmentalChart({ data }: { data: MaterialEnvironmentalPoint[] }) {
  if (data.length === 0) return null

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Impacto Material y Ambiental</h3>
        <p className="text-xs text-slate-500">Incidentes peligrosos, daños materiales y derrames ambientales</p>
      </div>

      <ChartContainer config={materialEnvConfig} className="h-48 w-full">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="dangerousIncidents" fill="#7c3aed" radius={[4, 4, 0, 0]} />
          <Bar dataKey="materialDamage" fill="#d97706" radius={[4, 4, 0, 0]} />
          <Bar dataKey="environmentalSpills" fill="#0891b2" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── 6. Worksite Activity Horizontal Bar Chart ─────────────────────────────────

export function WorksiteActivityChart({
  worksites,
}: {
  worksites: {
    id: string
    name: string
    requestsCount: number
    pendingCount: number
    approvedCount: number
    totalCost: number
  }[]
}) {
  if (worksites.length === 0) return null

  const data = worksites.map((ws) => ({
    name: ws.name,
    totalCost: ws.totalCost,
    requestsCount: ws.requestsCount,
    pendingCount: ws.pendingCount,
  })).sort((a, b) => b.totalCost - a.totalCost).slice(0, 6)

  const hasCost = data.some((d) => d.totalCost > 0)
  if (!hasCost) return null

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
      <div className="mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Inversión por Faena</h3>
        <p className="text-xs text-slate-500">Monto total comprometido por centro de costos</p>
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
          <Bar dataKey="totalCost" fill="#0f172a" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── 7. Mini Sparkline Chart for KPI Indicators ─────────────────────────────────

export function MiniSparkline({
  data,
  color = "#2563eb",
}: {
  data: number[]
  color?: string
}) {
  const chartData = data.map((val, i) => ({ step: i, value: val }))

  return (
    <div className="h-7 w-20 shrink-0 opacity-85 transition-opacity hover:opacity-100">
      <ChartContainer config={{ value: { label: "Métrica", color } }} className="h-full w-full">
        <AreaChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <defs>
            <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={color} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.8}
            fill={`url(#spark-${color})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}

// ── 8. Fuel Consumption Chart ────────────────────────────────────────────────

export interface FuelMonthlyChartPoint {
  month: string
  liters: number
  amount: number
  loads: number
}

export function FuelConsumptionChart({ data }: { data: FuelMonthlyChartPoint[] }) {
  if (!data.length || !data.some((d) => d.liters > 0 || d.loads > 0)) return null

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Consumo de Combustibles</h3>
          <p className="text-xs text-slate-500">Litros cargados y número de cargas por mes</p>
        </div>
      </div>

      <ChartContainer config={fuelChartConfig} className="h-48 w-full">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="liters" fill="#d97706" radius={[4, 4, 0, 0]} />
          <Bar dataKey="loads" fill="#0891b2" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── 9. Maintenance Activity Chart ─────────────────────────────────────────────

export interface MaintenanceMonthlyChartPoint {
  month: string
  completed: number
  scheduled: number
  amount: number
}

export function MaintenanceTrendChart({ data }: { data: MaintenanceMonthlyChartPoint[] }) {
  if (!data.length || !data.some((d) => d.completed > 0 || d.scheduled > 0 || d.amount > 0)) return null

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Mantención de Flota</h3>
          <p className="text-xs text-slate-500">Mantenciones completadas vs. programadas por mes</p>
        </div>
      </div>

      <ChartContainer config={maintenanceChartConfig} className="h-48 w-full">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="completed" fill="#16a34a" radius={[4, 4, 0, 0]} />
          <Bar dataKey="scheduled" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

