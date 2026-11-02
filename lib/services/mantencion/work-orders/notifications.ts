import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { permissions, rolePermissions, roles, userPermissions, userRoles } from "@/db/schema"
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

export type OtNotifyEvent = "created" | "assigned" | "finished" | "received" | "rejected" | "reopened" | "closed"

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
  finished: "mant_ot_finished",
  received: "mant_ot_received",
  rejected: "mant_ot_rejected",
  reopened: "mant_ot_rejected",
  closed: "mant_ot_closed",
}

const TITLE: Record<OtNotifyEvent, (folio: string) => string> = {
  created: (folio) => `Nueva orden de trabajo ${folio}`,
  assigned: (folio) => `Se te asignó la orden de trabajo ${folio}`,
  finished: (folio) => `La orden de trabajo ${folio} salió de taller`,
  received: (folio) => `La orden de trabajo ${folio} espera tu conformidad`,
  rejected: (folio) => `La orden de trabajo ${folio} volvió a taller`,
  reopened: (folio) => `Se reabrió la orden de trabajo ${folio}`,
  closed: (folio) => `La orden de trabajo ${folio} quedó cerrada`,
}

const BODY: Record<OtNotifyEvent, string> = {
  created: "Está por asignar.",
  assigned: "Entra a taller y registra el ingreso desde la app o el PC.",
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

async function recipients(plan: NotificationPlan): Promise<string[]> {
  const forPermission = async (permission: string) => {
    const candidates = (await getUserIdsWithPermissionForWorksite(permission, plan.worksiteId))
      .filter((id) => id !== plan.actorUserId)
    const responsible = await holdersBeyondAdmin(candidates, permission)
    return responsible.size > 0 ? candidates.filter((id) => responsible.has(id)) : candidates
  }
  const ids: string[] = []
  switch (plan.event) {
    case "created":
      ids.push(...await forPermission(OT_PERMISSIONS.manage))
      break
    case "assigned":
      if (plan.assigneeUserId) ids.push(plan.assigneeUserId)
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
