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
  /**
   * Ejecución del Programa de Trabajo RE-04.1 (§6.3): registrar «Se hizo» /
   * «No se hizo» sobre una ocurrencia y adjuntar su evidencia. Espeja
   * `requireExecute` de `lib/services/miper/program-execution.ts`: el permiso
   * `prevention:risk:program:execute`, o el responsable nominal de la actividad
   * con `prevention:risk:view` (esa mitad la resuelve `canExecuteProgramAction`,
   * que necesita las actividades ya cargadas).
   */
  canExecuteProgram: boolean
  readOnlyReason: string | null
}

export function resolveWorkspaceMode(input: {
  status: string; reviewState: string; isLegacy: boolean
  openRoundStage: "technical" | "legal_rrhh" | null; submittedByUserId: string | null
  userId: string; permissions: readonly string[]; inScope: boolean
  /**
   * ¿La persona figura como responsable de alguna actividad del programa? Es la
   * mitad **nominal** de la regla de ejecución (§6.3). Va opcional porque sólo
   * quien ya leyó las actividades puede responderla: el armazón del espacio de
   * trabajo —y la página que lo arma— no las consulta, así que el panel del
   * Programa la completa por actividad con `canExecuteProgramAction`.
   */
  isProgramResponsible?: boolean
}): WorkspaceMode {
  const has = (permission: string) => input.permissions.includes(permission)
  const readOnlyReason = input.isLegacy ? "Esta MIPER usa la metodología anterior: es de solo lectura. Crea la MIPER del período para trabajar con el formato RE-04."
    : input.status === "superseded" ? "Esta MIPER fue reemplazada por la de otro período: se conserva como historia."
    : null
  const isSubmitter = input.submittedByUserId === input.userId
  const canEdit = !readOnlyReason && input.inScope && has("prevention:risk:edit")
  const canReviewTechnical = !readOnlyReason && input.reviewState === "in_review" && input.openRoundStage === "technical" && has("prevention:risk:review") && !isSubmitter
  const canApproveLegal = !readOnlyReason && input.reviewState === "pending_approval" && input.openRoundStage === "legal_rrhh" && has("prevention:risk:approve_legal") && !isSubmitter
  /* Un MIPER reemplazado o legacy no ejecuta: el programa de un período cerrado
   * es historia —su avance se conserva—, no una lista de tareas viva. */
  const canExecuteProgram = !readOnlyReason && input.inScope
    && (has("prevention:risk:program:execute") || (input.isProgramResponsible === true && has("prevention:risk:view")))
  return {
    canEdit,
    canReviewTechnical,
    canApproveLegal,
    canObserve: canReviewTechnical || canApproveLegal,
    canRespond: canEdit && input.reviewState === "observed",
    isSubmitter,
    canExecuteProgram,
    readOnlyReason,
  }
}

/**
 * ¿Puede esta persona registrar la ejecución **de esta** actividad? (§6.3)
 *
 * Son las dos ramas de `requireExecute`: el permiso de ejecución del programa, o
 * ser el responsable nominal de la actividad. El `risk:view` que la segunda rama
 * exige viene dado: sin él el espacio de trabajo no se abre, y el panel sólo
 * existe dentro de él. La autorización real la vuelve a hacer el servidor.
 */
export function canExecuteProgramAction(
  mode: WorkspaceMode,
  input: { userId: string; responsibleUserId: string | null },
): boolean {
  if (mode.readOnlyReason !== null) return false
  if (mode.canExecuteProgram) return true
  return input.responsibleUserId !== null && input.responsibleUserId === input.userId
}
