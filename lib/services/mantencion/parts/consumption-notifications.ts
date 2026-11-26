import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { permissions, products, rolePermissions, roles, userPermissions, userRoles } from "@/db/schema"
import { notifyAfterCommit, notifyManyUser } from "@/lib/services/notification-create"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"

/**
 * Aviso «Faltó stock» (ADR mantención 0001, D6): un registro firmado quedó con una o más líneas
 * `pendiente_conciliar` porque la bodega de la faena no tenía el repuesto. El registro NO se
 * rechaza; quienes concilian (`mant:np:manage` en la faena de la línea) se enteran para resolverlo
 * desde Notas de pedido. Se envía DESPUÉS del commit (`notifyAfterCommit`): las notificaciones
 * escriben por el `db` global, así que enviarlas adentro las dejaría vivas aunque el registro se
 * revirtiera.
 */

export const CONCILIATE_PERMISSION = "mant:np:manage"

export interface PendingStockNotice {
  recordId: string
  recordFolio: string
  workOrderFolio: string
  /** Quien firmó: nunca se avisa a sí mismo. */
  actorUserId: string
  lines: ReadonlyArray<{ recordPartId: string; productId: string; worksiteId: string }>
}

const ADMIN_ROLE = "administrador"

/** De `userIds`, quienes tienen el permiso por un rol que no es `administrador` o por un permiso directo. */
async function holdersBeyondAdmin(userIds: readonly string[], permission: string): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const [viaRole, direct] = await Promise.all([
    db.select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(inArray(userRoles.userId, [...userIds]), eq(permissions.name, permission), ne(roles.name, ADMIN_ROLE))),
    db.select({ userId: userPermissions.userId })
      .from(userPermissions)
      .innerJoin(permissions, eq(permissions.id, userPermissions.permissionId))
      .where(and(inArray(userPermissions.userId, [...userIds]), eq(permissions.name, permission))),
  ])
  return new Set([...viaRole, ...direct].map((row) => row.userId))
}

/**
 * Quienes tienen el permiso en la faena, sin el actor. El rol `administrador` recibe todos los
 * permisos de la plataforma: por permiso le llegaría cada aviso de cada faena. Si alguien lo tiene
 * por otro rol (jefatura, administración de contrato) o por un permiso directo, sólo ellos; si no,
 * todos, para que el aviso no se pierda en una faena sin responsable. Mismo criterio que los
 * avisos de la OT (`work-orders/notifications.ts`, donde la función no se exporta).
 */
async function holdersFor(permission: string, worksiteId: string, actorUserId: string): Promise<string[]> {
  const candidates = (await getUserIdsWithPermissionForWorksite(permission, worksiteId)).filter((id) => id !== actorUserId)
  const responsible = await holdersBeyondAdmin(candidates, permission)
  return responsible.size > 0 ? candidates.filter((id) => responsible.has(id)) : candidates
}

/** Un aviso por faena, con todos los repuestos que faltaron en ella. */
export async function sendPendingStockNotice(notice: PendingStockNotice): Promise<void> {
  if (notice.lines.length === 0) return
  const productIds = [...new Set(notice.lines.map((line) => line.productId))]
  const names = new Map((await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds))).map((row) => [row.id, row.name]))
  const byWorksite = new Map<string, string[]>()
  for (const line of notice.lines) {
    byWorksite.set(line.worksiteId, [...(byWorksite.get(line.worksiteId) ?? []), line.productId])
  }
  for (const [worksiteId, ids] of byWorksite) {
    const userIds = await holdersFor(CONCILIATE_PERMISSION, worksiteId, notice.actorUserId)
    if (userIds.length === 0) continue
    const label = [...new Set(ids.map((id) => names.get(id) ?? "Repuesto"))].join(", ")
    await notifyManyUser(userIds, {
      type: "mant_np_stock_pending",
      title: `Faltó stock en la OT ${notice.workOrderFolio}`,
      body: `Faltó stock: ${label} · OT ${notice.workOrderFolio} · registro ${notice.recordFolio}. Concilia desde Notas de pedido.`,
      entityType: "mant_record",
      entityId: notice.recordId,
      entityHref: "/mantencion/notas-pedido",
      dedupeKey: `mant-np-stock:${notice.recordId}:${worksiteId}`,
    })
  }
}

/** Dispara el aviso; llamar SÓLO cuando `db.transaction` ya resolvió. */
export function notifyPendingStockAfterCommit(notice: PendingStockNotice): void {
  if (notice.lines.length === 0) return
  notifyAfterCommit(() => sendPendingStockNotice(notice))
}
