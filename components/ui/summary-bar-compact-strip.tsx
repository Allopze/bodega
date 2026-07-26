import * as React from "react"
import { cn } from "@/lib/utils"
import type { SummaryStat } from "./summary-bar"

/** Variante inline para encabezados compactos. */
export function SummaryBarCompactStrip({ stats, className }: { stats: SummaryStat[]; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 whitespace-nowrap text-xs", className)}>
      {stats.map((stat, i) => {
        const numeric = typeof stat.value === "number" ? stat.value : Number.parseFloat(String(stat.value)) || 0
        const isZero = numeric === 0
        const signalActive = stat.tone === "signal" && numeric > 0
        return (
          <div key={stat.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-[var(--color-border-strong)]" aria-hidden>·</span>}
            <span className="text-[var(--color-text-muted)]">{stat.label}</span>
            <span className={cn(
              "font-mono font-semibold tabular-nums",
              signalActive ? "text-[var(--color-signal-ink)]" : isZero ? "text-[var(--color-text-faint)]" : "text-[var(--color-text)]",
            )}>{stat.value}</span>
          </div>
        )
      })}
    </div>
  )
}
