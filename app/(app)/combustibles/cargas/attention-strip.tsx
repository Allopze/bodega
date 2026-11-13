import Link from "next/link"
import { FilterSummaryBar } from "@/components/ui/filter-summary-bar"
import { attentionClearText, buildFieldAttentionStats, isAttentionClear } from "@/lib/combustibles/cargas-attention"
import { withCargasParams, type CargasSearchParams } from "@/lib/combustibles/fuel-log-params"
import type { FieldLoadAttention } from "@/lib/combustibles/fuel-log-shared"

/**
 * La tira de señales de terreno de Cargas. Con algo que mirar son las cuatro celdas (cada una
 * un atajo a su filtro); con las cuatro en cero es UNA línea tranquila, no cuatro tiles que
 * dicen «Ninguna» (UX-13). `periodInLabel` es el `inLabel` del período resuelto de la página
 * (sin preposición). `pending` son las cargas de la lista con algo abierto: la línea tranquila
 * no puede decir «nada pendiente» si la lista las muestra, así que las nombra y enlaza.
 */
export function CargasAttentionStrip({ attention, searchParams, periodInLabel, pending = 0 }: { attention: FieldLoadAttention; searchParams: CargasSearchParams; periodInLabel: string; pending?: number }) {
  if (isAttentionClear(attention)) {
    return (
      <p className="mb-4 text-sm text-[var(--color-text-muted)]">
        {attentionClearText(periodInLabel, pending)}
        {pending > 0 ? <>. <Link href={withCargasParams(searchParams, { pendiente: "si" })} scroll={false} replace className="font-medium text-[var(--color-primary-ink)] hover:underline">Ver cuáles</Link></> : null}
      </p>
    )
  }
  return (
    <div role="group" aria-label="Cargas en terreno que piden atención">
      <FilterSummaryBar stats={buildFieldAttentionStats(attention, searchParams)} className="mb-4" />
    </div>
  )
}
