/**
 * Leer la bitácora de un módulo desde el `audit_log` compartido.
 *
 * Las once tablas `prevention_*_history` se consolidaron acá el 2026-09-20.
 * Las aserciones que las miraban no se borraron: apuntan a este helper, porque
 * un test que deja de verificar la traza es exactamente cómo se pierde la traza
 * sin que nadie se entere.
 *
 * `changeType` vive dentro de `new_state` —el vocabulario de cada módulo no
 * amplía el enum compartido de `action`—, así que se filtra en memoria: son
 * decenas de filas por test, no una consulta de producción.
 */

import { and, asc, eq } from "drizzle-orm"
import { auditLog } from "@/db/schema"

export type ModuleHistoryEntry = {
  id: string
  entityType: string
  entityId: string
  worksiteId: string | null
  changeType: string | null
  reason: string | null
  beforeState: Record<string, unknown> | null
  afterState: Record<string, unknown> | null
  actorUserId: string | null
  createdAt: string
}

function parse(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Cualquier cliente Drizzle: los tests usan PGlite, Postgres real y
 * transacciones, y sus tipos no comparten un supertipo útil. Acá sólo se
 * necesita `select`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any

/** Las entradas de una entidad, en orden cronológico. */
export async function readModuleHistory(
  client: AnyDb,
  options: { module: string; entityType: string; entityId: string; changeType?: string },
): Promise<ModuleHistoryEntry[]> {
  const rows = await client.select().from(auditLog).where(and(
    eq(auditLog.entityType, `${options.module}:${options.entityType}`),
    eq(auditLog.entityId, options.entityId),
  )).orderBy(asc(auditLog.createdAt))

  return (rows as Record<string, unknown>[]).map((row) => {
    const after = parse(row.newState as string | null)
    const { changeType, ...rest } = after ?? {}
    return {
      id: row.id as string,
      entityType: row.entityType as string,
      entityId: row.entityId as string,
      worksiteId: (row.worksiteId ?? null) as string | null,
      changeType: (changeType ?? null) as string | null,
      reason: (row.reason ?? null) as string | null,
      beforeState: parse(row.oldState as string | null),
      afterState: Object.keys(rest).length > 0 ? rest : null,
      actorUserId: (row.userId ?? null) as string | null,
      createdAt: row.createdAt as string,
    }
  }).filter((entry) => !options.changeType || entry.changeType === options.changeType)
}
