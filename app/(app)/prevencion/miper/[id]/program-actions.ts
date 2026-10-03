"use server"

import { getProgramActionDetail } from "@/lib/services/miper/program-queries"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { OUT_OF_SCOPE } from "@/lib/services/miper/shared"
import { guarded, stringFieldOf } from "../action-guard"

/**
 * Detalle de una actividad del programa (ocurrencias con sus registros y
 * evidencia) en una sola llamada. Es una lectura: no revalida nada. El servicio
 * vuelve a autorizar por alcance; «no existe» y «fuera de alcance» responden lo mismo.
 */
export async function loadProgramActionDetailAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => {
    const actionId = stringFieldOf(input, "actionId")
    if (!actionId) throw new RiskLegalDomainError(OUT_OF_SCOPE)
    return getProgramActionDetail(actionId, access)
  }, { revalidate: false, data: (detail) => ({ ...detail }) })
}
