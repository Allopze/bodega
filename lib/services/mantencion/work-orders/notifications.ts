import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, permissions, preventionCapaActions,
  preventionInspectionFindings, preventionInspectionRuns, purchaseRequestItems, rolePermissions, roles, userPermissions,
  userRoles, users,
} from "@/db/schema"
import type { NotificationType } from "@/db/schema/audit"
import { logger } from "@/lib/logger"
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

/**
 * `capa_cancelled` no avisa a quien trabaja la OT sino a Prevención: anular una OT nacida de un hallazgo cancela su
 * acción correctiva (OT-1, `capa-link.ts`). Sus destinatarios salen de la CAPA y de la inspección, no de la OT.
 */
export type OtNotifyEvent = "created" | "assigned" | "unassigned" | "voided" | "finished" | "received" | "rejected" | "reopened" | "closed" | "capa_cancelled"
type OtOrderEvent = Exclude<OtNotifyEvent, "capa_cancelled">

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
  /** Complemento del cuerpo (motivo del rechazo, etc.). En `capa_cancelled`, el motivo de la anulación. */
  detail?: string | null
  /** `unassigned` por una reasignación: la OT no vuelve a «Por asignar», pasó a otro mecánico. */
  reassigned?: boolean
  /** `capa_cancelled`: la acción correctiva que cancelló la anulación y el hallazgo que volvió a quedar abierto. */
  capa?: { capaActionId: string; capaCode: string; findingId: string }
}

