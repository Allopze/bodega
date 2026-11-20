import { cn } from "@/lib/utils"
import { formatIdlePct, formatTargetPct } from "./format"

/**
 * % de ralentí con una barra y la marca de la meta. La barra mide de 0 a 100 %; la marca es la meta, así
 * que se ve de un vistazo cuánto falta o sobra. Sin dato no hay barra: sólo «—».
 */
export function IdleBar({ pct, target, className }: { pct: number | null; target: number; className?: string }) {
  if (pct === null) return <span className={cn("font-mono tabular-nums text-[var(--color-text-subtle)]", className)}>—</span>
  const width = `${Math.min(Math.max(pct, 0), 1) * 100}%`
  const over = pct > target
  return (
    <span className={cn("inline-flex min-w-[8.5rem] items-center gap-2", className)}>
      <span className="w-14 shrink-0 text-right font-mono text-sm tabular-nums">{formatIdlePct(pct)}</span>
      <span
        role="img"
        aria-label={`Ralentí ${formatIdlePct(pct)}, meta ${formatTargetPct(target)}`}
        className="relative h-2 w-16 shrink-0 rounded-full bg-[var(--color-surface-3)] sm:w-24"
      >
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-[var(--color-signal)]" : "bg-[var(--color-primary)]")}
          style={{ width }}
        />
        <span
          aria-hidden="true"
          className="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-[var(--color-text)]"
          style={{ left: `${target * 100}%` }}
        />
      </span>
    </span>
  )
}
