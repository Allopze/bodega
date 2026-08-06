import Link from "next/link"
import { Info } from "@phosphor-icons/react/dist/ssr"
import { formatMoney, type MoneyAmount } from "@/lib/services/billing/money"
import { cn } from "@/lib/utils"

/**
 * Indicador monetario del módulo.
 *
 * Tres decisiones deliberadas:
 * 1. **Nunca suma monedas distintas.** Recibe una lista por moneda y las muestra
 *    apiladas; si hay más de una, se ven las dos cifras, no un total falso.
 * 2. **Declara su origen.** `origin` explica de dónde sale la cifra; sin eso un
 *    número en un panel es una afirmación sin respaldo.
 * 3. **Distingue "sin datos" de "cero".** Una lista vacía dice "sin datos", no
 *    muestra $0, porque significan cosas distintas.
 * 4. **Cuenta como tile.** `data-kpi-card` es el ancla que usa
 *    `e2e/densidad-kpi.spec.ts` para contar indicadores por pantalla. Sin él,
 *    una fila de cuatro `MoneyStat` era invisible para el tope de densidad —y
 *    la sección Finanzas del tablero está hecha de ellos.
 */
export function MoneyStat({
  label,
  amounts,
  detail,
  origin,
  tone = "neutral",
  href,
}: {
  label: string
  amounts: MoneyAmount[]
  detail: string
  origin: string
  tone?: "neutral" | "danger"
  href?: string
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
        <span
          className="shrink-0 text-[var(--color-text-subtle)]"
          title={origin}
          aria-label={`Origen del dato: ${origin}`}
        >
          <Info size={14} />
        </span>
      </div>

      <div className="mt-1.5">
        {amounts.length === 0 ? (
          <p className="text-xl font-semibold text-[var(--color-text-subtle)]">Sin datos</p>
        ) : (
          amounts.map((money) => (
            <p
              key={money.currency}
              className={cn(
                "text-xl font-semibold tabular-nums",
                tone === "danger" ? "text-[var(--color-danger-ink)]" : "text-[var(--color-text)]",
              )}
            >
              {formatMoney(money.amount, money.currency)}
              {amounts.length > 1 && (
                <span className="ml-1 text-xs font-normal text-[var(--color-text-muted)]">{money.currency}</span>
              )}
            </p>
          ))
        )}
      </div>

      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{detail}</p>
    </>
  )

  const className = cn(
    "block rounded-[var(--radius-xl)] border bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]",
    tone === "danger" ? "border-[var(--color-danger-tint)]" : "border-[var(--color-border)]",
    href && "transition-colors duration-[var(--duration-fast)] hover:border-[var(--color-primary)]",
  )

  return href
    ? <Link href={href} data-kpi-card="" className={className}>{content}</Link>
    : <div data-kpi-card="" className={className}>{content}</div>
}