const TYPE: Record<OtOrderEvent, NotificationType> = {
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

const TITLE: Record<OtOrderEvent, (folio: string) => string> = {
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

const BODY: Record<OtOrderEvent, string> = {
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

/**
 * Faena ACTUAL del equipo de la OT (`fuel_vehicles.worksite_id`): tras un traslado, la recepción y la
 * conformidad las da esa faena y no la de imputación (`plan.worksiteId`). Se resuelve al enviar, como
 * los destinatarios; si la OT o el equipo ya no se encuentran, vale la de imputación.
 */
async function currentWorksiteOfOrder(plan: Pick<NotificationPlan, "workOrderId" | "worksiteId">): Promise<string> {
  const [row] = await db
    .select({ worksiteId: fuelVehicles.worksiteId })
    .from(mantWorkOrders)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantWorkOrders.vehicleId))
    .where(eq(mantWorkOrders.id, plan.workOrderId))
    .limit(1)
  return row?.worksiteId ?? plan.worksiteId
}

async function recipients(plan: NotificationPlan): Promise<string[]> {
  const forPermission = (permission: string) => holdersForPermission(permission, plan.worksiteId, plan.actorUserId)
  // `finished → receive` y `received → conform`: quienes tienen el permiso en la faena donde está el equipo hoy.
  const forPermissionAtEquipment = async (permission: string) => holdersForPermission(permission, await currentWorksiteOfOrder(plan), plan.actorUserId)
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
      ids.push(plan.requestedByUserId, ...await forPermissionAtEquipment(OT_PERMISSIONS.receive))
      break
    case "received":
      ids.push(...await forPermissionAtEquipment(OT_PERMISSIONS.conform))
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

/**
 * Aviso a Prevención de que anular la OT de un hallazgo canceló su acción correctiva (OT-1, `releaseWorkOrderCapaOnVoid`).
 * Antes el hallazgo volvía a `open` y nadie de Prevención se enteraba.
 *
 * Es el canal de avisos que Prevención ya usa para la CAPA (`prevention-capa-reminders.ts`): una notificación
 * `system_alert` con enlace a la CAPA o a la inspección y `dedupeKey`. Le llega a dos personas:
 *  - al responsable de la CAPA, con el enlace a la acción (como sus recordatorios);
 *  - a quien responde por el hallazgo: el inspector de la inspección (quien la ejecutó; si aún no se ejecutó, a quien se
 *    asignó, y si no, quien la creó), con el enlace a los hallazgos de esa inspección, que es donde se deriva de nuevo.
 *    El hallazgo no guarda quién lo levantó; la inspección sí guarda su inspector.
 * Si son la misma persona recibe un solo aviso, con el enlace al hallazgo (es lo que tiene que atender). Quien anuló la OT
 * no se avisa a sí mismo, y un usuario inactivo tampoco. Los destinatarios se resuelven al enviar, como en los demás avisos.
 */
async function sendCapaCancelledNotice(plan: NotificationPlan): Promise<void> {
  const capaInfo = plan.capa
  if (!capaInfo) return
  const [capa] = await db
    .select({ responsibleUserId: preventionCapaActions.responsibleUserId })
    .from(preventionCapaActions)
    .where(eq(preventionCapaActions.id, capaInfo.capaActionId))
    .limit(1)
  const [finding] = await db
    .select({ runId: preventionInspectionFindings.runId })
    .from(preventionInspectionFindings)
    .where(eq(preventionInspectionFindings.id, capaInfo.findingId))
    .limit(1)
  const [run] = finding
    ? await db
      .select({
        executedByUserId: preventionInspectionRuns.executedByUserId,
        assignedToUserId: preventionInspectionRuns.assignedToUserId,
        createdByUserId: preventionInspectionRuns.createdByUserId,
      })
      .from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, finding.runId))
      .limit(1)
    : []
  const inspectorUserId = run ? run.executedByUserId ?? run.assignedToUserId ?? run.createdByUserId : null

  // El enlace de cada persona: el hallazgo manda si es la misma (la CAPA ya está cancelada; el hallazgo es lo que hay que derivar).
  const link = new Map<string, "capa" | "hallazgo">()
  if (capa?.responsibleUserId) link.set(capa.responsibleUserId, "capa")
  if (inspectorUserId && finding) link.set(inspectorUserId, "hallazgo")
  link.delete(plan.actorUserId)
  if (link.size === 0) return
  const active = new Set((await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, [...link.keys()]), eq(users.isActive, true)))).map((row) => row.id))

  const reason = (plan.detail ?? "").trim().replace(/[.\s]+$/u, "") || "sin motivo registrado"
  const notice = {
    type: "system_alert" as const,
    title: `Acción correctiva cancelada: ${capaInfo.capaCode}`,
    body: `La OT ${plan.folio} se anuló: ${reason}. La acción correctiva ${capaInfo.capaCode} se canceló y el hallazgo volvió a quedar abierto.`,
    // Una vez por OT y acción: una CAPA se cancela una sola vez.
    dedupeKey: `mant-ot:${plan.workOrderId}:${plan.event}:${capaInfo.capaActionId}`,
  }
  const toCapa = [...link].filter(([id, to]) => to === "capa" && active.has(id)).map(([id]) => id)
  const toFinding = [...link].filter(([id, to]) => to === "hallazgo" && active.has(id)).map(([id]) => id)
  if (toCapa.length > 0) {
    await notifyManyUser(toCapa, {
      ...notice, entityType: "prevention_capa", entityId: capaInfo.capaActionId, entityHref: `/prevencion/capa/${capaInfo.capaActionId}`,
    })
  }
  if (toFinding.length > 0 && finding) {
    await notifyManyUser(toFinding, {
      ...notice, entityType: "inspection_run", entityId: finding.runId, entityHref: `/prevencion/inspecciones/${finding.runId}#hallazgos`,
    })
  }
}

