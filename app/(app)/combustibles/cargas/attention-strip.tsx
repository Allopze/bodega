import { FilterSummaryBar } from "@/components/ui/filter-summary-bar"
import { attentionClearText, buildFieldAttentionStats, isAttentionClear } from "@/lib/combustibles/cargas-attention"
import type { CargasSearchParams } from "@/lib/combustibles/fuel-log-params"
import type { FieldLoadAttention } from "@/lib/combustibles/fuel-log-shared"

/**
 * La tira de señales de terreno de Cargas. Con algo que mirar son las cuatro celdas (cada una
 * un atajo a su filtro); con las cuatro en cero es UNA línea tranquila, no cuatro tiles que
 * dicen «Ninguna» (UX-13). `periodInLabel` es el `inLabel` del período resuelto de la página.
 */
export function CargasAttentionStrip({ attention, searchParams, periodInLabel }: { attention: FieldLoadAttention; searchParams: CargasSearchParams; periodInLabel: string }) {
  if (isAttentionClear(attention)) {
    return <p className="mb-4 text-sm text-[var(--color-text-muted)]">{attentionClearText(periodInLabel)}</p>
  }
  return (
    <div role="group" aria-label="Cargas en terreno que piden atención">
      <FilterSummaryBar stats={buildFieldAttentionStats(attention, searchParams)} className="mb-4" />
    </div>
  )
}
