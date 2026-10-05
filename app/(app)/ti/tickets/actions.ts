"use server"

import { revalidatePath } from "next/cache"
import { can, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import { createTicket, transitionTicket, assignTicket, addTicketComment } from "@/lib/services/ti/tickets"
import {
  itTicketCreateSchema, itTicketTransitionSchema, itTicketCommentSchema, itTicketAssignSchema,
  IT_TICKET_UNASSIGN,
} from "@/lib/validation/ti"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import type { ActionState } from "@/lib/validation/masters"
import {
  notifyAfterCommit, notifyManyUser, getUserIdsWithPermissionForWorksite,
} from "@/lib/services/notifications"
import { IT_TICKET_PRIORITY_META, itTicketStatusLabel } from "@/lib/services/ti/constants"

function priorityLabel(priority: string): string {
  return IT_TICKET_PRIORITY_META[priority]?.label ?? priority
}

/**
 * Devuelve la frase completa (con su etiqueta) o cadena vacía si no hay
 * resolución: la action nunca deja pasar `resuelto` sin texto, pero el
 * servicio sí lo acepta, y un futuro cierre masivo no debe mandar un correo
 * con "Resolución:" colgando.
 */
function resolutionSentence(text: string | null): string {
  if (!text?.trim()) return ""
  const trimmed = text.trim()
  const short = trimmed.length <= 200 ? trimmed : `${trimmed.slice(0, 200).trimEnd()}…`
  return ` Resolución: ${short}`
}

/**
 * TIUX-05: un envío fallido no debe vaciar lo que la persona escribió. Los
 * `<input>` no controlados de un `<form action>` vuelven a su `defaultValue`
 * cuando la acción termina, así que el servidor devuelve lo enviado y el
 * formulario lo usa como `defaultValue`. Solo texto de los campos nombrados:
 * nunca archivos ni nada que no sea de la propia persona.
 */
function withSubmittedValues(
  state: ActionState,
  formData: FormData,
  keys: readonly string[],
): ActionState {
  if (state.ok) return state
  const values: Record<string, string> = {}
  for (const key of keys) {
    const value = formData.get(key)
    if (typeof value === "string") values[key] = value
  }
  return { ...state, data: { ...state.data, values } }
}

const CREATE_KEYS = ["subject", "description", "category", "priority", "workerId", "worksiteId", "assetId"] as const
const TRANSITION_KEYS = ["status", "reason", "resolution"] as const
const ASSIGN_KEYS = ["assigneeUserId", "reason"] as const
const COMMENT_KEYS = ["body", "isInternal"] as const

export async function createTicketAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return withSubmittedValues(await createTicketImpl(prev, formData), formData, CREATE_KEYS)
}

export async function transitionTicketAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return withSubmittedValues(await transitionTicketImpl(prev, formData), formData, TRANSITION_KEYS)
}

export async function assignTicketAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return withSubmittedValues(await assignTicketImpl(prev, formData), formData, ASSIGN_KEYS)
}

export async function commentTicketAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return withSubmittedValues(await commentTicketImpl(prev, formData), formData, COMMENT_KEYS)
}

async function createTicketImpl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:create_ticket") }
  catch {
    // Técnicos TI usan manage_tickets para crear también.
    try { session = await requirePermission("ti:manage_tickets") }
    catch { return { ok: false, message: "Sin permisos para crear tickets" } }
  }

  // La categoría no tiene valor por defecto en el formulario (preseleccionar
  // «Hardware» sesgaba los reportes hacia esa categoría): si no llega, es un
  // campo sin completar, no un «hardware» implícito.
  if (!formData.get("category")) {
    return { ok: false, message: "Revisa los datos del ticket", fieldErrors: { category: ["Selecciona una categoría"] } }
  }

  const parsed = parseZ(itTicketCreateSchema, {
    subject: formData.get("subject"),
    description: formData.get("description"),
    category: formData.get("category") || undefined,
    priority: formData.get("priority") || undefined,
    workerId: formData.get("workerId"),
    worksiteId: formData.get("worksiteId"),
    assetId: formData.get("assetId"),
  }, "Revisa los datos del ticket")
  if (!parsed.ok) return parsed

  try {
    const created = await createTicket(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))

    // Notificación (a): a quien administra tickets en la faena del ticket.
    // Diferida a después del commit (createTicket ya resolvió) y nunca
    // bloqueante — notifyManyUser nunca lanza.
    notifyAfterCommit(() =>
      getUserIdsWithPermissionForWorksite("ti:manage_tickets", created.worksiteId).then((ids) =>
        notifyManyUser(
          // Un técnico con ti:manage_tickets puede crear su propio ticket
          // (usa el permiso de "manage" como sustituto de "create"): no se
          // autonotifica.
          ids.filter((id) => id !== session.user.id),
          {
            type: "ti_ticket_created",
            title: `Nuevo ticket ${created.code}: ${created.subject}`,
            body: `Prioridad ${priorityLabel(created.priority)}. Reportado por ${session.user.name ?? session.user.email ?? "un usuario"}.`,
            entityType: "it_ticket",
            entityId: created.id,
            entityHref: `/ti/tickets/${created.id}`,
          },
        )))

    revalidatePath("/ti")
    revalidatePath("/ti/tickets")
    revalidatePath(`/ti/tickets/${created.id}`)
    if (parsed.data.assetId) revalidatePath(`/ti/activos/${parsed.data.assetId}`)
    return {
      ok: true,
      message: `${created.code} creado`,
      data: { ticketId: created.id, code: created.code, priority: created.priority },
    }
  } catch (error) {
    logger.error("[ti:createTicket]", error)
    return { ok: false, message: safeActionMessage(error, "Error al crear el ticket") }
  }
}

