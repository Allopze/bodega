import type { StateMetaInput } from "@/components/states/state-badge"
import type { ProgramOccurrenceView } from "@/lib/services/miper/program-queries"

/** Rótulo del resultado vigente de una ocurrencia: el enum nunca se muestra. */
export function occurrenceBadge(occurrence: ProgramOccurrenceView, today: string): StateMetaInput {
  if (occurrence.outcome === "done") return occurrence.late
    ? { label: "Fuera de plazo", variant: "warning" }
    : { label: "Realizada", variant: "success" }
  if (occurrence.outcome === "not_done") return { label: "No realizada", variant: "danger" }
  if (occurrence.outcome === "superseded") return { label: "Reemplazada", variant: "outline" }
  return occurrence.dueOn < today ? { label: "Vencida", variant: "danger" } : { label: "Pendiente", variant: "default" }
}

/** Rótulo del registro: vigente, anulado, o el resultado que quedó en historial. */
export function recordBadge(record: { outcome: string; voidedAt: string | null }): StateMetaInput {
  if (record.voidedAt) return { label: "Anulado", variant: "outline" }
  return record.outcome === "done" ? { label: "Se hizo", variant: "success" } : { label: "No se hizo", variant: "danger" }
}
