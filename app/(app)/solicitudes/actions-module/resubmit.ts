"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems } from "@/db/schema"
import { can, canAccessWorksite, requireAuth } from "@/lib/auth/can"
import { submitItem } from "@/lib/services/item-state"
import { type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"

const REVALIDATE = "/solicitudes"

export async function resubmitReturnedItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requireAuth() }
  catch { return { ok: false, message: "Debes iniciar sesión" } }

  const itemId = formData.get("itemId") as string | null
  if (!itemId) return { ok: false, message: "Ítem no especificado" }

  const row = await db
    .select({
      id:          purchaseRequestItems.id,
      status:      purchaseRequestItems.status,
      requestId:   purchaseRequestItems.requestId,
      requesterId: purchaseRequests.requesterId,
      worksiteId:  purchaseRequests.worksiteId,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(eq(purchaseRequestItems.id, itemId))
    .then((rows) => rows[0])

  if (!row) return { ok: false, message: "Ítem no encontrado" }
  if (row.status !== "returned") {
    return { ok: false, message: "Solo se pueden re-enviar ítems devueltos" }
  }

  const isOwner = row.requesterId === session.user.id
  const canManageAll = can(session, "requests:view_all")
  if (!isOwner && !canManageAll) {
    return { ok: false, message: "Solo el solicitante puede re-enviar el ítem" }
  }
  if (!canAccessWorksite(session, row.worksiteId)) {
    return { ok: false, message: "Sin acceso a la faena de esta solicitud" }
  }

  try {
    await submitItem(itemId, session.user.id, { userEmail: session.user.email ?? undefined })
    revalidatePath(REVALIDATE)
  revalidateTag("badge-counts", { expire: 0 })
    revalidatePath(`${REVALIDATE}/${row.requestId}`)
  revalidateTag("badge-counts", { expire: 0 })
    return { ok: true, message: "Ítem re-enviado a aprobación" }
  } catch (e) {
    logger.error("[resubmitReturnedItemAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al re-enviar ítem" }
  }
}
