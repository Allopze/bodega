"use server"

import { revalidatePath, revalidateTag } from "next/cache"
  revalidateTag("badge-counts", { expire: 0 })
import { redirect } from "next/navigation"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests, products } from "@/db/schema"
import { can, canAccessWorksite, requireAuth } from "@/lib/auth/can"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { submitItemTx } from "@/lib/services/item-state"
import { notifyManyUser, getUserIdsWithPermission, notifyAfterCommit } from "@/lib/services/notifications"
import { type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"
import { isRequestType, permissionForRequestType, QUOTATION_TYPES } from "@/lib/request-types"
import { submitRepuestoRequest } from "@/lib/services/repuestos"
import { submitServiceRequest } from "@/lib/services/servicios"
import { persistDraft } from "./draft"

const REVALIDATE = "/solicitudes"

export async function submitRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireAuth() }
  catch { return { ok: false, message: "Debes iniciar sesión para enviar solicitudes" } }

  let requestId = formData.get("requestId") as string
  if (formData.get("itemsJson")) {
    if (requestId) formData.set("id", requestId)
    const saved = await persistDraft(session, formData)
    if (!saved.ok) return saved
    requestId = saved.requestId ?? requestId
  }
  if (!requestId) return { ok: false, message: "ID de solicitud requerido" }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
    with:  { items: true },
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (!isRequestType(request.requestType)) return { ok: false, message: "Tipo de solicitud no soportado" }
  if (!can(session, permissionForRequestType(request.requestType, "submit"))) {
    return { ok: false, message: "Sin permisos para enviar este tipo de solicitud" }
  }
  if (request.status !== "draft") return { ok: false, message: "Solo se pueden enviar solicitudes en borrador" }
  if (request.items.length === 0) return { ok: false, message: "La solicitud debe tener al menos un ítem" }
  if (request.requesterId !== session.user.id && !session.user.permissions.includes("requests:view_all")) {
    return { ok: false, message: "Solo puedes enviar tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }

  const catalogProductIds = request.items
    .map((i) => i.productId)
    .filter((id): id is string => id != null)
  if (catalogProductIds.length > 0) {
    const inactiveProducts = await db
      .select({ name: products.name })
      .from(products)
      .where(and(inArray(products.id, catalogProductIds), eq(products.isActive, false)))
    if (inactiveProducts.length > 0) {
      const names = inactiveProducts.map((p) => p.name).join(", ")
      return { ok: false, message: `Los siguientes productos están inactivos y no pueden solicitarse: ${names}` }
    }
  }

  if (QUOTATION_TYPES.has(request.requestType)) {
    try {
      const submitFn = request.requestType === "repuestos" ? submitRepuestoRequest : submitServiceRequest
      await submitFn({
        requestId,
        userId:    session.user.id,
        userEmail: session.user.email ?? undefined,
      })
    } catch (e) {
      logger.error("[submitRequest:quotation]", e)
      return { ok: false, message: e instanceof Error ? e.message : "Error al enviar la solicitud" }
    }

    notifyAfterCommit(() => getUserIdsWithPermission("approvals:approve").then((approverIds) =>
      notifyManyUser(approverIds, {
        type:       "request_submitted",
        title:      `Nueva solicitud: ${request.code}`,
        body:       `${session.user.name ?? session.user.email} envió una solicitud con ${request.items.length} ítem${request.items.length !== 1 ? "s" : ""}`,
        entityType: "purchase_request",
        entityId:   requestId,
        entityHref: `/solicitudes/${requestId}`,
      }),
    ))

    revalidatePath(REVALIDATE)
  revalidateTag("badge-counts", { expire: 0 })
    redirect(`${REVALIDATE}/${requestId}`)
  }

  const now = new Date().toISOString()

  try {
    await db.transaction(async (tx) => {
      await tx.update(purchaseRequests).set({
        status:      "submitted",
        submittedAt: now,
        updatedAt:   now,
      }).where(eq(purchaseRequests.id, requestId))

      await recordStatusChange({
        entityType: "purchase_request",
        entityId:   requestId,
        fromStatus: "draft",
        toStatus:   "submitted",
        changedBy:  session.user.id,
      }, tx)
      await recordAudit({
        userId:     session.user.id,
        userEmail:  session.user.email ?? undefined,
        action:     "status_change",
        entityType: "purchase_request",
        entityId:   requestId,
        entityCode: request.code,
        oldState:   { status: "draft" },
        newState:   { status: "submitted" },
      }, tx)

      for (const item of request.items) {
        await submitItemTx(tx, item.id, session.user.id, { userEmail: session.user.email ?? undefined })
      }
    })
  } catch (e) {
    logger.error("[submitRequest]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al enviar la solicitud" }
  }

  notifyAfterCommit(() => getUserIdsWithPermission("approvals:approve").then((approverIds) =>
    notifyManyUser(approverIds, {
      type:       "request_submitted",
      title:      `Nueva solicitud: ${request.code}`,
      body:       `${session.user.name ?? session.user.email} envió una solicitud con ${request.items.length} ítem${request.items.length !== 1 ? "s" : ""}`,
      entityType: "purchase_request",
      entityId:   requestId,
      entityHref: `/solicitudes/${requestId}`,
    }),
  ))

  revalidatePath(REVALIDATE)
  revalidateTag("badge-counts", { expire: 0 })
  redirect(`${REVALIDATE}/${requestId}`)
}
