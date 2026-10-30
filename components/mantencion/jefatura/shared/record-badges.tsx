import { Badge } from "@/components/ui/badge"
import { REVIEW_LABEL } from "@/lib/mantencion/format"
import type { MantRecordStatus, MantReview } from "@/lib/mantencion/types"

/**
 * Anulado / revisión de un registro. Un registro anulado sigue visible y
 * marcado (regla 13), así que «Anulado» manda sobre la revisión. «Pendiente»
 * no se pinta en las listas: es el estado por omisión y sólo agrega ruido.
 */
export function RecordStatusBadges({
  status,
  review,
  showPending = false,
}: {
  status: MantRecordStatus
  review: MantReview
  showPending?: boolean
}) {
  if (status === "anulado") return <Badge variant="danger" size="sm">Anulado</Badge>
  if (review === "observado") return <Badge variant="signal" size="sm">{REVIEW_LABEL.observado}</Badge>
  if (review === "revisado") return <Badge variant="success" size="sm">{REVIEW_LABEL.revisado}</Badge>
  return showPending ? <Badge variant="neutral" size="sm">Por revisar</Badge> : null
}
