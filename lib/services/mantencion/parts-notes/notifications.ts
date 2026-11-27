import { and, eq, inArray, isNull, ne } from "drizzle-orm"
import { db } from "@/db"
import {
  mantPartsNoteItems, mantPartsNotes, permissions, purchaseRequestItems, rolePermissions, roles, userPermissions, userRoles, worksites,
} from "@/db/schema"
import type { NotificationType } from "@/db/schema/audit"
import { notifyManyUser } from "@/lib/services/notification-create"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"
import { countOf } from "@/lib/utils"
import { NP_PERMISSIONS } from "./access"

/**
 * Avisos de la nota de pedido (NP). Se envían DESPUÉS del commit
 * (`notifyAfterCommit` en quien llama): las notificaciones escriben por el `db`
 * global y, dentro de la transacción, sobrevivirían a un rollback.
 */
const NP_CREATED: NotificationType = "mant_np_created"
const NP_REJECTED: NotificationType = "mant_np_rejected"
const NP_ARRIVED: NotificationType = "mant_np_arrived"

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
  /** Null: nota sin OT. */
  workOrderFolio: string | null
  worksiteId: string
  lineCount: number
  equipmentStopped: boolean
  /** Urgencia que fijó quien la pidió («urgente» si no hay equipo detenido). */
  urgent: boolean
  /** Equipo («KA-135 · Camión») para el título; sin OT, la faena. */
  equipment: string
  actorUserId: string
}

/** Aviso a quienes resuelven NP en la faena: «NP-… · OT … · 2 repuestos · equipo detenido». Sin OT, dice «sin OT». */
export async function notifyPartsNoteCreated(notice: PartsNoteCreatedNotice): Promise<void> {
  const userIds = await managersOf(notice.worksiteId, notice.actorUserId)
  if (userIds.length === 0) return
  const urgency = notice.equipmentStopped ? "equipo detenido" : notice.urgent ? "urgente" : null
  const body = [notice.code, notice.workOrderFolio ? `OT ${notice.workOrderFolio}` : "sin OT", countOf(notice.lineCount, "repuesto"), urgency]
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
  /** Null: nota sin OT (el enlace va a la propia nota). */
  workOrderId: string | null
  description: string
  reason: string
  /** Quien pidió: el autor de la NP. Null en las importadas: no hay a quién avisar en CHOME. */
  authorUserId: string | null
  actorUserId: string
}

/** Aviso al autor de la NP de que jefatura rechazó una línea: «Rechazado: {motivo}». */
export async function notifyPartsNoteItemRejected(notice: PartsNoteRejectedNotice): Promise<void> {
  if (!notice.authorUserId || notice.authorUserId === notice.actorUserId) return
  await notifyManyUser([notice.authorUserId], {
    type: NP_REJECTED,
    title: `Se rechazó un repuesto de ${notice.code}`,
    body: `${notice.description} · Rechazado: ${notice.reason}`,
    entityType: "mant_parts_note",
    entityId: notice.noteId,
    entityHref: notice.workOrderId ? `/mantencion/ot/${notice.workOrderId}` : `/mantencion/notas-pedido/${notice.noteId}`,
    dedupeKey: `mant-np:${notice.noteItemId}:rejected`,
  })
}

export interface PartsNoteArrivedNotice {
  /** Recepción (o cotejo de guía) que dejó las compras completas en la faena: parte de la clave de deduplicación. */
  receiptId: string
  /** Quien recibió: nunca se avisa a sí mismo. */
  actorUserId: string
  /** Ítems de solicitud (las compras) que esa recepción dejó completos en faena. */
  requestItemIds: readonly string[]
}

/**
 * Aviso al autor de una nota de pedido SIN OT de que lo que pidió llegó a la faena (la nota con OT lo recibe por el aviso de la
 * OT: `notifyWorkOrderPartsReceived`). Una notificación por nota y recepción: la clave `mant-np-arrived:{nota}:{recepción}` hace
 * que reintentar no la repita. Las notas importadas no tienen autor en la plataforma y no avisan; las anuladas tampoco.
 * Llamar DESPUÉS del commit (`notifyAfterCommit`).
 */
export async function notifyPartsNoteLinesArrived(notice: PartsNoteArrivedNotice): Promise<void> {
  if (notice.requestItemIds.length === 0) return
  const rows = await db
    .select({
      noteId: mantPartsNotes.id,
      code: mantPartsNotes.code,
      status: mantPartsNotes.status,
      authorId: mantPartsNotes.requestedByUserId,
      worksiteName: worksites.name,
      description: mantPartsNoteItems.description,
    })
    .from(purchaseRequestItems)
    .innerJoin(mantPartsNoteItems, eq(mantPartsNoteItems.id, purchaseRequestItems.partsNoteItemId))
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .innerJoin(worksites, eq(worksites.id, mantPartsNotes.worksiteId))
    .where(and(inArray(purchaseRequestItems.id, [...notice.requestItemIds]), isNull(mantPartsNotes.workOrderId)))
    .orderBy(mantPartsNotes.code, mantPartsNoteItems.sortOrder)

  const byNote = new Map<string, { authorId: string; code: string; worksiteName: string; descriptions: string[] }>()
  for (const row of rows) {
    if (!row.authorId || row.authorId === notice.actorUserId || row.status === "anulada") continue
    const entry = byNote.get(row.noteId) ?? { authorId: row.authorId, code: row.code, worksiteName: row.worksiteName, descriptions: [] }
    entry.descriptions.push(row.description)
    byNote.set(row.noteId, entry)
  }
  for (const [noteId, entry] of byNote) {
    const what = entry.descriptions.length === 1 ? entry.descriptions[0]! : `${entry.descriptions[0]!} y ${entry.descriptions.length - 1} más`
    await notifyManyUser([entry.authorId], {
      type: NP_ARRIVED,
      title: `${entry.descriptions.length === 1 ? "Llegó" : "Llegaron"} a faena: ${what} · ${entry.code}`,
      body: `${entry.worksiteName} · ${entry.descriptions.join("; ")}. Ya está en la bodega de la faena.`,
      entityType: "mant_parts_note",
      entityId: noteId,
      entityHref: `/mantencion/notas-pedido/${noteId}`,
      dedupeKey: `mant-np-arrived:${noteId}:${notice.receiptId}`,
    })
  }
}
