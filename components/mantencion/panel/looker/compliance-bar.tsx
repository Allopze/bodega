import { cn, formatPercent } from "@/lib/utils"

/**
 * Barra de cumplimiento: verde de marca sobre el gris claro, con el valor en la punta.
 * El número es el que informa; el color no carga solo el estado. Sin dato no se dibuja
 * una barra en cero: se dice «Sin dato».
 */
export function ComplianceBar({
  value,
  digits = 0,
  className,
}: {
  value: number | null
  digits?: number
  className?: string
}) {
  if (value == null) return <span className="text-xs text-[var(--color-text-muted)]">Sin dato</span>
  const pct = Math.max(0, Math.min(100, value))
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="h-2 min-w-10 flex-1 rounded-full bg-[var(--color-surface-3)]" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "var(--mant-green)" }} />
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-2xs tabular-nums text-[var(--color-text)]">
        {formatPercent(value, digits)}
      </span>
    </span>
  )
}
