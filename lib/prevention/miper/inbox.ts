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

export function miperInboxReason(row: MiperInboxCandidate, viewer: MiperInboxViewer): string | null {
  if (row.status === "superseded") return null
  const can = (permission: string) => viewer.permissions.includes(permission)
  const isSubmitter = row.submittedByUserId !== null && row.submittedByUserId === viewer.userId
  if (row.reviewState === "in_review" && can("prevention:risk:review") && !isSubmitter) return "Pendiente de tu revisión"
  if (row.reviewState === "pending_approval" && can("prevention:risk:approve_legal") && !isSubmitter) return "Pendiente de tu firma"
  if (can("prevention:risk:edit") && !row.isLegacy) {
    if (row.reviewState === "observed") return "Con observaciones"
    if (row.hasUnsentChanges) return "Cambios sin enviar"
    if (row.status === "draft" && row.reviewState === "none") return "Borrador"
  }
  return null
}
