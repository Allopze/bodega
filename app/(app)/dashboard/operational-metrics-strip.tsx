"use client"

import * as React from "react"
import Link from "next/link"
import {
  CheckCircle,
  CheckSquare,
  Package,
  ShoppingCart,
  Truck,
  WarningCircle,
  Warehouse,
} from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import type { DashboardMetric, DashboardQueuePreset } from "./dashboard-control-center"
import { MiniSparkline } from "./dashboard-charts"

const METRIC_ICON = {
  tasks:      CheckCircle,
  critical:   WarningCircle,
  approvals:  CheckSquare,
  receipts:   Truck,
  deliveries: Warehouse,
  stock:      Package,
  investment: ShoppingCart,
  rate:       CheckCircle,
} as const

const SPARKLINE_COLOR: Record<string, string> = {
  tasks:      "#2563eb",
  critical:   "#dc2626",
  approvals:  "#7c3aed",
  receipts:   "#0891b2",
  deliveries: "#16a34a",
  stock:      "#d97706",
  investment: "#0f172a",
  rate:       "#16a34a",
}

/**
 * Grouped operational metrics strip — authentic SaaS metrics without hardcoded or fake charts.
 * MiniSparkline is rendered ONLY if real sparkline trend data is provided upstream.
 *
 * Max 4 metrics (enforced upstream by buildOperationalMetrics).
 */
export function OperationalMetricsStrip({ metrics, onSelect }: {
  metrics: DashboardMetric[]
  onSelect: (preset: DashboardQueuePreset) => void
}) {
  if (metrics.length === 0) return null

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs" aria-labelledby="indicadores-operacionales">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 bg-slate-50/50">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-blue-600" />
          <h2 id="indicadores-operacionales" className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Indicadores Operacionales
          </h2>
        </div>
        <span className="text-[11px] font-medium text-slate-400">Selecciona para filtrar</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4">
        {metrics.map((metric, i) => (
          <MetricCell key={metric.key} metric={metric} index={i} total={metrics.length} onSelect={onSelect} />
        ))}
      </div>
    </section>
  )
}

function MetricCell({ metric, index, total, onSelect }: {
  metric: DashboardMetric
  index: number
  total: number
  onSelect: (preset: DashboardQueuePreset) => void
}) {
  const Icon = METRIC_ICON[metric.icon]
  const toneClass = metric.tone === "danger"
    ? "text-red-600"
    : metric.tone === "signal"
      ? "text-blue-600"
      : "text-slate-900"

  const hasRealSparkline = Array.isArray(metric.sparkline) && metric.sparkline.length >= 2
  const sparklineColor = SPARKLINE_COLOR[metric.icon] || "#2563eb"

  const content = (
    <div className="flex min-h-[5.25rem] flex-col justify-between p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{metric.label}</span>
        <div className="flex items-center gap-2">
          {hasRealSparkline && (
            <MiniSparkline data={metric.sparkline!} color={sparklineColor} />
          )}
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
            <Icon size={16} aria-hidden />
          </div>
        </div>
      </div>
      <div className="mt-2">
        <div className="flex items-baseline gap-2">
          <span className={cn("font-mono text-2xl font-bold leading-none tabular-nums tracking-tight", toneClass)}>
            {metric.value}
          </span>
        </div>
        <span className="mt-1.5 block text-xs leading-4 text-slate-500">{metric.description}</span>
      </div>
    </div>
  )

  const twoColRows = Math.ceil(total / 2)
  const lastTwoColRowStart = (twoColRows - 1) * 2

  const sharedClass = cn(
    "group text-left transition-colors duration-150 ease-out",
    "hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600",
    "motion-safe:active:scale-[0.99]",
    index % 2 === 0 && index !== total - 1 && "sm:border-r sm:border-slate-100",
    index < lastTwoColRowStart && "border-b border-slate-100 2xl:border-b-0",
    index !== total - 1 && "2xl:border-r 2xl:border-slate-100",
  )

  if (metric.href) return <Link href={metric.href} data-pressable className={sharedClass}>{content}</Link>
  if (metric.preset) return <button type="button" onClick={() => onSelect(metric.preset!)} className={sharedClass}>{content}</button>
  return <div className={cn(sharedClass, "cursor-default hover:bg-white")}>{content}</div>
}