async function transitionTicketImpl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_tickets") }
  catch { return { ok: false, message: "Sin permisos para gestionar tickets" } }

  const parsed = parseZ(itTicketTransitionSchema, {
    ticketId: formData.get("ticketId"),
    status: formData.get("status"),
    reason: formData.get("reason"),
    resolution: formData.get("resolution"),
    assigneeUserId: formData.get("assigneeUserId"),
  }, "Revisa la transición")
  if (!parsed.ok) return parsed

  try {
    const result = await transitionTicket({
      ...parsed.data,
    }, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))

    // Notificación (b): al técnico recién asignado. `assigneeChanged` lo
    // calcula el servicio dentro de la transacción con la fila bloqueada — el
    // <Select> de la ficha reenvía el asignado actual en cada transición, así
    // que sin esta condición se notificaría en cada cambio de estado.
    if (result.assigneeChanged && result.assigneeUserId && result.assigneeUserId !== session.user.id) {
      const assigneeUserId = result.assigneeUserId
      notifyAfterCommit(() => notifyManyUser([assigneeUserId], {
        type: "ti_ticket_assigned",
        title: `Ticket asignado: ${result.code}`,
        body: `${result.subject} — prioridad ${priorityLabel(result.priority)}. Estado: ${itTicketStatusLabel(result.toStatus)}.`,
        entityType: "it_ticket",
        entityId: result.id,
        entityHref: `/ti/tickets/${result.id}`,
      }))
    }

    // Notificación (c): al solicitante, cuando el ticket queda resuelto.
    if (result.toStatus === "resuelto" && result.requesterUserId !== session.user.id) {
      notifyAfterCommit(() => notifyManyUser([result.requesterUserId], {
        type: "ti_ticket_resolved",
        title: `Ticket resuelto: ${result.code}`,
        body: `${result.subject}.${resolutionSentence(result.resolution)}`,
        entityType: "it_ticket",
        entityId: result.id,
        entityHref: `/ti/tickets/${result.id}`,
      }))
    }

    // Notificación (d): al solicitante, cuando TI queda esperando su respuesta.
    // `statusChanged` evita repetirlo si el estado ya era ese; el motivo del
    // cambio es una nota de TI y no viaja en el aviso.
    if (result.toStatus === "esperando_usuario" && result.statusChanged && result.requesterUserId !== session.user.id) {
      notifyAfterCommit(() => notifyManyUser([result.requesterUserId], {
        type: "ti_ticket_waiting_user",
        title: `TI espera tu respuesta: ${result.code}`,
        body: `${result.subject}. Para seguir avanzando, TI necesita que respondas en el ticket.`,
        entityType: "it_ticket",
        entityId: result.id,
        entityHref: `/ti/tickets/${result.id}`,
      }))
    }

    revalidatePath("/ti")
    revalidatePath("/ti/tickets")
    revalidatePath(`/ti/tickets/${parsed.data.ticketId}`)
    if (result.assetId) revalidatePath(`/ti/activos/${result.assetId}`)
    return { ok: true, message: "Ticket actualizado" }
  } catch (error) {
    logger.error("[ti:transitionTicket]", error)
    const message = safeActionMessage(error, "Error al actualizar el ticket")
    // El servicio valida con la ticket bloqueada (p. ej. cerrar sin una
    // resolución previa): ese error pertenece al campo Resolución, no a
    // «Motivo» ni a una alerta genérica.
    if (/cómo se resolvió/i.test(message)) {
      return { ok: false, message: "Revisa la transición", fieldErrors: { resolution: [message] } }
    }
    return { ok: false, message }
  }
}

