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
    const ticketId = await createTicket(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti")
    revalidatePath("/ti/tickets")
    revalidatePath(`/ti/tickets/${ticketId}`)
    if (parsed.data.assetId) revalidatePath(`/ti/activos/${parsed.data.assetId}`)
    return { ok: true, message: "Ticket creado", data: { ticketId } }
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
  }, "Revisa la transición")
  if (!parsed.ok) return parsed

  try {
    await transitionTicket({
      ...parsed.data,
      assigneeUserId: session.user.id,
    }, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti")
    revalidatePath("/ti/tickets")
    revalidatePath(`/ti/tickets/${parsed.data.ticketId}`)
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
    await addTicketComment(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath(`/ti/tickets/${parsed.data.ticketId}`)
    return { ok: true, message: "Comentario agregado" }
  } catch (error) {
    logger.error("[ti:commentTicket]", error)
    return { ok: false, message: safeActionMessage(error, "Error al agregar el comentario") }
  }
}
