import { and, asc, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { users, worksites, worksiteUsers } from "@/db/schema"
import { isTemporaryAccountExpired } from "@/lib/auth/temporary-account"
import { OT_PERMISSIONS } from "@/lib/mantencion/work-order-states"
import { userHasPermissionSql } from "../sync-app-users"

/**
 * Mecánicos asignables a una OT: usuarios activos con `mant:ot:execute`, de
 * CUALQUIER faena. A diferencia de `findAppUsers` (que acota por faena porque
 * «otro mecánico» de una correctiva es alguien con quien se comparte faena), la
 * OT la puede trabajar cualquier mecánico en cualquier faena: la faena distinta
 * sólo marca `outOfWorksite`, nunca bloquea.
 */

type Reader = Pick<Tx, "select">

export interface AssignableMechanic {
  id: string
  name: string
}

export async function findAssignableMechanics(client: Reader, filter: { ids?: string[] } = {}): Promise<AssignableMechanic[]> {
  if (filter.ids && filter.ids.length === 0) return []
  const rows = await client
    .select({ id: users.id, name: users.name, isTemporary: users.isTemporary, validUntil: users.validUntil })
    .from(users)
    .where(and(
      eq(users.isActive, true),
      userHasPermissionSql(OT_PERMISSIONS.execute),
      filter.ids ? inArray(users.id, filter.ids) : undefined,
    ))
    .orderBy(asc(users.name))
  return rows.filter((row) => !isTemporaryAccountExpired(row)).map((row) => ({ id: row.id, name: row.name }))
}

/** Un mecánico asignable por su id, o `null` si está inactivo o ya no tiene `mant:ot:execute`. */
export async function findAssignableMechanic(client: Reader, id: string): Promise<AssignableMechanic | null> {
  const [mechanic] = await findAssignableMechanics(client, { ids: [id] })
  return mechanic ?? null
}

/** Para el selector de asignación: cada mecánico con las faenas que tiene asignadas (información, no restricción). */
export async function listAssignableMechanicsWithWorksites(): Promise<Array<{ id: string; name: string; worksiteNames: string[] }>> {
  const mechanics = await findAssignableMechanics(db)
  if (mechanics.length === 0) return []
  const rows = await db
    .select({ userId: worksiteUsers.userId, name: worksites.name })
    .from(worksiteUsers)
    .innerJoin(worksites, eq(worksites.id, worksiteUsers.worksiteId))
    .where(and(inArray(worksiteUsers.userId, mechanics.map((mechanic) => mechanic.id)), eq(worksites.isActive, true)))
    .orderBy(asc(worksites.name))
  const byUser = new Map<string, string[]>()
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.name])
  return mechanics.map((mechanic) => ({ ...mechanic, worksiteNames: byUser.get(mechanic.id) ?? [] }))
}
