import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

export interface SummaryStat {
  key:    string
  label:  string
  value:  string | number
  icon?:  React.ReactNode
  /** If set, the cell becomes a link (e.g. a pre-filtered view). */
  href?:  string
  /** "signal" turns orange only when the numeric value is > 0 (alerts / criticals). */
  tone?:  "signal"
  /** Optional inline tag after the value (e.g. "2 crít."). */
  hint?:  string
}

/**
 * Tira editorial de resumen para listas con pocos registros. Sin tarjetas: una
 * banda acotada por reglas hairline con divisores (truco de margen negativo) que
 * adapta a cualquier ancho. Mismo lenguaje visual que la MetricBar del dashboard.
 * Los ceros se atenúan; las señales (>0) usan el naranja "signal".
 *
 * Pensado para usarse entre el PageHeader y la tabla. No renderiza nada si no
 * hay stats; deja el caso vacío (0 filas) al EmptyState de la tabla.
 */
const SummaryBarInner = React.memo(function SummaryBarInner({ stats, className }: { stats: SummaryStat[]; className?: string }) {
  if (stats.length === 0) return null

  return (
    <div className={cn("overflow-hidden border-y border-[var(--color-border)]", className)}>
      <div className="-ml-px -mt-px flex flex-wrap">
        {stats.map((stat) => (
          <StatCell key={stat.key} stat={stat} />
        ))}
      </div>
    </div>
  )
})


export const SummaryBar = SummaryBarInner
function StatCell({ stat }: { stat: SummaryStat }) {
  const numeric = typeof stat.value === "number" ? stat.value : Number.parseFloat(String(stat.value)) || 0
  const isZero = typeof stat.value === "number" && stat.value === 0
  const signalActive = stat.tone === "signal" && numeric > 0

  const body = (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5">
        {stat.icon && (
          <span
            className={cn(
              "shrink-0 transition-colors duration-[var(--duration-fast)]",
              signalActive ? "text-[var(--color-signal)]" : "text-[var(--color-text-faint)]",
              stat.href && "group-hover:text-[var(--color-primary)]",
            )}
          >
            {stat.icon}
          </span>
        )}
        <span
          className={cn(
            "text-eyebrow truncate transition-colors duration-[var(--duration-fast)]",
            stat.href && "group-hover:text-[var(--color-primary)]",
          )}
        >
          {stat.label}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span
          className={cn(
            "font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight",
            signalActive
              ? "text-[var(--color-signal-ink)]"
              : isZero
                ? "text-[var(--color-text-faint)]"
                : "text-[var(--color-text)]",
          )}
        >
          {stat.value}
        </span>
        {stat.hint && (
          <span
            className={cn(
              "mb-0.5 font-mono text-[11px] font-semibold tabular-nums",
              signalActive ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text-subtle)]",
            )}
          >
            {stat.hint}
          </span>
        )}
      </div>
    </div>
  )

  const cellClass = "group flex-1 min-w-[8.5rem] border-l border-t border-[var(--color-border)]"

  if (stat.href) {
    return (
      <Link
        href={stat.href}
        data-pressable
        className={cn(
          cellClass,
          "block hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
        )}
      >
        {body}
      </Link>
    )
  }

  return <div className={cellClass}>{body}</div>
}
