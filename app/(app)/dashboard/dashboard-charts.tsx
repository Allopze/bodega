"use client"

import * as React from "react"
import {
  Area,
  AreaChart,
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
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { formatCLP } from "@/lib/utils"
import type { OperationalPeriodMetrics } from "@/lib/services/operational-period-metrics"
import type { DashboardTask } from "./dashboard-control-center"

// ── Configuration for Charts ──────────────────────────────────────────────────

const trendChartConfig = {
  requests: {
    label: "Solicitudes",
    color: "#2563eb", // blue-600
  },
  orders: {
    label: "OC Emitidas",
    color: "#0891b2", // cyan-600
  },
  receipts: {
    label: "Recepciones",
    color: "#16a34a", // green-600
  },
} satisfies ChartConfig

const workloadChartConfig = {
  count: {
    label: "Tareas Pendientes",
    color: "#4f46e5", // indigo-600
  },
} satisfies ChartConfig

const worksiteChartConfig = {
  totalCost: {
    label: "Inversión Acumulada",
    color: "#0f172a", // slate-900
  },
} satisfies ChartConfig

// ── Unified Analytics Section ─────────────────────────────────────────────────

export function DashboardAnalyticsSection({
  periodMetrics,
  tasks,
}: {
  periodMetrics: OperationalPeriodMetrics
  tasks: DashboardTask[]
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

  // Evita renderizar contenedores vacíos gigantes que desbalanceen la simetría del lienzo.
  if (!hasTrendData && !hasWorkloadData) {
    return null
  }

  return (
    <div className="mt-6 grid gap-6 grid-cols-1 xl:grid-cols-2">
      {hasTrendData ? (
        <OperationalTrendChart data={trendData} />
      ) : (
        <EmptyAnalyticsCard title="Tendencia Operativa Mensual" description="Se mostrará al registrar solicitudes u órdenes." />
      )}

      {hasWorkloadData ? (
        <ModuleWorkloadChart tasks={tasks} />
      ) : (
        <EmptyAnalyticsCard title="Distribución por Módulo" description="Sin tareas pendientes activas en la cola." />
      )}
    </div>
  )
}

function EmptyAnalyticsCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-slate-200/70 bg-white p-5 text-center shadow-xs">
      <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">{title}</p>
      <p className="mt-1 text-xs text-slate-400 max-w-[28ch]">{description}</p>
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
          <Area
            type="monotone"
            dataKey="requests"
            stroke="#2563eb"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#fillRequests)"
          />
          <Area
            type="monotone"
            dataKey="orders"
            stroke="#0891b2"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#fillOrders)"
          />
          <Area
            type="monotone"
            dataKey="receipts"
            stroke="#16a34a"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#fillReceipts)"
          />
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

// ── 3. Worksite Activity Horizontal Bar Chart ─────────────────────────────────

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

// ── 4. Mini Sparkline Chart for KPI Indicators ─────────────────────────────────

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
