import { MetaBadge } from "@/components/states/state-badge"
import type { PartsNoteStatus } from "@/lib/services/mantencion/parts/types"
import { NOTE_STATUS_TEXT, NOTE_STATUS_TONE } from "./parts-notes-format"

/** El estado de una nota de pedido (los nueve) con su tono: la insignia de la bandeja, de la ficha y del historial. */
export function NoteStatusBadge({ status }: { status: PartsNoteStatus }) {
  return <MetaBadge meta={{ label: NOTE_STATUS_TEXT[status], variant: NOTE_STATUS_TONE[status] }} size="sm" />
}
