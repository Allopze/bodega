import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { permissions, rolePermissions, roles, userPermissions, userRoles } from "@/db/schema"
import type { NotificationType } from "@/db/schema/audit"
import { notifyManyUser } from "@/lib/services/notification-create"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"
import { countOf } from "@/lib/utils"
import { NP_PERMISSIONS } from "./access"

/**
 * Avisos de la nota de pedido (NP). Se envían DESPUÉS del commit
 * (`notifyAfterCommit` en quien llama): las notificaciones escriben por el `db`
 * global y, dentro de la transacción, sobrevivirían a un rollback.
 *
 * Los tipos son nuevos; `NotificationType` (db/schema/audit.ts) aún no los lista y
 * ese archivo es del núcleo. La columna es texto libre, así que el cast sólo
 * ahorra un cambio de tipos: cuando se agreguen a la unión, quitar el cast.
 */
const NP_CREATED = "mant_np_created" as NotificationType
const NP_REJECTED = "mant_np_rejected" as NotificationType

const ADMIN_ROLE = "administrador"

/** De `userIds`, los que tienen `permission` por un rol que no es `administrador` o por un permiso directo. */
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
 * Quienes resuelven NP en la faena, sin el actor. El rol `administrador` recibe todos los permisos
 * de la plataforma: por permiso le llegaría cada NP de cada faena. Si alguien más las resuelve (jefatura,
 * administración de contrato), sólo ellos; si no queda nadie, todos, para que el aviso no se pierda.
 * Mismo criterio que los avisos de la OT (`work-orders/notifications.ts`).
 */
async function managersOf(worksiteId: string, actorUserId: string): Promise<string[]> {
  const candidates = (await getUserIdsWithPermissionForWorksite(NP_PERMISSIONS.manage, worksiteId)).filter((id) => id !== actorUserId)
  const responsible = await holdersBeyondAdmin(candidates, NP_PERMISSIONS.manage)
  return responsible.size > 0 ? candidates.filter((id) => responsible.has(id)) : candidates
}

export interface PartsNoteCreatedNotice {
  noteId: string
  code: string
  workOrderFolio: string
  worksiteId: string
  lineCount: number
  equipmentStopped: boolean
  /** Equipo («KA-135 · Camión») para el título. */
  equipment: string
  actorUserId: string
}

/** Aviso a quienes resuelven NP en la faena: «NP-… · OT … · 2 repuestos · equipo detenido». */
export async function notifyPartsNoteCreated(notice: PartsNoteCreatedNotice): Promise<void> {
  const userIds = await managersOf(notice.worksiteId, notice.actorUserId)
  if (userIds.length === 0) return
  const body = [notice.code, `OT ${notice.workOrderFolio}`, countOf(notice.lineCount, "repuesto"), notice.equipmentStopped ? "equipo detenido" : null]
    .filter(Boolean)
    .join(" · ")
  await notifyManyUser(userIds, {
    type: NP_CREATED,
    title: `Nota de pedido de ${notice.equipment}`,
    body,
    entityType: "mant_parts_note",
    entityId: notice.noteId,
    entityHref: `/mantencion/notas-pedido/${notice.noteId}`,
    dedupeKey: `mant-np:${notice.noteId}:created`,
  })
}

export interface PartsNoteRejectedNotice {
  noteId: string
  noteItemId: string
  code: string
  workOrderId: string
  description: string
  reason: string
  /** Quien pidió: el mecánico autor de la NP. */
  authorUserId: string
  actorUserId: string
}

/** Aviso al autor de la NP de que jefatura rechazó una línea: «Rechazado: {motivo}». */
export async function notifyPartsNoteItemRejected(notice: PartsNoteRejectedNotice): Promise<void> {
  if (notice.authorUserId === notice.actorUserId) return
  await notifyManyUser([notice.authorUserId], {
    type: NP_REJECTED,
    title: `Se rechazó un repuesto de ${notice.code}`,
    body: `${notice.description} · Rechazado: ${notice.reason}`,
    entityType: "mant_parts_note",
    entityId: notice.noteId,
    entityHref: `/mantencion/ot/${notice.workOrderId}`,
    dedupeKey: `mant-np:${notice.noteItemId}:rejected`,
  })
}
