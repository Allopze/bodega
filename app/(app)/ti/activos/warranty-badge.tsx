import { MetaBadge } from "@/components/states/state-badge"
import { formatDate } from "@/lib/utils"
import { warrantyStatus } from "@/lib/services/ti/warranty"

/** Garantía con texto: «Vencida», «Vence en 15 días», «Vigente». Nunca solo color ni ícono (WCAG 1.4.1). */
export function WarrantyBadge({ endDate }: { endDate: string | null }) {
  if (!endDate) return <span className="text-xs text-[var(--color-text-muted)]">Sin garantía</span>
  return <MetaBadge meta={warrantyStatus(endDate)} title={`Fin de garantía: ${formatDate(endDate)}`} />
}
