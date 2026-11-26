import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { permissions, rolePermissions, roles, userPermissions, userRoles, users, worksiteUsers } from "@/db/schema"
import { isTemporaryAccountExpired } from "@/lib/auth/temporary-account"
import { ADMIN_ROLE, type QueueHolder } from "@/lib/mantencion/queue-owners"

/**
 * Los titulares activos de unos permisos, con lo que la cola necesita para repartir
 * una faena entre ellos (`lib/mantencion/queue-owners.ts`): si lo tienen por algo
 * distinto del rol `administrador`, si son globales y qué faenas tienen asignadas.
 *
 * Una sola lectura previa por carga de la cola (que el layout guarda 30 s por usuario),
 * de unas decenas de filas. Una cuenta temporal vencida no es responsable de nada:
 * contarla dejaría huérfana la fila que debía subir al siguiente nivel (como
 * `findAssignableMechanics`).
 */
export async function loadQueueHolders(permissionNames: readonly string[]): Promise<Map<string, QueueHolder[]>> {
  const names = [...new Set(permissionNames)]
  const byPermission = new Map<string, QueueHolder[]>(names.map((name) => [name, []]))
  if (names.length === 0) return byPermission

  const [viaRole, direct] = await Promise.all([
    db.select({
      userId: userRoles.userId,
      permission: permissions.name,
      roleName: roles.name,
      isTemporary: users.isTemporary,
      validUntil: users.validUntil,
    })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(inArray(permissions.name, names), eq(users.isActive, true))),
    db.select({
      userId: userPermissions.userId,
      permission: permissions.name,
      isTemporary: users.isTemporary,
      validUntil: users.validUntil,
    })
      .from(userPermissions)
      .innerJoin(permissions, eq(permissions.id, userPermissions.permissionId))
      .innerJoin(users, eq(users.id, userPermissions.userId))
      .where(and(inArray(permissions.name, names), eq(users.isActive, true))),
  ])

  type Grant = { userId: string; permission: string; responsible: boolean }
  const grants: Grant[] = []
  for (const row of viaRole) {
    if (isTemporaryAccountExpired(row)) continue
    grants.push({ userId: row.userId, permission: row.permission, responsible: row.roleName !== ADMIN_ROLE })
  }
  for (const row of direct) {
    if (isTemporaryAccountExpired(row)) continue
    grants.push({ userId: row.userId, permission: row.permission, responsible: true })
  }
  const candidateIds = [...new Set(grants.map((grant) => grant.userId))]
  if (candidateIds.length === 0) return byPermission

  const [globalRows, siteRows] = await Promise.all([
    db.select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(inArray(userRoles.userId, candidateIds), eq(roles.isGlobal, true))),
    db.select({ userId: worksiteUsers.userId, worksiteId: worksiteUsers.worksiteId })
      .from(worksiteUsers)
      .where(inArray(worksiteUsers.userId, candidateIds)),
  ])
  const globalUsers = new Set(globalRows.map((row) => row.userId))
  const sitesByUser = new Map<string, string[]>()
  for (const row of siteRows) sitesByUser.set(row.userId, [...(sitesByUser.get(row.userId) ?? []), row.worksiteId])

  // Una persona puede tener el permiso por dos caminos (el rol del administrador y un permiso directo):
  // basta uno que no sea el de `administrador` para que sea responsable.
  const merged = new Map<string, QueueHolder>()
  for (const grant of grants) {
    const key = `${grant.permission}\u0000${grant.userId}`
    const previous = merged.get(key)
    if (previous) {
      previous.responsible = previous.responsible || grant.responsible
      continue
    }
    merged.set(key, {
      userId: grant.userId,
      responsible: grant.responsible,
      isGlobal: globalUsers.has(grant.userId),
      worksiteIds: sitesByUser.get(grant.userId) ?? [],
    })
    byPermission.get(grant.permission)?.push(merged.get(key)!)
  }
  return byPermission
}
