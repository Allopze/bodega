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
 * Compact grouped metrics strip — inspired by Dashboard6 reference pattern:
 * all metrics in a single continuous surface with hairline dividers,
 * tabular numbers, and semantic tone.
 *
 * Max 4 metrics (enforced upstream by buildOperationalMetrics).
 */
export function OperationalMetricsStrip({ metrics, onSelect }: {
  metrics: DashboardMetric[]
  onSelect: (preset: DashboardQueuePreset) => void
}) {
  if (metrics.length === 0) return null

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-(--color-surface)" aria-labelledby="indicadores-operacionales">
      <div className="flex items-center justify-between border-b border-(--color-border) px-4 py-2">
        <h2 id="indicadores-operacionales" className="text-eyebrow">Indicadores operacionales</h2>
        <span className="text-[11px] text-(--color-text-faint)">Selecciona para actuar</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric, i) => (
          <MetricCell key={metric.key} metric={metric} last={i === metrics.length - 1} onSelect={onSelect} />
        ))}
      </div>
    </section>
  )
}

function MetricCell({ metric, last, onSelect }: {
  metric: DashboardMetric
  last: boolean
  onSelect: (preset: DashboardQueuePreset) => void
}) {
  const Icon = METRIC_ICON[metric.icon]
  const toneClass = metric.tone === "danger"
    ? "text-[var(--color-danger-ink)]"
    : metric.tone === "signal"
      ? "text-[var(--color-signal-ink)]"
      : "text-[var(--color-text)]"

  const content = (
    <div className="flex min-h-[4.5rem] flex-col justify-between p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-(--color-text-muted)">{metric.label}</span>
        <Icon size={15} className="shrink-0 text-(--color-text-faint)" aria-hidden />
      </div>
      <div>
        <span className={cn("block font-mono text-xl font-semibold leading-none tabular-nums tracking-tight", toneClass)}>
          {metric.value}
        </span>
        <span className="mt-1 block text-[11px] leading-4 text-(--color-text-subtle)">{metric.description}</span>
      </div>
    </div>
  )

  const sharedClass = cn(
    "group text-left transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
    "motion-safe:active:scale-[0.99]",
    !last && "border-b border-[var(--color-border)] lg:border-b-0 lg:border-r lg:last:border-r-0",
  )

  if (metric.href) return <Link href={metric.href} data-pressable className={sharedClass}>{content}</Link>
  if (metric.preset) return <button type="button" onClick={() => onSelect(metric.preset!)} className={sharedClass}>{content}</button>
  return <div className={cn(sharedClass, "cursor-default hover:bg-[var(--color-surface)]")}>{content}</div>
}
