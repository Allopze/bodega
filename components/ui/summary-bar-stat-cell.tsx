import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { SummaryStat } from "./summary-bar"

export function SummaryBarStatCell({ stat }: { stat: SummaryStat }) {
  const numeric = typeof stat.value === "number" ? stat.value : Number.parseFloat(String(stat.value)) || 0
  const isZero = typeof stat.value === "number" && stat.value === 0
  const signalActive = stat.tone === "signal" && numeric > 0

  const body = (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5">
        {stat.icon && <span className={cn(
          "shrink-0 transition-colors duration-[var(--duration-fast)]",
          signalActive ? "text-[var(--color-signal)]" : "text-[var(--color-text-faint)]",
          stat.href && "group-hover:text-[var(--color-primary)]",
        )}>{stat.icon}</span>}
        <span className={cn("text-eyebrow truncate transition-colors duration-[var(--duration-fast)]", stat.href && "group-hover:text-[var(--color-primary)]")}>{stat.label}</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className={cn(
          "font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight",
          signalActive ? "text-[var(--color-signal-ink)]" : isZero ? "text-[var(--color-text-faint)]" : "text-[var(--color-text)]",
        )}>{stat.value}</span>
        {stat.hint && <span className={cn(
          "mb-0.5 font-mono text-[11px] font-semibold tabular-nums",
          signalActive ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text-subtle)]",
        )}>{stat.hint}</span>}
        {typeof stat.progress === "number" && <div
          role="progressbar"
          aria-label={stat.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.max(0, stat.progress))}
          className="mb-1.5 h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]"
        ><div className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out)]" style={{ width: `${Math.min(100, Math.max(0, stat.progress))}%` }} /></div>}
      </div>
      {stat.secondary && <p className="mt-1 text-[11px] text-[var(--color-text-subtle)]">{stat.secondary}</p>}
    </div>
  )

  const cellClass = "group flex-1 min-w-[8.5rem] border-l border-t border-[var(--color-border)]"
  return stat.href
    ? <Link href={stat.href} data-pressable className={cn(cellClass, "block hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]")}>{body}</Link>
    : <div className={cellClass}>{body}</div>
}
