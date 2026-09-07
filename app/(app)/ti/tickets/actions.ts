"use server"

import { revalidatePath } from "next/cache"
import { can, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import { createTicket, transitionTicket, addTicketComment } from "@/lib/services/ti/tickets"
import {
  itTicketCreateSchema, itTicketTransitionSchema, itTicketCommentSchema,
} from "@/lib/validation/ti"
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

export async function createTicketAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:create_ticket") }
  catch {
    // Técnicos TI usan manage_tickets para crear también.
    try { session = await requirePermission("ti:manage_tickets") }
    catch { return { ok: false, message: "Sin permisos para crear tickets" } }
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
    return { ok: true, message: "Ticket creado", data: { ticketId: created.id } }
  } catch (error) {
    logger.error("[ti:createTicket]", error)
    return { ok: false, message: safeActionMessage(error, "Error al crear el ticket") }
  }
}

export async function transitionTicketAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
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

    revalidatePath("/ti")
    revalidatePath("/ti/tickets")
    revalidatePath(`/ti/tickets/${parsed.data.ticketId}`)
    if (result.assetId) revalidatePath(`/ti/activos/${result.assetId}`)
    return { ok: true, message: "Ticket actualizado" }
  } catch (error) {
    logger.error("[ti:transitionTicket]", error)
    return { ok: false, message: safeActionMessage(error, "Error al actualizar el ticket") }
  }
}

export async function commentTicketAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
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
    await addTicketComment(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session),
    can(session, "ti:manage_tickets") ? undefined : session.user.id)
    revalidatePath(`/ti/tickets/${parsed.data.ticketId}`)
    return { ok: true, message: "Comentario agregado" }
  } catch (error) {
    logger.error("[ti:commentTicket]", error)
    return { ok: false, message: safeActionMessage(error, "Error al agregar el comentario") }
  }
}
