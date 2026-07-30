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
import type { DashboardMetric } from "./dashboard-control-center"
import { MiniSparkline } from "./mini-sparkline"
import { CHART_COLORS } from "./chart-palette"

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

/**
 * Sólo los tiles con serie **real** entran aquí. Hoy es uno: `stock`, que la
 * recibe de la instantánea diaria `stock_alerts`. Los demás no tienen serie que
 * corresponda a su cifra —el backlog de la cola depende de los permisos del
 * usuario, así que ninguna agregación por faena lo reconstruye— y tener su color
 * declarado hacía creer que sí. Se agrega el color cuando exista el productor.
 */
const SPARKLINE_COLOR: Record<string, string> = {
  stock: CHART_COLORS.signal,
}

/**
 * Grouped operational metrics strip — authentic SaaS metrics without hardcoded or fake charts.
 * MiniSparkline is rendered ONLY if real sparkline trend data is provided upstream.
 *
 * Max 4 metrics (enforced upstream by buildOperationalMetrics).
 */
export function OperationalMetricsStrip({ metrics }: { metrics: DashboardMetric[] }) {
  if (metrics.length === 0) return null

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs" aria-labelledby="indicadores-operacionales">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3 bg-[var(--color-surface-2)]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />
          <h2 id="indicadores-operacionales" className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            Indicadores Operacionales
          </h2>
        </div>
        <span className="text-[11px] font-medium text-[var(--color-text-faint)]">Selecciona para ver el detalle</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4">
        {metrics.map((metric, i) => (
          <MetricCell key={metric.key} metric={metric} index={i} total={metrics.length} />
        ))}
      </div>
    </section>
  )
}

function MetricCell({ metric, index, total }: {
  metric: DashboardMetric
  index: number
  total: number
}) {
  const Icon = METRIC_ICON[metric.icon] || CheckCircle
  const toneClass = metric.tone === "danger"
    ? "text-[var(--color-danger-ink)]"
    : metric.tone === "signal"
      ? "text-[var(--color-primary)]"
      : "text-[var(--color-text)]"

  const hasRealSparkline = Array.isArray(metric.sparkline) && metric.sparkline.length >= 2
  const sparklineColor = SPARKLINE_COLOR[metric.icon] || CHART_COLORS.blue

  const content = (
    <div className="flex min-h-[5.25rem] flex-col justify-between p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{metric.label}</span>
        <div className="flex items-center gap-2">
          {hasRealSparkline && (
            <MiniSparkline data={metric.sparkline!} color={sparklineColor} />
          )}
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-muted)] group-hover:bg-[var(--color-primary-tint)] group-hover:text-[var(--color-primary)] transition-colors">
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
        <span className="mt-1.5 block text-xs leading-4 text-[var(--color-text-muted)]">{metric.description}</span>
      </div>
    </div>
  )

  const twoColRows = Math.ceil(total / 2)
  const lastTwoColRowStart = (twoColRows - 1) * 2

  const sharedClass = cn(
    "group text-left transition-colors duration-150 ease-out",
    "hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
    "motion-safe:active:scale-[0.99]",
    index % 2 === 0 && index !== total - 1 && "sm:border-r sm:border-[var(--color-border)]",
    index < lastTwoColRowStart && "border-b border-[var(--color-border)] 2xl:border-b-0",
    index !== total - 1 && "2xl:border-r 2xl:border-[var(--color-border)]",
  )

  if (metric.href) return <Link href={metric.href} data-pressable className={sharedClass}>{content}</Link>
  return <div className={cn(sharedClass, "cursor-default hover:bg-[var(--color-surface)]")}>{content}</div>
}
