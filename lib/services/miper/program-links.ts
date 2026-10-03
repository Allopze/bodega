/**
 * Un solo criterio de «medida vinculada a una actividad activa del programa».
 *
 * Lo usan la validación del envío (`programLinkedControlIds`), la portada
 * (`programLinkedControlIdsByMatrix`) y el espacio de trabajo (`queries.ts`):
 * si cada uno repitiera el filtro, la UI podría anunciar un pendiente que el
 * servidor ya no aplica, o al revés. El vínculo de una actividad retirada ya no
 * programa nada, así que no cuenta.
 */
import { asc, eq, and, inArray } from "drizzle-orm"
import {
  preventionRiskProgramActionControls, preventionRiskProgramActions, preventionRiskPrograms,
} from "@/db/schema"
import type { Client } from "./shared"

export type ActiveProgramControlLink = {
  matrixId: string
  controlId: string
  actionId: string
  actionNumber: number
  description: string
}

/** Vínculos medida→actividad de las MIPER dadas: sólo actividades `active`, por N° de actividad. */
export async function activeProgramControlLinks(client: Client, matrixIds: readonly string[]): Promise<ActiveProgramControlLink[]> {
  if (matrixIds.length === 0) return []
  return client.select({
    matrixId: preventionRiskPrograms.matrixId,
    controlId: preventionRiskProgramActionControls.controlId,
    actionId: preventionRiskProgramActions.id,
    actionNumber: preventionRiskProgramActions.actionNumber,
    description: preventionRiskProgramActions.description,
  }).from(preventionRiskProgramActionControls)
    .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramActionControls.actionId))
    .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
    .where(and(inArray(preventionRiskPrograms.matrixId, [...matrixIds]), eq(preventionRiskProgramActions.status, "active")))
    .orderBy(asc(preventionRiskProgramActions.actionNumber))
}
