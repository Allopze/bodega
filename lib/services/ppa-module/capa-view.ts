/**
 * Traductor CAPA → vocabulario de la acción correctiva del PPA (D11).
 *
 * `ppa_corrective_actions` era un espejo: `reviewPpa` creaba primero la CAPA y
 * después copiaba, y cada transición del PPA actualizaba las dos filas. Su
 * índice único por `ppaId` decía lo esencial — **un PPA tiene a lo más una
 * acción correctiva**, así que la CAPA de origen `ppa` con ese `sourceId` es
 * exactamente esa fila.
 *
 * `ppa_status_history` **no** es un espejo y se queda: registra las
 * transiciones del propio PPA (`detenido` → `en_correccion` → …), no las de la
 * acción. Su `capa_action_id` sólo apunta a la acción vigente en ese momento.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { preventionCapaActions } from "@/db/schema"
import type { Tx } from "@/db"

type CapaRow = typeof preventionCapaActions.$inferSelect

/**
 * El PPA tiene cinco estados y CAPA siete. `reopened` cae en `en_proceso` (el
 * PPA lo expresa devolviendo el caso a corrección) y `cancelled` en `cerrada`,
 * que es lo que escribía `authorizePpaRestart` al cancelar.
 */
export const CAPA_A_PPA_ESTADO: Record<string, string> = {
  pending: "pendiente",
  in_progress: "en_proceso",
  pending_verification: "completada",
  verified: "verificada",
  closed: "cerrada",
  reopened: "en_proceso",
  cancelled: "cerrada",
}

export const CAPA_A_PPA_PRIORIDAD: Record<string, string> = {
  critical: "alta",
  high: "alta",
  medium: "media",
  low: "baja",
}

export function ppaEstado(status: string): string {
  return CAPA_A_PPA_ESTADO[status] ?? status
}

export function ppaPrioridad(priority: string): string {
  return CAPA_A_PPA_PRIORIDAD[priority] ?? "media"
}

/** La acción correctiva en la forma que consumen la ficha del PPA y su export. */
export function capaToPpaCorrectiveAction(capa: CapaRow) {
  return {
    id:              capa.id,
    ppaId:           capa.sourceId,
    capaActionId:    capa.id,
    worksiteId:      capa.worksiteId,
    description:     capa.actionDescription,
    responsibleRole: capa.responsibleRole ?? "",
    responsible:     capa.responsibleSnapshot ?? "",
    dueDate:         capa.targetDate,
    priority:        ppaPrioridad(capa.priority),
    status:          ppaEstado(capa.status),
    createdBy:       capa.createdByUserId,
    createdAt:       capa.createdAt,
    updatedAt:       capa.updatedAt,
  }
}

export type PpaCorrectiveActionView = ReturnType<typeof capaToPpaCorrectiveAction>

const esDePpa = eq(preventionCapaActions.sourceType, "ppa")

/** La acción correctiva de un PPA, o `null` si el caso se rechazó sin acción. */
export async function findPpaCapa(client: Tx | typeof db, ppaId: string): Promise<CapaRow | null> {
  const [row] = await client.select().from(preventionCapaActions)
    .where(and(esDePpa, eq(preventionCapaActions.sourceId, ppaId))).limit(1)
  return row ?? null
}

export async function getPpaCorrectiveActionView(ppaId: string): Promise<PpaCorrectiveActionView | null> {
  const capa = await findPpaCapa(db, ppaId)
  return capa ? capaToPpaCorrectiveAction(capa) : null
}

/** Acciones de varios PPA en una sola consulta, para el export. */
export async function listPpaCapasByPpaIds(ppaIds: string[]): Promise<CapaRow[]> {
  if (ppaIds.length === 0) return []
  return db.select().from(preventionCapaActions)
    .where(and(esDePpa, inArray(preventionCapaActions.sourceId, ppaIds)))
}
