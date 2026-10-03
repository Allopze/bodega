"use server"

import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { getMiperHistory } from "@/lib/services/miper/queries"
import type { ActionState } from "@/lib/validation/prevention"
import { guarded, matrixIdOf, stringFieldOf } from "../action-guard"

/**
 * La página siguiente de la bitácora (el botón «Cargar más»). Es lectura: no
 * revalida nada, y el alcance lo vuelve a comprobar `getMiperHistory`.
 */
export async function loadMiperHistoryPageAction(input: { matrixId: string; cursor: string }): Promise<ActionState> {
  return guarded("prevention:risk:view", input, (access) => {
    const matrixId = matrixIdOf(input)
    const cursor = stringFieldOf(input, "cursor")
    if (!matrixId || !cursor) throw new RiskLegalDomainError("No se pudo leer la página siguiente del historial; recarga la MIPER.")
    return getMiperHistory(matrixId, access, { cursor })
  }, { revalidate: false, data: (page) => ({ ...page }) })
}
