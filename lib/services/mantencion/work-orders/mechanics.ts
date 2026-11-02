import { and, asc, eq, inArray, sql } from "drizzle-orm"
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

export interface WorksiteMechanic extends AssignableMechanic {
  worksiteId: string
}

/**
 * Mecánicos (rol `mecanico`, activos) de esas faenas. Es a quien queda asignada
 * la OT que crea el administrador de contrato: el mecánico de la faena del
 * equipo, que es la suya. La jefatura y la supervisión también ejecutan OT, pero
 * no son «el mecánico de la faena».
 */
export async function findWorksiteMechanics(client: Reader, worksiteIds: readonly string[] | "all"): Promise<WorksiteMechanic[]> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) return []
  const rows = await client
    .select({ id: users.id, name: users.name, isTemporary: users.isTemporary, validUntil: users.validUntil, worksiteId: worksiteUsers.worksiteId })
    .from(users)
    .innerJoin(worksiteUsers, eq(worksiteUsers.userId, users.id))
    .where(and(
      eq(users.isActive, true),
      worksiteIds === "all" ? undefined : inArray(worksiteUsers.worksiteId, [...worksiteIds]),
      sql`exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = ${users.id} and r.name = 'mecanico')`,
      userHasPermissionSql(OT_PERMISSIONS.execute),
    ))
    .orderBy(asc(users.name))
  return rows
    .filter((row) => !isTemporaryAccountExpired(row))
    .map((row) => ({ id: row.id, name: row.name, worksiteId: row.worksiteId }))
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
