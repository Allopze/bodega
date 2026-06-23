"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { and, eq, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, requestItemAttributes, products,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { can, canAccessWorksite, requireAuth, requirePermission } from "@/lib/auth/can"
import { submitItem, submitItemTx } from "@/lib/services/item-state"
import { notifyManyUser, getUserIdsWithPermission, notifyAfterCommit } from "@/lib/services/notifications"
import { requestSchema, type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"
import { isRequestType, permissionForRequestType, QUOTATION_TYPES } from "@/lib/request-types"
import { addQuotation, persistRepuestoDraft, submitRepuestoRequest } from "@/lib/services/repuestos"
import { addServiceQuotation, persistServiceDraft, submitServiceRequest } from "@/lib/services/servicios"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { persistRequestWithDiff } from "@/lib/services/requests-draft"
import { deleteRequest, isRequestDeletable } from "@/lib/services/requests-delete"

const REVALIDATE = "/solicitudes"

// ── Save as draft ─────────────────────────────────────────────────────────────

export async function saveDraft(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { requestId?: string; lastSavedAt?: string }> {
  let session
  try { session = await requireAuth() }
  catch { return { ok: false, message: "Debes iniciar sesión para crear solicitudes" } }

  const result = await persistDraft(session, formData)
  if (!result.ok) return result

  revalidatePath(REVALIDATE)
  // U-01: return lastSavedAt so the UI can display "guardado a las HH:MM:SS".
  return { ok: true, message: "Borrador guardado", requestId: result.requestId, lastSavedAt: new Date().toISOString() }
}

async function persistDraft(
  session: Session,
  formData: FormData,
): Promise<ActionState & { requestId?: string }> {
  // Parse items from JSON hidden input
  let itemsRaw: unknown[] = []
  try { itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]") } catch { /* ignore */ }

  const parsed = requestSchema.safeParse({
    id:           formData.get("id") || undefined,
    worksiteId:   formData.get("worksiteId"),
    requestType:  formData.get("requestType") || "epp",
    urgency:      formData.get("urgency") || "normal",
    requiredDate: String(formData.get("requiredDate") ?? ""),
    notes:        formData.get("notes") || "",
    items:        itemsRaw,
  })
  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    const fieldErrors = flattened.fieldErrors as Record<string, string[]>
    return {
      ok: false,
      message: fieldErrors.items?.[0]
        ? `Revisa los ítems de la solicitud: ${fieldErrors.items[0]}`
        : "Revisa los datos de la solicitud",
      fieldErrors,
    }
  }
  const d = parsed.data
 
  const createPermission = permissionForRequestType(d.requestType, "create")
  if (!can(session, createPermission)) {
    return { ok: false, message: "No tienes permisos para crear este tipo de solicitud" }
  }

  const isEdit = !!d.id
  if (!canAccessWorksite(session, d.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  // ── Quotation branch: delegate to factory (repuestos / servicios) ──────────
  if (QUOTATION_TYPES.has(d.requestType)) {
    const items = d.items.map((item, i) => ({
      id:            item.id,
      description:   item.productNameFree?.trim() || item.productId || "",
      quantity:      item.quantity,
      unitOfMeasure: item.unitOfMeasure,
      sortOrder:     i,
      notes:         item.notes || null,
      partNumber:    null,
      location:      null,
      equipmentName: null,
      patent:        null,
      brand:         null,
      model:         null,
    }))
    const requestInput = {
      id:            d.id,
      worksiteId:    d.worksiteId,
      urgency:       d.urgency,
      requiredDate:  d.requiredDate,
      justification: d.notes || null,
      items,
    }
    const factory = d.requestType === "repuestos" ? persistRepuestoDraft : persistServiceDraft
    try {
      const reqId = await factory(session, requestInput)

      // Upload pending cotizaciones files
      const maxSizeMb = await getPdfMaxSizeMb()
      const addFn = d.requestType === "repuestos" ? addQuotation : addServiceQuotation
      for (const [key, value] of formData.entries()) {
        if (!key.startsWith("cotizacion_") || !(value instanceof File)) continue
        if (value.size === 0) continue
        if (value.size > maxSizeMb * 1024 * 1024) {
          logger.warn(`[persistDraft] cotización ${value.name} excede tamaño máximo (${maxSizeMb}MB)`)
          continue
        }
        try {
          await addFn({
            requestId: reqId,
            totalAmount: 0,
            supplierId: null,
            supplierNameFree: null,
            notes: null,
            fileName: value.name,
            fileSize: value.size,
            mimeType: value.type,
            fileBuffer: Buffer.from(await value.arrayBuffer()),
            uploadedBy: session.user.id,
          })
        } catch (e) {
          logger.error(`[persistDraft] Error subiendo cotización ${value.name}`, e)
        }
      }

      return { ok: true, message: "Borrador guardado", requestId: reqId }
    } catch (e) {
      logger.error("[persistDraft:quotation]", e)
      return { ok: false, message: e instanceof Error ? e.message : "Error al guardar la solicitud" }
    }
  }

  // ── Original branch: epp / otro ────────────────────────────────────────────
  // A-01/A-08: delegate to a diff-based persist so editing a draft
  // doesn't wipe approved items' audit trail.
  let requestId = d.id

  try {
    const result = await persistRequestWithDiff(
      session.user.id,
      session.user.email ?? undefined,
      d,
      isEdit,
      session.user.permissions.includes("requests:view_all"),
    )
    requestId = result.requestId
  } catch (e) {
    logger.error("[persistDraft]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al guardar la solicitud" }
  }

  return { ok: true, message: "Borrador guardado", requestId }
}

// ── Submit for approval ───────────────────────────────────────────────────────

export async function submitRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireAuth() }
  catch { return { ok: false, message: "Debes iniciar sesión para enviar solicitudes" } }

  let requestId = formData.get("requestId") as string
  // Persistir siempre el contenido actual del formulario antes de enviar:
  // usar solo requestId enviaría la última versión guardada y descartaría
  // las ediciones hechas después del último guardado o autosave.
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

  // MISS-06: bloquear ítems de catálogo que fueron desactivados
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

  // ── Quotation branch: delegate submit to factory ───────────────────────────
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

    // S-05: notify AFTER the submit factory succeeded (no in-flight rollback
    // can invalidate the email). notifyManyUser is fire-and-forget so it
    // never blocks the user-facing redirect.
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
    redirect(`${REVALIDATE}/${requestId}`)
  }

  const now = new Date().toISOString()

  try {
    await db.transaction(async (tx) => {
      // Transition the request to submitted
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

  // S-05: notify only after the transaction has committed. notifyManyUser
  // is fire-and-forget so it never blocks the user-facing redirect.
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
  redirect(`${REVALIDATE}/${requestId}`)
}

// ── Duplicate a request ────────────────────────────────────────────────────────

export async function duplicateRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("requests:create") }
  catch { return { ok: false, message: "Sin permisos para duplicar solicitudes" } }

  const sourceId = formData.get("requestId") as string
  if (!sourceId) return { ok: false, message: "ID de solicitud requerido" }

  const source = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, sourceId),
    with: { items: { with: { attributes: true } } },
  })
  if (!source) return { ok: false, message: "Solicitud no encontrada" }

  const isOwner  = source.requesterId === session.user.id
  const hasViewAll = session.user.permissions.includes("requests:view_all")
  if (!isOwner && !hasViewAll) {
    return { ok: false, message: "Solo puedes duplicar tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, source.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de la solicitud original" }
  }

  let newId!: string
  await db.transaction(async (tx) => {
    const code = await nextCodeTx(tx, "SOL")
    newId = nanoid()

    await tx.insert(purchaseRequests).values({
      id:           newId,
      code,
      worksiteId:   source.worksiteId,
      requesterId:  session.user.id,
      requestType:  source.requestType,
      urgency:      source.urgency,
      requiredDate: source.requiredDate ?? source.items.find((item) => item.requiredDate)?.requiredDate ?? null,
      status:       "draft",
      notes:        source.notes ? `[Duplicada de ${source.code}] ${source.notes}` : `[Duplicada de ${source.code}]`,
    })

    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "create",
      entityType: "purchase_request",
      entityId:   newId,
      entityCode: code,
      newState:   { status: "draft", duplicatedFrom: sourceId, worksiteId: source.worksiteId },
    }, tx)

    for (const [i, item] of source.items.entries()) {
      const itemId = nanoid()
      await tx.insert(purchaseRequestItems).values({
        id:                  itemId,
        requestId:           newId,
        productId:           item.productId ?? null,
        productNameFree:     item.productNameFree ?? null,
        quantity:            item.quantity,
        unitOfMeasure:       item.unitOfMeasure,
        status:              "draft",
        urgency:             item.urgency,
        requiredDate:        source.requiredDate ?? item.requiredDate ?? null,
        workerId:            null,
        suggestedSupplierId: item.suggestedSupplierId ?? null,
        supplierHint:        item.supplierHint ?? null,
        sortOrder:           i,
        notes:               item.notes ?? null,
      })

      if (item.attributes.length > 0) {
        await tx.insert(requestItemAttributes).values(
          item.attributes.map((a) => ({
            id:            nanoid(),
            requestItemId: itemId,
            attributeId:   a.attributeId ?? null,
            attributeName: a.attributeName,
            value:         a.value,
          })),
        )
      }
    }
  })

  revalidatePath(REVALIDATE)
  redirect(`${REVALIDATE}/${newId!}`)
}

