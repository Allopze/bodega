import { plural } from "@/lib/mantencion/format"
import type { AssignCandidate } from "@/lib/services/mantencion/schedule-assign"

export type RowChange = "add" | "move" | "remove" | "keep" | "none"

/** Qué le pasaría a un equipo con la selección actual. */
export function changeFor(candidate: AssignCandidate, selected: ReadonlySet<string>, scheduleId: string): RowChange {
  const on = selected.has(candidate.vehicleId)
  if (on) return candidate.scheduleId === scheduleId ? "keep" : candidate.scheduleId ? "move" : "add"
  return candidate.scheduleId === scheduleId ? "remove" : "none"
}

export interface AssignmentSummary { selected: number; added: number; moved: number; removed: number }

/** Mismos números que el servidor recalcula al guardar. */
export function assignmentSummary(candidates: readonly AssignCandidate[], selected: ReadonlySet<string>, scheduleId: string): AssignmentSummary {
  const summary: AssignmentSummary = { selected: 0, added: 0, moved: 0, removed: 0 }
  for (const candidate of candidates) {
    const change = changeFor(candidate, selected, scheduleId)
    if (selected.has(candidate.vehicleId)) summary.selected++
    if (change === "add") summary.added++
    else if (change === "move") summary.moved++
    else if (change === "remove") summary.removed++
  }
  return summary
}

/** «12 equipos seleccionados · 3 se agregan · 1 cambia de pauta · 2 quedan sin pauta». */
export function assignmentSummaryText(summary: AssignmentSummary): string {
  const parts = [
    summary.added ? plural(summary.added, "se agrega", "se agregan") : "",
    summary.moved ? plural(summary.moved, "cambia de pauta", "cambian de pauta") : "",
    summary.removed ? plural(summary.removed, "queda sin pauta", "quedan sin pauta") : "",
  ].filter(Boolean)
  return `${plural(summary.selected, "equipo seleccionado", "equipos seleccionados")} · ${parts.length ? parts.join(" · ") : "sin cambios"}`
}
