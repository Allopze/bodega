/**
 * Qué espera una MIPER de una persona: la regla de «Requieren mi acción» en la
 * portada por faena (Fase B, `listMiperPortfolio`). La cola «Mi trabajo» aplica
 * la misma regla en SQL (`operational-work-queue.ts`).
 *
 * Quien envió la ronda no la ve como pendiente de su revisión ni de su firma:
 * es lo que ya aplican `workspace-mode.ts` (`isSubmitter`) y el servicio
 * (`assertNotSubmitter`). La bandeja de antes, retirada en la Fase
 * C, no lo hacía.
 */
export type MiperInboxCandidate = { status: string; reviewState: string; isLegacy: boolean; hasUnsentChanges: boolean; submittedByUserId: string | null }
export type MiperInboxViewer = { userId: string; permissions: readonly string[] }

/** `review`: decidir sobre la ronda enviada; `respond`: atender observaciones; `continue`: seguir elaborando. */
export type MiperInboxKind = "review" | "respond" | "continue"

export function miperInboxAction(row: MiperInboxCandidate, viewer: MiperInboxViewer): { reason: string; kind: MiperInboxKind } | null {
  if (row.status === "superseded") return null
  const can = (permission: string) => viewer.permissions.includes(permission)
  const isSubmitter = row.submittedByUserId !== null && row.submittedByUserId === viewer.userId
  if (row.reviewState === "in_review" && can("prevention:risk:review") && !isSubmitter) return { reason: "Pendiente de tu revisión", kind: "review" }
  if (row.reviewState === "pending_approval" && can("prevention:risk:approve_legal") && !isSubmitter) return { reason: "Pendiente de tu firma", kind: "review" }
  if (can("prevention:risk:edit") && !row.isLegacy) {
    if (row.reviewState === "observed") return { reason: "Con observaciones", kind: "respond" }
    if (row.hasUnsentChanges) return { reason: "Cambios sin enviar", kind: "continue" }
    if (row.status === "draft" && row.reviewState === "none") return { reason: "Borrador", kind: "continue" }
  }
  return null
}

export const miperInboxReason = (row: MiperInboxCandidate, viewer: MiperInboxViewer): string | null => miperInboxAction(row, viewer)?.reason ?? null
