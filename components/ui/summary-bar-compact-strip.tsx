import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { SummaryStat } from "./summary-bar"

/** Variante inline para encabezados compactos. */
export function SummaryBarCompactStrip({ stats, className }: { stats: SummaryStat[]; className?: string }) {
  return (
    // Envuelve por celda —cada una sigue `whitespace-nowrap`— para caber en el
    // TopBar a 1024 px: toda la tira en una línea lo desbordaba (Bodega, +59 px).
    <div className={cn("flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-xs", className)}>
      {stats.map((stat, i) => {
        const numeric = typeof stat.value === "number" ? stat.value : Number.parseFloat(String(stat.value)) || 0
        const isZero = numeric === 0
        const signalActive = stat.tone === "signal" && numeric > 0
        const content = (
          <>
            <span className="text-[var(--color-text-muted)]">{stat.label}</span>
            <span className={cn(
              "font-mono font-semibold tabular-nums",
              signalActive ? "text-[var(--color-signal-ink)]" : isZero ? "text-[var(--color-text-faint)]" : "text-[var(--color-text)]",
            )}>{stat.value}</span>
            {stat.hint && <span className="text-text-subtle">{stat.hint}</span>}
          </>
        )
        return (
          <div key={stat.key} className="flex items-center gap-2 whitespace-nowrap">
            {i > 0 && <span className="text-[var(--color-border-strong)]" aria-hidden>·</span>}
            {stat.href ? (
              <Link href={stat.href} className="flex items-center gap-2 transition-colors hover:text-[var(--color-primary)]" title={stat.label}>
                {content}
              </Link>
            ) : content}
          </div>
        )
      })}
    </div>
  )
}