export async function sendWorkOrderNotification(plan: NotificationPlan): Promise<void> {
  if (plan.event === "capa_cancelled") return sendCapaCancelledNotice(plan)
  const userIds = await recipients(plan)
  if (userIds.length === 0) return
  // La OT del administrador de contrato nace asignada al mecánico de su faena: entonces no está «por asignar».
  const text = plan.event === "created" && plan.assigneeUserId
    ? "Ya tiene mecánico asignado; puedes reasignarla."
    : plan.event === "unassigned" && plan.reassigned
      ? "Se reasignó a otro mecánico: ya no tienes que ejecutarla."
      : BODY[plan.event]
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

/**
 * Dispara los avisos; llamar SÓLO cuando `db.transaction` ya resolvió. Un aviso que falla no impide los que siguen: el de
 * la anulación y el de la CAPA que ésta cancela no dependen uno del otro.
 */
export function dispatchWorkOrderNotifications(plans: readonly NotificationPlan[]): void {
  if (plans.length === 0) return
  notifyAfterCommit(async () => {
    for (const plan of plans) {
      try {
        await sendWorkOrderNotification(plan)
      } catch (error) {
        logger.error(`[notifications] no se pudo enviar el aviso «${plan.event}» de la OT ${plan.folio}`, error)
      }
    }
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
  /**
   * De esas líneas, los ítems de solicitud que nacieron de una nota de pedido
   * (`purchase_request_items.parts_note_item_id`): el autor de la NP recibe un
   * aviso propio que nombra el repuesto y la NP, en vez del aviso general.
   */
  requestItemIds?: readonly string[]
}

type NoteArrival = { authorId: string; noteCode: string; description: string }

/** Autor, folio y descripción de las líneas de NP detrás de esos ítems de solicitud. */
async function loadNoteArrivals(requestItemIds: readonly string[]): Promise<NoteArrival[]> {
  if (requestItemIds.length === 0) return []
  const rows = await db
    .select({
      authorId: mantPartsNotes.requestedByUserId,
      noteCode: mantPartsNotes.code,
      description: mantPartsNoteItems.description,
    })
    .from(purchaseRequestItems)
    .innerJoin(mantPartsNoteItems, eq(mantPartsNoteItems.id, purchaseRequestItems.partsNoteItemId))
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .where(inArray(purchaseRequestItems.id, [...requestItemIds]))
    .orderBy(mantPartsNotes.code, mantPartsNoteItems.sortOrder)
  // Una nota importada no tiene autor en CHOME: no hay a quién avisarle.
  return rows.flatMap((row) => (row.authorId ? [{ authorId: row.authorId, noteCode: row.noteCode, description: row.description }] : []))
}

/** «Llegó a faena: Filtro · NP-2026-0004 · OT OT-BIO-0007»; con varias líneas, un resumen legible. */
function noteArrivalTitle(lines: readonly NoteArrival[], folio: string): string {
  const codes = [...new Set(lines.map((line) => line.noteCode))]
  const first = lines[0]!.description
  const what = lines.length === 1 ? first : `${first} y ${lines.length - 1} más`
  return `${lines.length === 1 ? "Llegó" : "Llegaron"} a faena: ${what} · ${codes.join(", ")} · OT ${folio}`
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

  // El autor de la NP recibe el aviso que nombra su repuesto; no se le repite el general.
  const noteArrivals = await loadNoteArrivals(input.requestItemIds ?? [])
  const byAuthor = new Map<string, NoteArrival[]>()
  for (const arrival of noteArrivals) byAuthor.set(arrival.authorId, [...(byAuthor.get(arrival.authorId) ?? []), arrival])
  const authors = [...byAuthor.keys()].filter((id) => id !== input.actorUserId)

  const userIds = [...new Set([
    ...(order.assignedToUserId ? [order.assignedToUserId] : []),
    ...await holdersForPermission(OT_PERMISSIONS.manage, order.worksiteId, input.actorUserId),
  ])].filter((id) => id !== input.actorUserId && !byAuthor.has(id))

  // Mismo rótulo que `equipmentLabel` de `./core`; no se importa de ahí porque `core` importa este módulo.
  const equipment = `${order.equipmentSnapshot.code} · ${order.equipmentSnapshot.type}`
  const link = { entityType: "mant_work_order", entityId: order.id, entityHref: `/mantencion/ot/${order.id}` }

  for (const authorId of authors) {
    const lines = byAuthor.get(authorId)!
    await notifyManyUser([authorId], {
      type: "mant_ot_parts_received",
      title: noteArrivalTitle(lines, order.folio),
      body: `${equipment} · ${lines.map((line) => line.description).join("; ")}. Ya está en la bodega de la faena, reservado para esta OT.`,
      ...link,
      dedupeKey: `mant-ot-parts-np:${order.id}:${input.receiptId}`,
    })
  }

  if (userIds.length === 0) return
  const lines = input.itemCount === 1 ? "1 línea recibida" : `${input.itemCount} líneas recibidas`
  await notifyManyUser(userIds, {
    type: "mant_ot_parts_received",
    title: `Repuestos recibidos para OT ${order.folio}`,
    body: `${equipment} · ${lines} en faena. Revisa «Solicitudes de compra» en la OT.`,
    ...link,
    dedupeKey: `mant-ot-parts:${order.id}:${input.receiptId}`,
  })
}
