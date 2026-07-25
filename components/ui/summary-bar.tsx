import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

export interface SummaryStat {
  key: string
  label: string
  value: string | number
  icon?: React.ReactNode
  /** Si se setea, la celda es un link (p.ej. vista pre-filtrada). */
  href?: string
  /** "signal" pone naranja solo cuando el valor numérico es > 0 (alertas / críticas). */
  tone?: "signal"
  /** Etiqueta inline después del valor (p.ej. "2 crít."). */
  hint?: string
  /** Texto secundario bajo el valor (p.ej. desglose). Solo modo completo. */
  secondary?: string
  /** Mini barra de progreso 0–100. Solo modo completo. */
  progress?: number
}

interface SummaryBarProps {
  stats: SummaryStat[]
  className?: string
  /**
   * Variante inline (separada por puntos) para espacios ajustados como el
   * TopBar/headerActions. Sin bordes entre celdas, sin progress/secondary.
   */
  compact?: boolean
}

/**
 * Tira editorial de resumen para listas con pocos registros. Sin tarjetas: una
 * banda acotada por reglas hairline con divisores (truco de margen negativo) que
 * adapta a cualquier ancho. Mismo lenguaje visual que la MetricBar del dashboard.
 * Los ceros se atenúan; las señales (>0) usan el naranja "signal".
 *
 * Modo `compact`: fila inline separada por puntos para el TopBar/headerActions;
 * replica el patrón WarehouseHeaderMetrics.
 *
 * Pensado para usarse entre el PageHeader y la tabla. No renderiza nada si no
 * hay stats; deja el caso vacío (0 filas) al EmptyState de la tabla.
 */
const SummaryBarInner = React.memo(function SummaryBarInner({ stats, className, compact = false }: SummaryBarProps) {
  if (stats.length === 0) return null
  return compact ? (
    <CompactStrip stats={stats} className={className} />
  ) : (
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

/** Variante inline: label muted + valor mono, separados por "·". Para TopBar. */
function CompactStrip({ stats, className }: { stats: SummaryStat[]; className?: string }) {
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
            <span
              className={cn(
                "font-mono font-semibold tabular-nums",
                signalActive
                  ? "text-[var(--color-signal-ink)]"
                  : isZero
                    ? "text-[var(--color-text-faint)]"
                    : "text-[var(--color-text)]",
              )}
            >
              {stat.value}
            </span>
          </div>
        )
      })}
    </div>
  )
}

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
        {typeof stat.progress === "number" && (
          <div
            role="progressbar"
            aria-label={stat.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.max(0, stat.progress))}
            className="mb-1.5 h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]"
          >
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out)]"
              style={{ width: `${Math.min(100, Math.max(0, stat.progress))}%` }}
            />
          </div>
        )}
      </div>
      {stat.secondary && (
        <p className="mt-1 text-[11px] text-[var(--color-text-subtle)]">{stat.secondary}</p>
      )}
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
