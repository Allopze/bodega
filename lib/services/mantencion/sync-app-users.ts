import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { Tx } from "@/db"
import { users, worksiteUsers } from "@/db/schema"
import { isTemporaryAccountExpired } from "@/lib/auth/temporary-account"

/**
 * Personas que pueden figurar como «otro mecánico» (§9, regla 10): usuarios
 * activos con `mant:app:use`, ya sea por rol o por permiso directo. Lo usan el
 * catálogo (la lista que ve el mecánico) y la validación del registro (quien
 * llega nombrado como ejecutor tiene que ser alguien de esta lista).
 */

type Reader = Pick<Tx, "select">

export const APP_PERMISSION = "mant:app:use"

export interface AppUser {
  id: string
  name: string
}

function hasAppPermissionSql(): SQL {
  return sql`(
    exists (
      select 1 from user_roles ur
      join role_permissions rp on rp.role_id = ur.role_id
      join permissions p on p.id = rp.permission_id
      where ur.user_id = ${users.id} and p.name = ${APP_PERMISSION}
    )
    or exists (
      select 1 from user_permissions up
      join permissions p on p.id = up.permission_id
      where up.user_id = ${users.id} and p.name = ${APP_PERMISSION}
    )
  )`
}

/**
 * Usuarios activos con la app. `ids` acota a esas personas; `worksiteIds`
 * acota a quienes tienen alguna de esas faenas asignadas (`worksite_users`).
 */
export async function findAppUsers(
  client: Reader,
  filter: { ids?: string[]; worksiteIds?: string[] } = {},
): Promise<AppUser[]> {
  if (filter.ids && filter.ids.length === 0) return []
  if (filter.worksiteIds && filter.worksiteIds.length === 0) return []
  const rows = await client
    .select({ id: users.id, name: users.name, isTemporary: users.isTemporary, validUntil: users.validUntil })
    .from(users)
    .where(and(
      eq(users.isActive, true),
      hasAppPermissionSql(),
      filter.ids ? inArray(users.id, filter.ids) : undefined,
      filter.worksiteIds
        ? inArray(users.id, client.select({ id: worksiteUsers.userId }).from(worksiteUsers).where(inArray(worksiteUsers.worksiteId, filter.worksiteIds)))
        : undefined,
    ))
    .orderBy(asc(users.name))
  return rows
    .filter((row) => !isTemporaryAccountExpired(row))
    .map((row) => ({ id: row.id, name: row.name }))
}
