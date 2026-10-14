"use server"

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { can, canAccessWorksite, requireAuth } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { requestItemSchema, type ActionState } from "@/lib/validation/operations"
import { updatePendingRequestItem } from "@/lib/services/request-item-edit"

export async function editPendingRequestItem(
  itemId: string,
  expectedUpdatedAt: string,
  rawItem: unknown,
): Promise<ActionState> {
  let session
  try { session = await requireAuth() }
  catch { return { ok: false, message: "Debes iniciar sesión para editar el ítem" } }

  if (!can(session, "requests:create")) {
    return { ok: false, message: "No tienes permisos para editar solicitudes" }
  }

  const parsed = requestItemSchema.safeParse(rawItem)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message
    return { ok: false, message: firstIssue ? `Revisa el ítem: ${firstIssue}` : "Revisa los datos del ítem" }
  }

  const [target] = await db
    .select({
      requesterId: purchaseRequests.requesterId,
      requestId: purchaseRequests.id,
      worksiteId: purchaseRequests.worksiteId,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
    .where(eq(purchaseRequestItems.id, itemId))
    .limit(1)
  if (!target || target.requesterId !== session.user.id) {
    return { ok: false, message: "Solo quien creó la solicitud puede editar sus ítems" }
  }
  if (!canAccessWorksite(session, target.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }

  try {
    const result = await updatePendingRequestItem({
      itemId,
      expectedUpdatedAt,
      actorUserId: session.user.id,
      actorUserEmail: session.user.email ?? undefined,
      item: parsed.data,
    })
    revalidateOperationalViews([
      "/solicitudes",
      `/solicitudes/${target.requestId}`,
      "/aprobaciones",
    ])
    return {
      ok: true,
      message: "Ítem actualizado; sigue pendiente de aprobación",
      data: { updatedAt: result.updatedAt, quantity: result.quantity },
    }
  } catch (error) {
    logger.error("[editPendingRequestItem] No se pudo actualizar el ítem", error)
    return { ok: false, message: safeActionMessage(error, "No se pudo actualizar el ítem") }
  }
}
