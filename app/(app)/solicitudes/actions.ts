"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, requestItemAttributes,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { submitItemTx } from "@/lib/services/item-state"
import { notifyManyUser, getUserIdsWithPermission } from "@/lib/services/notifications"
import { requestSchema, type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"
import { QUOTATION_TYPES } from "@/lib/request-types"
import {
  persistRepuestoDraft, submitRepuestoRequest,
  addQuotation, deleteQuotation,
} from "@/lib/services/repuestos"
import {
  persistServiceDraft, submitServiceRequest,
  addServiceQuotation, deleteServiceQuotation,
} from "@/lib/services/servicios"
import { quotationUploadSchema } from "@/lib/validation/repuestos"
import { serviceQuotationUploadSchema } from "@/lib/validation/servicios"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import type { RequestInput, RequestItemInput } from "@/lib/requests/request-service"

const REVALIDATE = "/solicitudes"

// ── Quotation-type helpers ────────────────────────────────────────────────────

type FormItemParsed = {
  id?: string
  productId?: string | null
  productNameFree?: string | null
  quantity: number
  unitOfMeasure: string
  notes?: string | null
  attributes: { attributeId?: string | null; attributeName: string; value: string }[]
}

function itemsToRequestInput(items: FormItemParsed[], requestType: string): RequestItemInput[] {
  const isService = requestType === "servicios"
  return items.map((item, i) => {
    const findAttr = (name: string) =>
      item.attributes.find((a) => a.attributeName === name)?.value?.trim() || null
    return {
      id:            item.id,
      description:   item.productNameFree?.trim() || item.productId || "",
      quantity:      item.quantity,
      unitOfMeasure: item.unitOfMeasure,
      sortOrder:     i,
      notes:         item.notes || null,
      partNumber:    isService ? null : findAttr("N° de Parte"),
      location:      isService ? findAttr("Ubicación") : null,
      equipmentName: findAttr("Equipo"),
      patent:        findAttr("Patente/Código"),
      brand:         findAttr("Marca"),
      model:         findAttr("Modelo"),
    }
  })
}

// ── Save as draft ─────────────────────────────────────────────────────────────

export async function saveDraft(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { requestId?: string }> {
  let session
  try { session = await requirePermission("requests:create") }
  catch { return { ok: false, message: "Sin permisos para crear solicitudes" } }

  const result = await persistDraft(session, formData)
  if (!result.ok) return result

  revalidatePath(REVALIDATE)
  // El cliente adopta el id para que guardados posteriores (manuales o
  // automáticos) actualicen este borrador en vez de crear duplicados.
  return { ok: true, message: "Borrador guardado", requestId: result.requestId }
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

  if (!canAccessWorksite(session, d.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  // ── Quotation branch: delegate to factory (repuestos / servicios) ──────────
  if (QUOTATION_TYPES.has(d.requestType)) {
    const requestInput: RequestInput = {
      id:            d.id,
      worksiteId:    d.worksiteId,
      urgency:       d.urgency,
      requiredDate:  d.requiredDate,
      justification: d.notes || null,
      items:         itemsToRequestInput(d.items, d.requestType),
    }
    const factory = d.requestType === "repuestos" ? persistRepuestoDraft : persistServiceDraft
    try {
      const requestId = await factory(session, requestInput)
      return { ok: true, message: "Borrador guardado", requestId }
    } catch (e) {
      logger.error("[persistDraft:quotation]", e)
      return { ok: false, message: e instanceof Error ? e.message : "Error al guardar la solicitud" }
    }
  }

  // ── Original branch: epp / otro (SOL prefix) ──────────────────────────────
  const isEdit = !!d.id
  let requestId = d.id
 
  try {
    await db.transaction(async (tx) => {
    if (isEdit) {
      // Verify ownership — solicitantes can only edit their own drafts
      const existing = await tx.query.purchaseRequests.findFirst({
        where: eq(purchaseRequests.id, d.id!),
      })
      if (!existing) throw new Error("Solicitud no encontrada")
      if (!["draft", "returned"].includes(existing.status)) throw new Error("Solo se pueden editar solicitudes en borrador o devueltas")
      if (existing.requesterId !== session.user.id && !session.user.permissions.includes("requests:view_all")) {
        throw new Error("Solo puedes editar tus propias solicitudes")
      }

      await tx.update(purchaseRequests).set({
        worksiteId:   d.worksiteId,
        requestType:  d.requestType,
        urgency:      d.urgency,
        requiredDate: d.requiredDate,
        status:       "draft",
        notes:        d.notes || null,
        updatedAt:    new Date().toISOString(),
      }).where(eq(purchaseRequests.id, d.id!))
      requestId = d.id

      // Replace all items (delete + re-insert)
      await tx.delete(purchaseRequestItems).where(eq(purchaseRequestItems.requestId, d.id!))
    } else {
      const code = await nextCodeTx(tx, "SOL")
      const reqId = nanoid()
      requestId = reqId

      await tx.insert(purchaseRequests).values({
        id:           reqId,
        code,
        worksiteId:   d.worksiteId,
        requesterId:  session.user.id,
        requestType:  d.requestType,
        urgency:      d.urgency,
        requiredDate: d.requiredDate,
        status:       "draft",
        notes:        d.notes || null,
      })

      await recordAudit({
        userId:     session.user.id,
        userEmail:  session.user.email ?? undefined,
        action:     "create",
        entityType: "purchase_request",
        entityId:   reqId,
        entityCode: code,
        newState:   { status: "draft", worksiteId: d.worksiteId },
      }, tx)
    }

    // Insert items
    for (const [i, item] of d.items.entries()) {
      const itemId = item.id ?? nanoid()
      await tx.insert(purchaseRequestItems).values({
        id:                  itemId,
        requestId:           requestId!,
        productId:           item.productId || null,
        productNameFree:     item.productNameFree?.trim() || null,
        quantity:            item.quantity,
        unitOfMeasure:       item.unitOfMeasure,
        status:              "draft",
        urgency:             item.urgency,
        requiredDate:        d.requiredDate,
        workerId:            null,
        suggestedSupplierId: item.suggestedSupplierId || null,
        supplierHint:        item.supplierHint || null,
        sortOrder:           i,
        notes:               item.notes || null,
      })

      if (item.attributes.length > 0) {
        await tx.insert(requestItemAttributes).values(
          item.attributes.map((a) => ({
            id:            nanoid(),
            requestItemId: itemId,
            attributeId:   a.attributeId || null,
            attributeName: a.attributeName,
            value:         a.value,
          })),
        )
      }
    }
    })
  } catch (e) {
    logger.error("[persistDraft]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al guardar la solicitud" }
  }

  return { ok: true, message: "Borrador guardado", requestId }
}

// ── Submit for approval ───────────────────────────────────────────────────────

export async function submitRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("requests:submit") }
  catch { return { ok: false, message: "Sin permisos para enviar solicitudes" } }

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
  if (request.status !== "draft") return { ok: false, message: "Solo se pueden enviar solicitudes en borrador" }
  if (request.items.length === 0) return { ok: false, message: "La solicitud debe tener al menos un ítem" }
  if (request.requesterId !== session.user.id && !session.user.permissions.includes("requests:view_all")) {
    return { ok: false, message: "Solo puedes enviar tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
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

    // Notify approvers (fire-and-forget)
    void getUserIdsWithPermission("approvals:approve").then((approverIds) =>
      notifyManyUser(approverIds, {
        type:       "request_submitted",
        title:      `Nueva solicitud: ${request.code}`,
        body:       `${session.user.name ?? session.user.email} envió una solicitud con ${request.items.length} ítem${request.items.length !== 1 ? "s" : ""}`,
        entityType: "purchase_request",
        entityId:   requestId,
        entityHref: `/solicitudes/${requestId}`,
      }),
    )

    revalidatePath(REVALIDATE)
    redirect(`${REVALIDATE}/${requestId}`)
  }

  // ── Original branch: epp / otro ────────────────────────────────────────────
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

  // Notify approvers (fire-and-forget — never blocks the main flow)
  void getUserIdsWithPermission("approvals:approve").then((approverIds) =>
    notifyManyUser(approverIds, {
      type:       "request_submitted",
      title:      `Nueva solicitud: ${request.code}`,
      body:       `${session.user.name ?? session.user.email} envió una solicitud con ${request.items.length} ítem${request.items.length !== 1 ? "s" : ""}`,
      entityType: "purchase_request",
      entityId:   requestId,
      entityHref: `/solicitudes/${requestId}`,
    }),
  )

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

// ── Unified quotation actions (for repuestos/servicios) ─────────────────────

export async function uploadQuotationUnifiedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("requests:submit")
  } catch {
    return { ok: false, message: "Sin permisos para agregar cotizaciones" }
  }

  const requestId = formData.get("requestId") as string
  const requestType = formData.get("requestType") as string
  if (!requestId || !requestType) {
    return { ok: false, message: "ID de solicitud y tipo requeridos" }
  }
  if (!QUOTATION_TYPES.has(requestType)) {
    return { ok: false, message: "Tipo de solicitud no soporta cotizaciones" }
  }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (request.requesterId !== session.user.id && !session.user.permissions.includes("requests:view_all")) {
    return { ok: false, message: "Solo puedes agregar cotizaciones a tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta solicitud" }
  }

  const file = formData.get("file") as File | null
  if (!file) return { ok: false, message: "Archivo requerido" }

  const maxSizeMb = await getPdfMaxSizeMb()
  if (file.size > maxSizeMb * 1024 * 1024) {
    return { ok: false, message: `El archivo excede el tamaño máximo de ${maxSizeMb}MB` }
  }

  const schema = requestType === "repuestos" ? quotationUploadSchema : serviceQuotationUploadSchema
  const parsed = schema.safeParse({
    totalAmount: formData.get("totalAmount"),
    supplierNameFree: formData.get("supplierNameFree"),
    notes: formData.get("notes"),
  })
  if (!parsed.success) {
    return { ok: false, message: "Datos de cotización inválidos" }
  }

  const data = parsed.data
  const quotationInput = {
    requestId,
    totalAmount: data.totalAmount,
    supplierId: null,
    supplierNameFree: data.supplierNameFree ?? null,
    notes: data.notes ?? null,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    fileBuffer: Buffer.from(await file.arrayBuffer()),
    uploadedBy: session.user.id,
  }

  try {
    if (requestType === "repuestos") {
      await addQuotation(quotationInput)
    } else {
      await addServiceQuotation(quotationInput)
    }
    revalidatePath(`${REVALIDATE}/${requestId}`)
    return { ok: true, message: "Cotización agregada" }
  } catch (e) {
    logger.error("[uploadQuotationUnified]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al subir cotización" }
  }
}

export async function deleteQuotationUnifiedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("requests:submit")
  } catch {
    return { ok: false, message: "Sin permisos para eliminar cotizaciones" }
  }

  const quotationId = formData.get("quotationId") as string
  const requestId = formData.get("requestId") as string
  const requestType = formData.get("requestType") as string
  if (!quotationId || !requestId || !requestType) {
    return { ok: false, message: "Datos incompletos" }
  }
  if (!QUOTATION_TYPES.has(requestType)) {
    return { ok: false, message: "Tipo de solicitud no soporta cotizaciones" }
  }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (request.requesterId !== session.user.id && !session.user.permissions.includes("requests:view_all")) {
    return { ok: false, message: "Solo puedes eliminar cotizaciones de tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta solicitud" }
  }

  try {
    if (requestType === "repuestos") {
      await deleteQuotation({ quotationId, userId: session.user.id })
    } else {
      await deleteServiceQuotation({ quotationId, userId: session.user.id })
    }
    revalidatePath(`${REVALIDATE}/${requestId}`)
    return { ok: true, message: "Cotización eliminada" }
  } catch (e) {
    logger.error("[deleteQuotationUnified]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al eliminar cotización" }
  }
}
