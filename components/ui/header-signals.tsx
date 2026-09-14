import Link from "next/link"
import { CheckCircle, X } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

export interface HeaderSignal {
  key:    string
  label:  string
  value:  number
  /** If set, the chip links to its target (e.g. the filtered view / next step). */
  href?:  string
  /** "signal" tints the chip orange — use for alerts/backlog that needs attention. */
  tone?:  "signal"
  /**
   * La vista que este chip filtra es la que se está mirando. Entonces `href` es
   * la salida —la misma pantalla sin el filtro— y el chip lo dice: se marca como
   * seleccionado y su nombre accesible pasa a "Quitar filtro: …".
   *
   * Sin esto, el chip llevaba a la vista que ya estaba abierta y el filtro no
   * tenía ninguna salida en pantalla: quien entraba desde la señal quedaba
   * mirando una lista recortada, sin señal de que lo estuviera y sin forma de
   * volver salvo re-navegar desde el panel lateral.
   */
  active?: boolean
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
        signal.active
          ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
          : isSignal
            ? "bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]"
            : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
      )}
    >
      <span className="font-mono font-semibold tabular-nums">{signal.value}</span>
      {signal.label}
      {signal.active && <X size={11} weight="bold" aria-hidden />}
    </span>
  )

  if (signal.href) {
    return (
      <Link
        href={signal.href}
        data-pressable
        aria-label={signal.active ? `Quitar filtro: ${signal.label}` : undefined}
        aria-current={signal.active ? "page" : undefined}
        className="rounded-full transition-transform duration-[var(--duration-fast)] hover:brightness-95  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        {chip}
      </Link>
    )
  }

  return chip
}
