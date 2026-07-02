"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { type ActionState } from "@/lib/validation/operations"

const REVALIDATE = "/solicitudes"

export async function cancelRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("requests:create") }
  catch { return { ok: false, message: "Sin permisos" } }

  const requestId = formData.get("requestId") as string
  if (!requestId) return { ok: false, message: "ID requerido" }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (!["draft", "returned"].includes(request.status)) {
    return { ok: false, message: "No se puede cancelar una solicitud en estado " + request.status }
  }
  if (request.requesterId !== session.user.id && !session.user.permissions.includes("requests:view_all")) {
    return { ok: false, message: "Solo puedes cancelar tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }

  await db.transaction(async (tx) => {
    await tx.update(purchaseRequests).set({
      status:    "cancelled",
      updatedAt: new Date().toISOString(),
    }).where(eq(purchaseRequests.id, requestId))

    await recordStatusChange({
      entityType: "purchase_request",
      entityId:   requestId,
      fromStatus: request.status,
      toStatus:   "cancelled",
      changedBy:  session.user.id,
    }, tx)
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "status_change",
      entityType: "purchase_request",
      entityId:   requestId,
      entityCode: request.code,
      oldState:   { status: request.status },
      newState:   { status: "cancelled" },
    }, tx)
  })

  revalidatePath(REVALIDATE)
  redirect(REVALIDATE)
}
