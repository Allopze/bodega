import { MetaBadge } from "@/components/states/state-badge"
import { ACTION_TYPE_LABELS, type ActionTypeOrUnknown } from "@/lib/mantencion/action-type"
import { ACTION_TYPE_BADGE } from "@/lib/mantencion/history-view"

/**
 * El tipo de un trabajo de mantención (preventiva, correctiva, predictiva o sin clasificar) como insignia: el
 * wrapper canónico del dominio, para que la lista, la vista previa, la ficha y la línea de tiempo lo pinten igual.
 * El color nunca va solo: la etiqueta siempre dice el tipo.
 */
export function ActionTypeBadge({ type, size, className }: { type: ActionTypeOrUnknown; size?: "sm" | "default" | "lg"; className?: string }) {
  return <MetaBadge meta={{ label: ACTION_TYPE_LABELS[type], variant: ACTION_TYPE_BADGE[type] }} size={size} dot className={className} />
}
