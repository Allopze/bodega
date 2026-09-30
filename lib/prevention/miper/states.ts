/**
 * Estados del MIPER (§6 del spec). `status` es el ciclo de vida
 * (`published` = vigente) y `review_state` la revisión. Los recordatorios de
 * firma pendiente (lib/services/pdtp/reminders.ts) y el servicio de flujo leen
 * estas mismas reglas: si cambia la máquina, cambian con ella.
 */
export const MIPER_STATUSES = ["draft", "published", "superseded"] as const
export type MiperStatus = typeof MIPER_STATUSES[number]
export const MIPER_REVIEW_STATES = ["none", "in_review", "observed", "pending_approval"] as const
export type MiperReviewState = typeof MIPER_REVIEW_STATES[number]
export type MiperWorkflowAction = "submit" | "return" | "approve_technical" | "request_corrections" | "approve_final"
export type ReviewStage = "technical" | "legal_rrhh"

export const MIPER_ACTION_RULES: Record<MiperWorkflowAction, { from: readonly MiperReviewState[]; to: MiperReviewState; permission: string; label: string }> = {
  submit: { from: ["none", "observed"], to: "in_review", permission: "prevention:risk:edit", label: "Enviar a revisión" },
  return: { from: ["in_review"], to: "observed", permission: "prevention:risk:review", label: "Devolver con observaciones" },
  approve_technical: { from: ["in_review"], to: "pending_approval", permission: "prevention:risk:review", label: "Aprobar revisión técnica" },
  request_corrections: { from: ["pending_approval"], to: "observed", permission: "prevention:risk:approve_legal", label: "Solicitar correcciones" },
  approve_final: { from: ["pending_approval"], to: "none", permission: "prevention:risk:approve_legal", label: "Aprobar (Legal y RRHH)" },
}

export const REVIEW_STAGE_FOR_STATE: Partial<Record<MiperReviewState, ReviewStage>> = { in_review: "technical", pending_approval: "legal_rrhh" }
export const STAGE_PERMISSION: Record<ReviewStage, string> = { technical: "prevention:risk:review", legal_rrhh: "prevention:risk:approve_legal" }
export const STAGE_LABEL: Record<ReviewStage, string> = { technical: "Revisión técnica (Prevención)", legal_rrhh: "Aprobación Legal y RRHH" }

export const REVIEW_STATE_LABEL: Record<MiperReviewState, string> = {
  none: "Sin revisión en curso",
  in_review: "En revisión técnica",
  observed: "Con observaciones",
  pending_approval: "Pendiente de aprobación Legal y RRHH",
}

export function miperStatusLabel(input: { status: string; reviewState: string; versionNumber: number | null; hasUnsentChanges: boolean; roundOpened: boolean; isLegacy?: boolean }): string {
  if (input.status === "superseded") return "Reemplazado"
  if (input.isLegacy) return input.status === "published" ? "Vigente · metodología anterior" : "Borrador · metodología anterior"
  const review = input.reviewState
  if (input.status === "draft") {
    if (review === "in_review") return input.roundOpened ? "En revisión por Prevención" : "Enviado a revisión"
    if (review === "observed") return "Con observaciones"
    if (review === "pending_approval") return "Revisión técnica aprobada · Pendiente de aprobación Legal y RRHH"
    return "Borrador"
  }
  const v = input.versionNumber ? `v${input.versionNumber}` : ""
  if (review === "in_review") return `Vigente ${v} · ${input.roundOpened ? "en revisión por Prevención" : "enviado a revisión"}`
  if (review === "observed") return `Vigente ${v} · con observaciones`
  if (review === "pending_approval") return `Vigente ${v} · pendiente de aprobación Legal y RRHH`
  return input.hasUnsentChanges ? `Vigente ${v} · cambios pendientes de revisión` : `Vigente · ${v}`
}

export function pendingSignaturePermission(reviewState: string): string | null {
  const stage = REVIEW_STAGE_FOR_STATE[reviewState as MiperReviewState]
  return stage ? STAGE_PERMISSION[stage] : null
}
