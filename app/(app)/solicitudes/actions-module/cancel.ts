"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { can, canAccessWorksite, requireAuth } from "@/lib/auth/can"
import { type ActionState } from "@/lib/validation/operations"

const REVALIDATE = "/solicitudes"

export async function cancelRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireAuth() }
  catch { return { ok: false, message: "Sin permisos" } }
  if (!can(session, "requests:create") && !can(session, "requests:view_all")) {
    return { ok: false, message: "Sin permisos para cancelar solicitudes" }
  }

  const requestId = formData.get("requestId") as string
  if (!requestId) return { ok: false, message: "ID requerido" }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
    with: { items: true },
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  const cancellableStatuses = ["draft", "returned", "submitted", "in_review", "partially_approved"]
  if (!cancellableStatuses.includes(request.status)) {
    return { ok: false, message: "No se puede cancelar una solicitud en estado " + request.status }
  }
  const reason = (formData.get("reason") as string | null)?.trim()
  const requiresReason = !["draft", "returned"].includes(request.status)
  if (requiresReason && !reason) {
    return { ok: false, message: "El motivo de cancelación es obligatorio" }
  }
  if (request.requesterId !== session.user.id && !can(session, "requests:view_all")) {
    return { ok: false, message: "Solo puedes cancelar tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }
  const lockedStatuses = ["in_purchase_order", "purchased", "partially_received", "received", "partially_delivered", "delivered"]
  if (request.items.some((item) => lockedStatuses.includes(item.status))) {
    return { ok: false, message: "No se puede cancelar: la solicitud ya tiene ítems en compra, recepción o entrega" }
  }

  await db.transaction(async (tx) => {
    const now = new Date().toISOString()
    await tx.update(purchaseRequests).set({
      status:    "cancelled",
      updatedAt: now,
    }).where(eq(purchaseRequests.id, requestId))

    const itemIdsToReject = request.items
      .filter((item) => ["draft", "requested", "approved", "returned", "pending_purchase"].includes(item.status))
      .map((item) => item.id)

    if (itemIdsToReject.length > 0) {
      await tx
        .update(purchaseRequestItems)
        .set({ status: "rejected", updatedAt: now })
        .where(and(
          inArray(purchaseRequestItems.id, itemIdsToReject),
          inArray(purchaseRequestItems.status, ["draft", "requested", "approved", "returned", "pending_purchase"]),
        ))

      for (const item of request.items.filter((item) => itemIdsToReject.includes(item.id))) {
        await recordStatusChange({
          entityType: "request_item",
          entityId: item.id,
          fromStatus: item.status,
          toStatus: "rejected",
          changedBy: session.user.id,
          reason,
        }, tx)
      }
    }

    await recordStatusChange({
      entityType: "purchase_request",
      entityId:   requestId,
      fromStatus: request.status,
      toStatus:   "cancelled",
      changedBy:  session.user.id,
      reason,
    }, tx)
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "status_change",
      entityType: "purchase_request",
      entityId:   requestId,
      entityCode: request.code,
      oldState:   { status: request.status },
      newState:   { status: "cancelled", rejectedItemIds: itemIdsToReject },
      reason,
    }, tx)
  })

  revalidatePath(REVALIDATE)
  redirect(REVALIDATE)
}