// ── Cancel a draft ────────────────────────────────────────────────────────────

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

// ── Re-submit a single returned item (returned → requested) ──────────────────

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
    revalidatePath(`${REVALIDATE}/${row.requestId}`)
    return { ok: true, message: "Ítem re-enviado a aprobación" }
  } catch (e) {
    logger.error("[resubmitReturnedItemAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al re-enviar ítem" }
  }
}

// ── Delete a request (hard delete, non-approved statuses) ─────────────────────

export async function deleteRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("requests:view_own") }
  catch { return { ok: false, message: "Sin permisos" } }

  const requestId = formData.get("requestId") as string
  if (!requestId) return { ok: false, message: "ID requerido" }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }

  // Owner puede eliminar sus propias; requests:delete permite eliminar cualquiera
  const isOwner = request.requesterId === session.user.id
  const canDeleteAny = can(session, "requests:delete")
  if (!isOwner && !canDeleteAny) {
    return { ok: false, message: "Solo puedes eliminar tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }
  // R-25: Status check now happens inside deleteRequest's transaction (TOCTOU fix).
  // No duplicate check here.

  try {
    await deleteRequest(requestId, session.user.id, { userEmail: session.user.email ?? undefined })
  } catch (e) {
    logger.error("[deleteRequestAction]", e)
    return { ok: false, message: "Error al eliminar la solicitud" }
  }

  revalidatePath(REVALIDATE)
  return { ok: true, message: "Solicitud eliminada correctamente" }
}
