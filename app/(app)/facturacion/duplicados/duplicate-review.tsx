"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { Badge } from "@/components/ui/badge"
import { formatMoney } from "@/lib/services/billing/money"
import { docTypeShortLabel, formatDateShort, providerLabel } from "@/lib/services/billing/labels"
import { detectDuplicatesAction, resolveDuplicateAction } from "./actions"

interface InvoiceSide {
  id: string
  docType: string
  folio: number
  issueDate: string
  totalAmount: number
  paidAmount: number
  source: string
}

export interface DuplicateCandidateRow {
  id: string
  classification: string
  notes: string[]
  currency: string
  counterpartyName: string
  left: InvoiceSide
  right: InvoiceSide
}

/**
 * Revisión lado a lado de un posible duplicado.
 *
 * Las dos facturas se muestran completas para que la decisión se tome mirando
 * los documentos, no un identificador. Fusionar exige **elegir cuál sobrevive**:
 * no hay un botón "fusionar" que decida por antigüedad, porque la más antigua no
 * es necesariamente la correcta.
 */
export function DuplicateReview({ candidates }: { candidates: DuplicateCandidateRow[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [merging, setMerging] = useState<string | null>(null)

  function resolve(candidateId: string, decision: "merge" | "dismiss", keepId?: string) {
    startTransition(async () => {
      const result = await resolveDuplicateAction({ candidateId, decision, keepId: keepId ?? null })
      if (result.ok) {
        toast.success(result.message)
        setMerging(null)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              const result = await detectDuplicatesAction()
              if (result.ok) toast.success(result.message)
              else toast.error(result.message)
              router.refresh()
            })
          }}
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
        >
          {isPending ? "Revisando…" : "Buscar posibles duplicados"}
        </button>
      </div>

      {candidates.map((candidate) => (
        <article
          key={candidate.id}
          className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
        >
          <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">{candidate.counterpartyName}</h2>
              <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-text-muted)]">
                {candidate.notes.map((note) => <li key={note}>· {note}</li>)}
              </ul>
            </div>
            <Badge variant={CLASSIFICATION_TONES[candidate.classification] ?? "neutral"}>
              {CLASSIFICATION_LABELS[candidate.classification] ?? candidate.classification}
            </Badge>
          </header>

          <div className="grid gap-3 sm:grid-cols-2">
            {[candidate.left, candidate.right].map((side) => (
              <div key={side.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                <Link
                  href={`/facturacion/facturas/${side.id}`}
                  className="text-sm font-medium text-[var(--color-text)] hover:underline"
                >
                  {docTypeShortLabel(side.docType)} {side.folio}
                </Link>
                <dl className="mt-1 space-y-0.5 text-xs text-[var(--color-text-muted)]">
                  <div>Emitida el {formatDateShort(side.issueDate)}</div>
                  <div className="tabular-nums">Total {formatMoney(side.totalAmount, candidate.currency)}</div>
                  <div className="tabular-nums">
                    Cobrado {formatMoney(side.paidAmount, candidate.currency)}
                  </div>
                  <div>Fuente: {providerLabel(side.source)}</div>
                </dl>

                {merging === candidate.id && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      const other = side.id === candidate.left.id ? candidate.right : candidate.left
                      const confirmed = confirm(
                        `Conservar ${docTypeShortLabel(side.docType)} ${side.folio} y anular ` +
                        `${docTypeShortLabel(other.docType)} ${other.folio}?\n\n` +
                        `Las referencias externas, vínculos y pagos de la anulada se mueven a la que conservas. ` +
                        `Nada se borra: la anulada conserva su historia.`,
                      )
                      if (!confirmed) return
                      resolve(candidate.id, "merge", side.id)
                    }}
                    className="mt-2 w-full rounded-[var(--radius-md)] bg-[var(--color-primary)] px-2 py-1.5 text-xs font-medium text-[var(--color-primary-contrast)] disabled:opacity-60"
                  >
                    Conservar esta
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            {merging === candidate.id ? (
              <button type="button" onClick={() => setMerging(null)} className="text-[var(--color-text-muted)] hover:underline">
                Cancelar fusión
              </button>
            ) : (
              <button
                type="button"
                disabled={isPending}
                onClick={() => setMerging(candidate.id)}
                className="font-medium text-[var(--color-primary-ink)] hover:underline disabled:opacity-60"
              >
                Fusionar — elegir cuál conservar
              </button>
            )}
            <button
              type="button"
              disabled={isPending}
              onClick={() => resolve(candidate.id, "dismiss")}
              className="text-[var(--color-text-muted)] hover:underline disabled:opacity-60"
            >
              No son el mismo documento
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  probable: "Probable duplicado",
  possible: "Posible duplicado",
  conflict: "Conflicto de datos",
}

const CLASSIFICATION_TONES: Record<string, "warning" | "info" | "danger"> = {
  probable: "warning",
  possible: "info",
  conflict: "danger",
}
