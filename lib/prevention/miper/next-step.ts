/**
 * La tarjeta «Siguiente paso» (spec §5.6): una sola recomendación, la primera
 * regla que aplica. Reemplaza al texto suelto que pintaba `WorkflowBar`.
 */
import type { CompletenessIssue } from "./completeness"
import { firstPendingBySeverity } from "./entry-navigation"
import type { MiperEntrySnapshot } from "./snapshot"
import type { WorkspaceMode } from "./workspace-mode"

export type NextStepAction =
  | { kind: "ficha" }
  | { kind: "riesgo"; entryId: string }
  | { kind: "tab"; tab: "revision" }
  | { kind: "filtro"; completitud: "pendientes" }

export type NextStep = { tone: "info" | "warning" | "success"; title: string; description: string; action: NextStepAction | null; secondary: NextStepAction | null }

export type NextStepInput = {
  mode: Pick<WorkspaceMode, "canEdit" | "canReviewTechnical" | "canApproveLegal" | "canRespond" | "isSubmitter" | "readOnlyReason">
  status: string
  reviewState: string
  hasOpenRound: boolean
  hasPendingChanges: boolean
  versionLabel: string
  issues: readonly CompletenessIssue[]
  openObservations: number
  rows: readonly MiperEntrySnapshot[]
}

const step = (tone: NextStep["tone"], title: string, description = "", action: NextStepAction | null = null, secondary: NextStepAction | null = null): NextStep => ({ tone, title, description, action, secondary })

export function nextStepFor(input: NextStepInput): NextStep | null {
  const { mode, rows } = input
  if (mode.readOnlyReason) return step("info", mode.readOnlyReason)
  if (mode.isSubmitter && input.hasOpenRound) return step("info", "Enviaste esta ronda: la revisa otra persona.", "Puedes seguir editando; los cambios quedan para la ronda siguiente.")
  if (mode.canReviewTechnical || mode.canApproveLegal) {
    const critical = rows.filter((row) => row.classification === "important" || row.classification === "intolerable")
    const target = firstPendingBySeverity(rows, new Set(critical.map((row) => row.id))) ?? [...rows].sort((a, b) => a.rowNumber - b.rowNumber)[0]?.id ?? null
    return step("warning", "Revisa la versión enviada", `${rows.length} riesgos · ${critical.length} Importantes o Intolerables`, target ? { kind: "riesgo", entryId: target } : null)
  }
  if (mode.canRespond && input.openObservations > 0) {
    return step("warning", `Responde ${input.openObservations} observación(es)`, "Cada respuesta queda junto a la observación; después reenvía a revisión.", { kind: "tab", tab: "revision" })
  }
  if (mode.canEdit) {
    const errors = input.issues.filter((issue) => issue.severity === "error")
    // «La matriz no tiene registros» es de cabecera, pero no se corrige en la ficha: se agrega una tarea.
    const header = errors.filter((issue) => issue.scope === "header" && issue.field !== "entries")
    if (header.length > 0) return step("warning", `Completa la ficha del documento (${header.length} dato(s))`, header[0]!.message, { kind: "ficha" })
    if (rows.length === 0) return step("info", "Empieza por la primera tarea", "La matriz todavía no tiene riesgos: usa «Nueva tarea» en la cabecera.")
    const pending = new Set(errors.flatMap((issue) => (issue.entryId ? [issue.entryId] : [])))
    if (pending.size > 0) {
      const first = firstPendingBySeverity(rows, pending)
      return step("warning", `Faltan datos en ${pending.size} riesgo(s)`, "Empieza por los más graves; «Siguiente pendiente» te lleva al próximo.", first ? { kind: "riesgo", entryId: first } : null, { kind: "filtro", completitud: "pendientes" })
    }
    if (input.status === "draft" || input.reviewState === "observed") return step("success", "Lista para enviar a revisión", "Usa «Enviar a revisión» en la cabecera.")
  }
  if (input.status === "published" && input.hasPendingChanges) return step("info", `Hay cambios sin revisar desde ${input.versionLabel}`, "Envíalos a revisión cuando estén listos.")
  return null
}
