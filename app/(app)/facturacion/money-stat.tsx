import Link from "next/link"
import { ArrowRight, Info } from "@phosphor-icons/react/dist/ssr"
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
  surface = "card",
  emptyAction,
}: {
  label: string
  amounts: MoneyAmount[]
  detail: string
  origin: string
  tone?: "neutral" | "danger"
  href?: string
  /** `flat`: celda de `DashboardPanel` en el tablero (sin radio, borde propio ni sombra). */
  surface?: "card" | "flat"
  /**
   * Con la lista vacía, en vez de "Sin datos" dice qué hacer (regla A1). El
   * destino es `href`, así que sólo tiene efecto en un tile enlazado.
   */
  emptyAction?: { message: string; label: string }
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
          emptyAction ? (
            <p className="text-base font-semibold leading-snug text-[var(--color-text-muted)]">{emptyAction.message}</p>
          ) : (
            <p className="text-xl font-semibold text-[var(--color-text-subtle)]">Sin datos</p>
          )
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

      {amounts.length === 0 && emptyAction && href ? (
        <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)]">
          {emptyAction.label}
          <ArrowRight size={12} weight="bold" aria-hidden />
        </p>
      ) : (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{detail}</p>
      )}
    </>
  )

  const className = surface === "flat"
    ? cn(
      "block h-full border-l border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4",
      tone === "danger" && "shadow-[inset_3px_0_0_var(--color-danger)]",
      href && "transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-surface-2)]",
    )
    : cn(
      "block rounded-[var(--radius-xl)] border bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]",
      tone === "danger" ? "border-[var(--color-danger-tint)]" : "border-[var(--color-border)]",
      href && "transition-colors duration-[var(--duration-fast)] hover:border-[var(--color-primary)]",
    )

  return href
    ? <Link href={href} data-kpi-card="" className={className}>{content}</Link>
    : <div data-kpi-card="" className={className}>{content}</div>
}
