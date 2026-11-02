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
  assigned: "Entra a taller y registra el ingreso desde la app.",
  finished: "Falta registrar la recepción del equipo.",
  received: "Revisa el equipo y registra la recepción en faena (conformidad).",
  rejected: "Fue devuelta a «En taller».",
  reopened: "Fue reabierta y vuelve a «En taller».",
  closed: "Tiene la conformidad de la faena.",
}

async function recipients(plan: NotificationPlan): Promise<string[]> {
  const forPermission = (permission: string) => getUserIdsWithPermissionForWorksite(permission, plan.worksiteId)
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
  const body = [plan.equipment, BODY[plan.event], plan.detail ? `Motivo: ${plan.detail}` : null].filter(Boolean).join(" · ")
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