async function commentTicketImpl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_tickets") }
  catch {
    try { session = await requirePermission("ti:create_ticket") }
    catch { return { ok: false, message: "Sin permisos para comentar" } }
  }

  const isInternal = formData.get("isInternal") === "on"
  if (isInternal && !can(session, "ti:comment_internal")) {
    return { ok: false, message: "Sin permisos para notas internas" }
  }

  const parsed = parseZ(itTicketCommentSchema, {
    ticketId: formData.get("ticketId"),
    body: formData.get("body"),
    isInternal,
  }, "Revisa el comentario")
  if (!parsed.ok) return parsed

  try {
    // Quien solo puede crear tickets comenta únicamente los suyos, igual que
    // solo ve y abre los suyos en la lista y en la ficha.
    const comment = await addTicketComment(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session),
    can(session, "ti:manage_tickets") ? undefined : session.user.id)

    // Aviso al solicitante por comentario público de TI. Una nota interna no
    // avisa a nadie, y quien comenta no se avisa a sí mismo (tampoco cuando el
    // propio solicitante responde). Una notificación por comentario, con la
    // clave del comentario como deduplicación.
    if (!parsed.data.isInternal && can(session, "ti:manage_tickets") && comment.requesterUserId !== session.user.id) {
      const short = parsed.data.body.length <= 200 ? parsed.data.body : `${parsed.data.body.slice(0, 200).trimEnd()}…`
      notifyAfterCommit(() => notifyManyUser([comment.requesterUserId], {
        type: "ti_ticket_comment",
        title: `Nuevo comentario de TI en ${comment.code}`,
        body: `${comment.subject}. ${short}`,
        entityType: "it_ticket",
        entityId: comment.ticketId,
        entityHref: `/ti/tickets/${comment.ticketId}`,
        dedupeKey: `ti_ticket_comment:${comment.id}`,
      }))
    }

    revalidatePath(`/ti/tickets/${parsed.data.ticketId}`)
    return { ok: true, message: "Comentario agregado" }
  } catch (error) {
    logger.error("[ti:commentTicket]", error)
    return { ok: false, message: safeActionMessage(error, "Error al agregar el comentario") }
  }
}

async function assignTicketImpl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_tickets") }
  catch { return { ok: false, message: "Sin permisos para gestionar tickets" } }

  // «Asignarme» manda `self=1` y el responsable sale de la sesión, no del
  // formulario: nadie puede asignarle un ticket a otro con ese botón.
  const self = formData.get("self") === "1"
  const parsed = parseZ(itTicketAssignSchema, {
    ticketId: formData.get("ticketId"),
    assigneeUserId: self ? session.user.id : formData.get("assigneeUserId"),
    reason: formData.get("reason"),
  }, "Revisa la asignación")
  if (!parsed.ok) return parsed

  try {
    // Solo se puede asignar a quien gestiona tickets: antes bastaba con que el
    // usuario existiera y estuviera activo.
    if (parsed.data.assigneeUserId !== IT_TICKET_UNASSIGN) {
      const technicians = await getUserIdsWithPermission("ti:manage_tickets")
      if (!technicians.includes(parsed.data.assigneeUserId)) {
        return { ok: false, message: "Revisa la asignación", fieldErrors: { assigneeUserId: ["Esa persona no gestiona tickets de TI"] } }
      }
    }

    const result = await assignTicket(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))

    // Mismo aviso que al asignar desde una transición: al técnico recién
    // asignado, salvo que se haya asignado él mismo.
    if (result.assigneeUserId && result.assigneeUserId !== session.user.id) {
      const assigneeUserId = result.assigneeUserId
      notifyAfterCommit(() => notifyManyUser([assigneeUserId], {
        type: "ti_ticket_assigned",
        title: `Ticket asignado: ${result.code}`,
        body: `${result.subject} — prioridad ${priorityLabel(result.priority)}. Estado: ${itTicketStatusLabel(result.toStatus)}.`,
        entityType: "it_ticket",
        entityId: result.id,
        entityHref: `/ti/tickets/${result.id}`,
      }))
    }

    revalidatePath("/ti")
    revalidatePath("/ti/tickets")
    revalidatePath(`/ti/tickets/${parsed.data.ticketId}`)
    if (result.assetId) revalidatePath(`/ti/activos/${result.assetId}`)
    return { ok: true, message: result.assigneeUserId ? "Responsable asignado" : "Ticket sin responsable" }
  } catch (error) {
    logger.error("[ti:assignTicket]", error)
    const message = safeActionMessage(error, "Error al asignar el ticket")
    // El motivo exigido al cambiar de responsable pertenece a su campo.
    if (/motivo del cambio de responsable/i.test(message)) {
      return { ok: false, message: "Revisa la asignación", fieldErrors: { reason: [message] } }
    }
    return { ok: false, message }
  }
}
