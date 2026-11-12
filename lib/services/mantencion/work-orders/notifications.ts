import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { mantWorkOrders, permissions, rolePermissions, roles, userPermissions, userRoles } from "@/db/schema"
import type { NotificationType } from "@/db/schema/audit"
import { OT_PERMISSIONS } from "@/lib/mantencion/work-order-states"
import { notifyAfterCommit, notifyManyUser } from "@/lib/services/notification-create"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"

/**
 * Avisos de la OT. Se arman como un PLAN dentro de la transacción y se envían
 * DESPUÉS del commit (`notifyAfterCommit`): las notificaciones escriben por el
 * `db` global, así que enviarlas adentro las dejaría vivas aunque la
 * transacción se revirtiera. Los destinatarios se resuelven recién al enviar,
 * por permiso + faena (ningún usuario va fijo en el código), y el actor nunca se
 * avisa a sí mismo.
 *
 * El rol `administrador` recibe todos los permisos de la plataforma, así que por
 * permiso le llegaría cada aviso de cada OT. Los avisos por permiso van a quien
 * lo tiene por otro rol (jefatura de mantención, administración de contrato) o
 * por un permiso directo; a los administradores sólo si no queda nadie más, para
 * que el aviso no se pierda en una faena sin responsable.
 */

export type OtNotifyEvent = "created" | "assigned" | "unassigned" | "voided" | "finished" | "received" | "rejected" | "reopened" | "closed"

export interface NotificationPlan {
  event: OtNotifyEvent
  workOrderId: string
  folio: string
  worksiteId: string
  /** Versión de la OT tras el cambio: parte de la clave de deduplicación. */
  version: number
  actorUserId: string
  requestedByUserId: string
  assigneeUserId: string | null
  /** «KA-135 · Camión». */
  equipment: string
  /** Complemento del cuerpo (motivo del rechazo, etc.). */
  detail?: string | null
}

const TYPE: Record<OtNotifyEvent, NotificationType> = {
  created: "mant_ot_created",
  assigned: "mant_ot_assigned",
  unassigned: "mant_ot_unassigned",
  voided: "mant_ot_voided",
  finished: "mant_ot_finished",
  received: "mant_ot_received",
  rejected: "mant_ot_rejected",
  reopened: "mant_ot_rejected",
  closed: "mant_ot_closed",
}

const TITLE: Record<OtNotifyEvent, (folio: string) => string> = {
  created: (folio) => `Nueva orden de trabajo ${folio}`,
  assigned: (folio) => `Se te asignó la orden de trabajo ${folio}`,
  unassigned: (folio) => `Se te quitó la orden de trabajo ${folio}`,
  voided: (folio) => `Se anuló la orden de trabajo ${folio}`,
  finished: (folio) => `La orden de trabajo ${folio} salió de taller`,
  received: (folio) => `La orden de trabajo ${folio} espera tu conformidad`,
  rejected: (folio) => `La orden de trabajo ${folio} volvió a taller`,
  reopened: (folio) => `Se reabrió la orden de trabajo ${folio}`,
  closed: (folio) => `La orden de trabajo ${folio} quedó cerrada`,
}

const BODY: Record<OtNotifyEvent, string> = {
  created: "Está por asignar.",
  assigned: "Entra a taller y registra el ingreso desde la app o el PC.",
  unassigned: "Volvió a «Por asignar»: ya no tienes que ejecutarla.",
  voided: "Quedó anulada: no la ejecutes.",
  finished: "Falta registrar la recepción del equipo.",
  received: "Revisa el equipo y registra la recepción en faena (conformidad).",
  rejected: "Fue devuelta a «En taller». Registra el trabajo nuevo desde la app o desde la OT en el PC.",
  reopened: "Fue reabierta y vuelve a «En taller». Registra el trabajo nuevo desde la app o desde la OT en el PC.",
  closed: "Tiene la conformidad de la faena.",
}

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
 * Quienes tienen `permission` en la faena, sin el actor. Si alguno lo tiene por
 * algo distinto del rol `administrador`, sólo ellos (ver el comentario del
 * archivo); si no, todos, para que el aviso no se pierda.
 */
async function holdersForPermission(permission: string, worksiteId: string, actorUserId: string): Promise<string[]> {
  const candidates = (await getUserIdsWithPermissionForWorksite(permission, worksiteId))
    .filter((id) => id !== actorUserId)
  const responsible = await holdersBeyondAdmin(candidates, permission)
  return responsible.size > 0 ? candidates.filter((id) => responsible.has(id)) : candidates
}

