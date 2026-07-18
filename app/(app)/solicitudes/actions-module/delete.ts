"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests } from "@/db/schema"
import { can, canAccessWorksite, requireAuth } from "@/lib/auth/can"
import { deleteRequest } from "@/lib/services/requests-delete"
import { isOwnerDeletable } from "@/lib/services/requests-delete.constants"
import { type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"

const REVALIDATE = "/solicitudes"

export async function deleteRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireAuth() }
  catch { return { ok: false, message: "Sin permisos" } }
  if (!can(session, "requests:view_own") && !can(session, "requests:delete") && !can(session, "requests:view_all")) {
    return { ok: false, message: "Sin permisos para eliminar solicitudes" }
  }

  const requestId = formData.get("requestId") as string
  if (!requestId) return { ok: false, message: "ID requerido" }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }

  const isOwner = request.requesterId === session.user.id
  const canDeleteAny = can(session, "requests:delete")
  if (!isOwner && !canDeleteAny) {
    return { ok: false, message: "Solo puedes eliminar tus propias solicitudes" }
  }
  // B-1: sin el permiso privilegiado, el dueño solo puede eliminar solicitudes
  // que no están en el pipeline de aprobación (draft/returned/rejected/cancelled).
  if (!canDeleteAny && !isOwnerDeletable(request.status)) {
    return { ok: false, message: "Esta solicitud está en revisión; requiere permiso para eliminarla" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }

  try {
    await deleteRequest(requestId, session.user.id, { userEmail: session.user.email ?? undefined })
  } catch (e) {
    logger.error("[deleteRequestAction]", e)
    return { ok: false, message: "Error al eliminar la solicitud" }
  }

  revalidatePath(REVALIDATE)
  revalidateTag("badge-counts", { expire: 0 })
  return { ok: true, message: "Solicitud eliminada correctamente" }
}
