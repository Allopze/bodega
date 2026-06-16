import Link from "next/link"
import { CheckCircle } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

export interface HeaderSignal {
  key:    string
  label:  string
  value:  number
  /** If set, the chip links to its target (e.g. the filtered view / next step). */
  href?:  string
  /** "signal" tints the chip orange — use for alerts/backlog that needs attention. */
  tone?:  "signal"
}

/**
 * Tira compacta de señales para el header sticky (headerActions del PageHeader).
 * Complementa —no reemplaza— el desglose del cuerpo: aquí solo viven las señales
 * accionables (value > 0). Cuando no hay ninguna activa muestra un indicador
 * "Al día", de modo que la cápsula superior nunca queda vacía/decorativa.
 *
 * Componente de servidor: puede pasarse directamente como `headerActions`.
 * El TopBar ya lo limita a xl+; el cuerpo cubre los breakpoints menores.
 */
export function HeaderSignals({
  signals,
  allClearLabel = "Al día",
}: {
  signals: HeaderSignal[]
  allClearLabel?: string
}) {
  const active = signals.filter((signal) => signal.value > 0)

  if (active.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-subtle)]">
        <CheckCircle size={14} weight="bold" className="text-[var(--color-success-ink)]" />
        {allClearLabel}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      {active.map((signal) => (
        <SignalChip key={signal.key} signal={signal} />
      ))}
    </div>
  )
}

function SignalChip({ signal }: { signal: HeaderSignal }) {
  const isSignal = signal.tone === "signal"

  const chip = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        isSignal
          ? "bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]"
          : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
      )}
    >
      <span className="font-mono font-semibold tabular-nums">{signal.value}</span>
      {signal.label}
    </span>
  )

  if (signal.href) {
    return (
      <Link
        href={signal.href}
        data-pressable
        className="rounded-full transition-transform duration-[var(--duration-fast)] hover:brightness-95 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        {chip}
      </Link>
    )
  }

  return chip
}