async function recipients(plan: NotificationPlan): Promise<string[]> {
  const forPermission = (permission: string) => holdersForPermission(permission, plan.worksiteId, plan.actorUserId)
  const ids: string[] = []
  switch (plan.event) {
    case "created":
      ids.push(...await forPermission(OT_PERMISSIONS.manage))
      break
    case "assigned":
    case "unassigned":
      // En `unassigned` el plan trae al mecánico que la tenía, no al que queda (nadie).
      if (plan.assigneeUserId) ids.push(plan.assigneeUserId)
      break
    case "voided":
      if (plan.assigneeUserId) ids.push(plan.assigneeUserId)
      ids.push(plan.requestedByUserId)
      break
    case "finished":
      ids.push(plan.requestedByUserId, ...await forPermission(OT_PERMISSIONS.receive))
      break
    case "received":
      ids.push(...await forPermission(OT_PERMISSIONS.conform))
      break
    case "rejected":
    case "reopened":
      ids.push(...await forPermission(OT_PERMISSIONS.manage))
      if (plan.assigneeUserId) ids.push(plan.assigneeUserId)
      break
    case "closed":
      ids.push(plan.requestedByUserId, ...await forPermission(OT_PERMISSIONS.manage))
      break
  }
  return [...new Set(ids)].filter((id) => id !== plan.actorUserId)
}

export async function sendWorkOrderNotification(plan: NotificationPlan): Promise<void> {
  const userIds = await recipients(plan)
  if (userIds.length === 0) return
  // La OT del administrador de contrato nace asignada al mecánico de su faena: entonces no está «por asignar».
  const text = plan.event === "created" && plan.assigneeUserId ? "Ya tiene mecánico asignado; puedes reasignarla." : BODY[plan.event]
  const body = [plan.equipment, text, plan.detail ? `Motivo: ${plan.detail}` : null].filter(Boolean).join(" · ")
  await notifyManyUser(userIds, {
    type: TYPE[plan.event],
    title: TITLE[plan.event](plan.folio),
    body,
    entityType: "mant_work_order",
    entityId: plan.workOrderId,
    entityHref: `/mantencion/ot/${plan.workOrderId}`,
    dedupeKey: `mant-ot:${plan.workOrderId}:${plan.event}:${plan.version}`,
  })
}

/** Dispara los avisos; llamar SÓLO cuando `db.transaction` ya resolvió. */
export function dispatchWorkOrderNotifications(plans: readonly NotificationPlan[]): void {
  if (plans.length === 0) return
  notifyAfterCommit(async () => {
    for (const plan of plans) await sendWorkOrderNotification(plan)
  })
}

export interface PartsReceivedNotice {
  workOrderId: string
  /** Recepción que dejó los repuestos en faena: parte de la clave de deduplicación. */
  receiptId: string
  /** Quien registró la recepción: nunca se avisa a sí mismo. */
  actorUserId: string
  /** Líneas de la OT que esa recepción dejó completas en faena. */
  itemCount: number
}

/**
 * Aviso a mantención de que repuestos pedidos para la OT llegaron completos a
 * faena (la recepción parcial no avisa: ver `registerReceipt`). Va al mecánico
 * asignado y a quien administra las OT de la faena (`mant:ot:manage`), con el
 * mismo criterio de `administrador` que el resto de los avisos de la OT.
 *
 * No es un `OtNotifyEvent` porque no depende de la versión de la OT: se
 * deduplica por recepción, así que reenviarlo no repite el aviso. Una OT
 * cerrada o anulada ya no espera nada: no se avisa. Llamar DESPUÉS del commit.
 */
export async function notifyWorkOrderPartsReceived(input: PartsReceivedNotice): Promise<void> {
  const [order] = await db
    .select({
      id: mantWorkOrders.id,
      folio: mantWorkOrders.folio,
      worksiteId: mantWorkOrders.worksiteId,
      status: mantWorkOrders.status,
      assignedToUserId: mantWorkOrders.assignedToUserId,
      equipmentSnapshot: mantWorkOrders.equipmentSnapshot,
    })
    .from(mantWorkOrders)
    .where(eq(mantWorkOrders.id, input.workOrderId))
    .limit(1)
  if (!order) return
  if (order.status === "cerrada" || order.status === "anulada") return

  const userIds = [...new Set([
    ...(order.assignedToUserId ? [order.assignedToUserId] : []),
    ...await holdersForPermission(OT_PERMISSIONS.manage, order.worksiteId, input.actorUserId),
  ])].filter((id) => id !== input.actorUserId)
  if (userIds.length === 0) return

  const lines = input.itemCount === 1 ? "1 línea recibida" : `${input.itemCount} líneas recibidas`
  // Mismo rótulo que `equipmentLabel` de `./core`; no se importa de ahí porque `core` importa este módulo.
  const equipment = `${order.equipmentSnapshot.code} · ${order.equipmentSnapshot.type}`
  await notifyManyUser(userIds, {
    type: "mant_ot_parts_received",
    title: `Repuestos recibidos para OT ${order.folio}`,
    body: `${equipment} · ${lines} en faena. Revisa «Repuestos pedidos» en la OT.`,
    entityType: "mant_work_order",
    entityId: order.id,
    entityHref: `/mantencion/ot/${order.id}`,
    dedupeKey: `mant-ot-parts:${order.id}:${input.receiptId}`,
  })
}
