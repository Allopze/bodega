"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Sparkle, Warning } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { Badge } from "@/components/ui/badge"
import { formatMoney } from "@/lib/services/billing/money"
import { confidenceLabel, formatDateShort } from "@/lib/services/billing/labels"
import { generateSuggestionsAction, resolvePaymentSuggestionAction } from "./actions"

export interface SuggestionRow {
  paymentId: string
  invoiceId: string
  folio: number
  clientName: string
  paymentDate: string
  amount: number
  currency: string
  confidence: string | null
  evidence: { evidence?: string[]; warnings?: string[] }
  outstandingAmount: number
}

/**
 * Sugerencias de conciliación pendientes de decisión.
 *
 * Cada tarjeta muestra la **evidencia concreta** que sustenta la propuesta y las
 * advertencias que la debilitan, porque confirmar un pago sin ver por qué se
 * propuso es exactamente el error que este módulo intenta evitar. La sugerencia
 * no descuenta nada del saldo hasta que alguien la confirma.
 */
export function SuggestionsPanel({ suggestions }: { suggestions: SuggestionRow[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [rejecting, setRejecting] = useState<string | null>(null)

  function resolve(paymentId: string, decision: "confirm" | "reject", reason?: string) {
    startTransition(async () => {
      const result = await resolvePaymentSuggestionAction({ paymentId, decision, reason: reason ?? null })
      if (result.ok) {
        toast.success(result.message)
        setRejecting(null)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <section
      aria-labelledby="sugerencias-titulo"
      className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="sugerencias-titulo" className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
            <Sparkle size={14} weight="fill" className="text-[var(--color-info-ink)]" />
            Sugerencias de conciliación
          </h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Propuestas de la plataforma. No descuentan del saldo hasta que una persona las confirma.
          </p>
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              const result = await generateSuggestionsAction()
              if (result.ok) toast.success(result.message)
              else toast.error(result.message)
              router.refresh()
            })
          }}
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
        >
          {isPending ? "Buscando…" : "Buscar coincidencias"}
        </button>
      </header>

      {suggestions.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          No hay sugerencias pendientes. La conciliación necesita movimientos bancarios cargados: hoy la
          plataforma no tiene una fuente financiera activa, así que los pagos se registran a mano.
        </p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((suggestion) => {
            const confidence = confidenceLabel(suggestion.confidence)
            const evidence = suggestion.evidence.evidence ?? []
            const warnings = suggestion.evidence.warnings ?? []
            const isPartial = suggestion.amount < suggestion.outstandingAmount

            return (
              <li key={suggestion.paymentId} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)]">
                      <Link href={`/facturacion/facturas/${suggestion.invoiceId}`} className="hover:underline">
                        Folio {suggestion.folio}
                      </Link>
                      {" · "}{suggestion.clientName}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Movimiento del {formatDateShort(suggestion.paymentDate)} por{" "}
                      <strong className="tabular-nums text-[var(--color-text)]">
                        {formatMoney(suggestion.amount, suggestion.currency)}
                      </strong>
                      {" · saldo de la factura "}
                      <span className="tabular-nums">{formatMoney(suggestion.outstandingAmount, suggestion.currency)}</span>
                      {isPartial && " (quedaría pago parcial)"}
                    </p>
                  </div>
                  {confidence && <Badge variant={confidence.tone}>{confidence.label}</Badge>}
                </div>

                {evidence.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-[var(--color-text-muted)]">
                    {evidence.map((item) => <li key={item}>· {item}</li>)}
                  </ul>
                )}

                {warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-warning-ink)]">
                    {warnings.map((item) => (
                      <li key={item} className="flex items-start gap-1">
                        <Warning size={12} weight="fill" className="mt-0.5 shrink-0" /> {item}
                      </li>
                    ))}
                  </ul>
                )}

                {rejecting === suggestion.paymentId ? (
                  <form
                    className="mt-2 flex flex-wrap items-end gap-2"
                    action={(formData) => resolve(suggestion.paymentId, "reject", String(formData.get("reason") ?? ""))}
                  >
                    <label className="flex-1">
                      <span className="mb-0.5 block text-xs text-[var(--color-text-muted)]">Motivo del descarte</span>
                      <input name="reason" maxLength={500} className={inputClass} />
                    </label>
                    <button type="submit" disabled={isPending} className={dangerButtonClass}>Descartar</button>
                    <button type="button" onClick={() => setRejecting(null)} className="pb-2 text-xs text-[var(--color-text-muted)]">
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <div className="mt-2 flex gap-3 text-xs">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        const message = isPartial
                          ? `Confirmar ${formatMoney(suggestion.amount, suggestion.currency)} como pago PARCIAL del folio ${suggestion.folio}?`
                          : `Confirmar ${formatMoney(suggestion.amount, suggestion.currency)} como pago del folio ${suggestion.folio}?`
                        if (!confirm(message)) return
                        resolve(suggestion.paymentId, "confirm")
                      }}
                      className="font-medium text-[var(--color-primary-ink)] hover:underline disabled:opacity-60"
                    >
                      Confirmar pago
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setRejecting(suggestion.paymentId)}
                      className="text-[var(--color-text-muted)] hover:underline disabled:opacity-60"
                    >
                      Descartar
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)]"

const dangerButtonClass =
  "rounded-[var(--radius-md)] border border-[var(--color-danger-tint)] px-3 py-1.5 text-xs font-medium text-[var(--color-danger-ink)] disabled:opacity-60"
