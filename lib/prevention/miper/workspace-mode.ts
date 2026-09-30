/**
 * Qué puede hacer la persona en el espacio de trabajo. Es un reflejo de las
 * reglas del servicio (lib/services/miper/*) para mostrar u ocultar controles;
 * la autorización real la vuelve a hacer el servidor en cada acción.
 */
export type WorkspaceMode = {
  canEdit: boolean
  canReviewTechnical: boolean
  canApproveLegal: boolean
  canObserve: boolean
  canRespond: boolean
  isSubmitter: boolean
  readOnlyReason: string | null
}

export function resolveWorkspaceMode(input: {
  status: string; reviewState: string; isLegacy: boolean
  openRoundStage: "technical" | "legal_rrhh" | null; submittedByUserId: string | null
  userId: string; permissions: readonly string[]; inScope: boolean
}): WorkspaceMode {
  const has = (permission: string) => input.permissions.includes(permission)
  const readOnlyReason = input.isLegacy ? "Esta MIPER usa la metodología anterior: es de solo lectura. Crea la MIPER del período para trabajar con el formato RE-04."
    : input.status === "superseded" ? "Esta MIPER fue reemplazada por la de otro período: se conserva como historia."
    : null
  const isSubmitter = input.submittedByUserId === input.userId
  const canEdit = !readOnlyReason && input.inScope && has("prevention:risk:edit")
  const canReviewTechnical = !readOnlyReason && input.reviewState === "in_review" && input.openRoundStage === "technical" && has("prevention:risk:review") && !isSubmitter
  const canApproveLegal = !readOnlyReason && input.reviewState === "pending_approval" && input.openRoundStage === "legal_rrhh" && has("prevention:risk:approve_legal") && !isSubmitter
  return {
    canEdit,
    canReviewTechnical,
    canApproveLegal,
    canObserve: canReviewTechnical || canApproveLegal,
    canRespond: canEdit && input.reviewState === "observed",
    isSubmitter,
    readOnlyReason,
  }
}
