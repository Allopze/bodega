import * as React from "react"
import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { MetaBadge } from "@/components/states/state-badge"
import { pluralize } from "@/lib/utils"
import { REQUEST_TYPE_LABELS, REQUEST_TYPE_VARIANTS } from "./types"
import type { QuotationPendingRequest } from "./types"

/** Antigüedad legible: "hoy", "1 día", "5 días". */
export function ageLabel(days: number | null): string {
  if (days === null) return "—"
  if (days === 0) return "Hoy"
  return `${days} ${pluralize(days, "día", "días")}`
}

/**
 * ADQ-05 · "Por elegir cotización".
 *
 * Repuestos y servicios no pasan por la cola ítem-a-ítem: se aprueban eligiendo
 * una cotización en el detalle de la solicitud. Sin esta sección esas solicitudes
 * no aparecían en ninguna parte de Aprobaciones y la cola podía decir "Sin ítems
 * pendientes" con trabajo esperando. Es una lista compacta de enlaces: la acción
 * ocurre en el detalle, no aquí.
 */
export function QuotationPendingSection({
  requests,
  total,
}: {
  requests: QuotationPendingRequest[]
  total: number
}) {
  if (requests.length === 0) return null
  return (
    <section aria-labelledby="quotation-pending-title" className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
        <h2 id="quotation-pending-title" className="text-sm font-semibold text-[var(--color-text)]">
          Por elegir cotización <span className="font-mono tabular-nums text-[var(--color-text-subtle)]">({total})</span>
        </h2>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          Repuestos y servicios se aprueban eligiendo una cotización en el detalle de la solicitud.
        </p>
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {requests.map((r) => (
          <li key={r.id}>
            <Link
              href={`/solicitudes/${r.id}`}
              aria-label={`Elegir cotización de ${r.code}`}
              className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-[var(--color-primary-tint)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)]"
            >
              <span className="font-mono text-sm font-semibold text-[var(--color-text)]">{r.code}</span>
              <MetaBadge
                meta={{ label: REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType, variant: REQUEST_TYPE_VARIANTS[r.requestType] ?? "default" }}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-muted)]">{r.worksiteName}</span>
              <span className="text-xs text-[var(--color-text-subtle)]">
                {r.itemCount} {pluralize(r.itemCount, "ítem", "ítems")} · {ageLabel(r.ageDays)}
              </span>
              <ArrowRight size={14} aria-hidden className="text-[var(--color-text-subtle)]" />
            </Link>
          </li>
        ))}
      </ul>
      {total > requests.length && (
        <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-subtle)]">
          Mostrando {requests.length} de {total}, las más antiguas primero.
        </p>
      )}
    </section>
  )
}
