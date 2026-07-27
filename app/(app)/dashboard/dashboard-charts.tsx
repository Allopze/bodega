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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatCLP } from "@/lib/utils"
import type { OperationalPeriodMetrics } from "@/lib/services/operational-period-metrics"
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

// ── Unified Analytics Section ─────────────────────────────────────────────────

export function DashboardAnalyticsSection({
  periodMetrics,
  tasks,
  sstPoints = [],
  materialEnvPoints = [],
}: {
  periodMetrics: OperationalPeriodMetrics
  tasks: DashboardTask[]
  sstPoints?: SstMonthlyPoint[]
  materialEnvPoints?: MaterialEnvironmentalPoint[]
}) {
  const trendData = [
    {
      period: "Mes Anterior",
      requests: periodMetrics.requests.previous ?? 0,
      orders: periodMetrics.ordersIssued.previous ?? 0,
      receipts: periodMetrics.receipts.previous ?? 0,
    },
    {
      period: "Mes Actual",
      requests: periodMetrics.requests.current,
      orders: periodMetrics.ordersIssued.current,
      receipts: periodMetrics.receipts.current,
    },
  ]

  const hasTrendData = trendData.some((d) => d.requests > 0 || d.orders > 0 || d.receipts > 0)
  const hasWorkloadData = tasks.length > 0
  const hasSstData = sstPoints.length > 0
  const hasMaterialEnvData = materialEnvPoints.length > 0

  if (!hasTrendData && !hasWorkloadData && !hasSstData && !hasMaterialEnvData) {
    return null
  }

  const showTabs = hasSstData || hasMaterialEnvData

  if (!showTabs) {
    return (
      <div className="mt-6 grid gap-6 grid-cols-1 xl:grid-cols-2">
        <OperationalTrendChart data={trendData} />
        <ModuleWorkloadChart tasks={tasks} />
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-4">
      <Tabs defaultValue="operativa" className="w-full">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
          <h2 className="text-sm font-bold text-slate-900">Analítica y Tendencias Operacionales</h2>
          <TabsList className="bg-slate-100 p-1 rounded-xl">
            <TabsTrigger value="operativa" className="text-xs">Flujo Operativo</TabsTrigger>
            {hasSstData && <TabsTrigger value="sst" className="text-xs">Salud y Seguridad (SST)</TabsTrigger>}
            {hasMaterialEnvData && <TabsTrigger value="ambiental" className="text-xs">Material y Ambiental</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="operativa" className="mt-4">
          <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
            <OperationalTrendChart data={trendData} />
            <ModuleWorkloadChart tasks={tasks} />
          </div>
        </TabsContent>

        {hasSstData && (
          <TabsContent value="sst" className="mt-4">
            <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
              <SstTrendChart data={sstPoints} />
              <SstAccidentChart data={sstPoints} />
            </div>
          </TabsContent>
        )}

        {hasMaterialEnvData && (
          <TabsContent value="ambiental" className="mt-4">
            <div className="grid gap-6 grid-cols-1">
              <MaterialEnvironmentalChart data={materialEnvPoints} />
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

// ── 1. Operational Trend Area Chart ─────────────────────────────────────────

export function OperationalTrendChart({ data }: { data: Array<{ period: string; requests: number; orders: number; receipts: number }> }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Tendencia Operativa</h3>
          <p className="text-xs text-slate-500">Flujo de solicitudes, órdenes y recepciones</p>
        </div>
        <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
          Shadcn Chart
        </span>
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
          <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} />
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
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Tasas de Siniestralidad SST</h3>
          <p className="text-xs text-slate-500">Tasa de Frecuencia (TF) y Tasa de Gravedad (TG) mensual</p>
        </div>
        <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
          Canónico SST
        </span>
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
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Accidentes CTP vs. STP</h3>
          <p className="text-xs text-slate-500">Eventos con y sin tiempo perdido por mes</p>
        </div>
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
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Impacto Material y Ambiental</h3>
          <p className="text-xs text-slate-500">Incidentes peligrosos, daños materiales y derrames ambientales</p>
        </div>
        <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          Medio Ambiente & Operación
        </span>
      </div>

      <ChartContainer config={materialEnvConfig} className="h-56 w-full">
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
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Inversión y Actividad por Faena</h3>
          <p className="text-xs text-slate-500">Monto total comprometido por centro de costos</p>
        </div>
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
