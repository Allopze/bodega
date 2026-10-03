/**
 * La tarjeta «Siguiente paso» (spec §5.6): una sola recomendación, la primera
 * regla que aplica. Reemplaza al texto suelto que pintaba `WorkflowBar`.
 */
import { countOf } from "@/lib/utils"
import type { CompletenessIssue } from "./completeness"
import { firstPendingBySeverity } from "./entry-navigation"
import type { MiperEntrySnapshot } from "./snapshot"
import type { WorkspaceMode } from "./workspace-mode"

export type NextStepAction =
  | { kind: "ficha" }
  /** `purpose` da el rótulo: «Siguiente pendiente» para quien completa, «Empezar la revisión» para quien revisa. */
  | { kind: "riesgo"; entryId: string; purpose: "pending" | "review" }
  | { kind: "tab"; tab: "revision" }
  | { kind: "filtro"; completitud: "pendientes" }

/**
 * `scope` dice dónde se ve: `everywhere` (el motivo de solo lectura, también en
 * la tarea y en el editor, que es donde se intenta editar) o `root` (el resto,
 * sólo en la raíz de la matriz). Lo decide la regla, no quien la pinta.
 */
export type NextStep = { tone: "info" | "warning" | "success"; title: string; description: string; action: NextStepAction | null; secondary: NextStepAction | null; scope: "everywhere" | "root" }

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

const step = (tone: NextStep["tone"], title: string, description = "", action: NextStepAction | null = null, secondary: NextStepAction | null = null, scope: NextStep["scope"] = "root"): NextStep => ({ tone, title, description, action, secondary, scope })

export function nextStepFor(input: NextStepInput): NextStep | null {
  const { mode, rows } = input
  if (mode.readOnlyReason) return step("info", mode.readOnlyReason, "", null, null, "everywhere")
  if (mode.isSubmitter && input.hasOpenRound) return step("info", "Enviaste esta ronda: la revisa otra persona.", "Puedes seguir editando; los cambios quedan para la ronda siguiente.")
  // Revisar es sobre la foto enviada: sin ronda abierta no hay qué revisar (spec §5.6, regla 2).
  if ((mode.canReviewTechnical || mode.canApproveLegal) && input.hasOpenRound) {
    const critical = rows.filter((row) => row.classification === "important" || row.classification === "intolerable")
    const target = firstPendingBySeverity(rows, new Set(critical.map((row) => row.id))) ?? [...rows].sort((a, b) => a.rowNumber - b.rowNumber)[0]?.id ?? null
    return step("warning", "Revisa la versión enviada", `${countOf(rows.length, "riesgo")} · ${countOf(critical.length, "Importante o Intolerable", "Importantes o Intolerables")}`, target ? { kind: "riesgo", entryId: target, purpose: "review" } : null)
  }
  if (mode.canRespond && input.openObservations > 0) {
    return step("warning", `Responde ${countOf(input.openObservations, "observación")}`, "Cada respuesta queda junto a la observación; después reenvía a revisión.", { kind: "tab", tab: "revision" })
  }
  if (mode.canEdit) {
    const errors = input.issues.filter((issue) => issue.severity === "error")
    // «La matriz no tiene registros» es de cabecera, pero no se corrige en la ficha: se agrega una tarea.
    const header = errors.filter((issue) => issue.scope === "header" && issue.field !== "entries")
    if (header.length > 0) return step("warning", `Completa la ficha del documento (${countOf(header.length, "dato")})`, header[0]!.message, { kind: "ficha" })
    // Sin riesgos no hay tarjeta: el estado vacío de la matriz ya trae «Nueva tarea» justo debajo.
    if (rows.length === 0) return null
    const pending = new Set(errors.flatMap((issue) => (issue.entryId ? [issue.entryId] : [])))
    if (pending.size > 0) {
      const first = firstPendingBySeverity(rows, pending)
      return step("warning", `Faltan datos en ${countOf(pending.size, "riesgo")}`, "Empieza por los más graves; «Siguiente pendiente» te lleva al próximo.", first ? { kind: "riesgo", entryId: first, purpose: "pending" } : null, { kind: "filtro", completitud: "pendientes" })
    }
    if (input.status === "draft" || input.reviewState === "observed") return step("success", "Lista para enviar a revisión", "Usa «Enviar a revisión» en la cabecera.")
  }
  if (input.status === "published" && input.hasPendingChanges) return step("info", `Hay cambios sin revisar desde ${input.versionLabel}`, "Envíalos a revisión cuando estén listos.")
  return null
}

/**
 * Dónde se ve la tarjeta (spec §4): lo decide `step.scope`. Ya en Revisión no
 * se ofrece «Ir a Revisión». En Resumen no se ofrece «Ver los pendientes»: la
 * cifra «Riesgos completos» ya lleva a ese subconjunto limpiando los filtros, y
 * el filtro del paso los conserva (`hrefToMatrixWith`), así que llegaría a otra
 * lista (A1/A5: una cifra, una representación).
 */
export function nextStepInView(step: NextStep | null, view: { atRoot: boolean; tab: string }): NextStep | null {
  if (!step || (!view.atRoot && step.scope !== "everywhere")) return null
  if (view.tab !== "revision" && view.tab !== "resumen") return step
  const drop = (action: NextStepAction | null) =>
    ((view.tab === "revision" && action?.kind === "tab" && action.tab === "revision") || (view.tab === "resumen" && action?.kind === "filtro") ? null : action)
  return { ...step, action: drop(step.action), secondary: drop(step.secondary) }
}
