"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import {
  persistRepuestoDraft,
  addQuotation,
  deleteQuotation,
  submitRepuestoRequest,
  selectRepuestoQuotation,
  cancelRepuestoRequest,
} from "@/lib/services/repuestos"
import {
  repuestoRequestSchema,
  quotationUploadSchema,
  selectQuotationSchema,
  cancelRepuestoSchema,
  type ActionState,
} from "@/lib/validation/repuestos"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { getUserIdsWithPermission, notifyManyUser, notifySafe } from "@/lib/services/notifications"
import { db } from "@/db"
import { purchaseRequests } from "@/db/schema"
import { eq } from "drizzle-orm"
import { logger } from "@/lib/logger"

const REVALIDATE = "/repuestos"

const ALLOWED_QUOTATION_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
])

// ── Save as draft ─────────────────────────────────────────────────────────────

export async function saveDraftAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { requestId?: string }> {
  let session
  try { session = await requirePermission("repuestos:create") }
  catch { return { ok: false, message: "Sin permisos para crear solicitudes de repuestos" } }

  let itemsRaw: unknown[] = []
  try { itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]") } catch { /* ignore */ }

  const parsed = repuestoRequestSchema.safeParse({
    id:            formData.get("id") || undefined,
    worksiteId:    formData.get("worksiteId"),
    urgency:       formData.get("urgency") || "normal",
    requiredDate:  String(formData.get("requiredDate") ?? ""),
    justification: formData.get("justification") || "",
    items:         itemsRaw,
  })

  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    return {
      ok: false,
      message: "Revisa los datos de la solicitud",
      fieldErrors: flattened.fieldErrors as Record<string, string[]>,
    }
  }
  const d = parsed.data
  if (!canAccessWorksite(session, d.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  try {
    const requestId = await persistRepuestoDraft(session, {
      id:            d.id,
      worksiteId:    d.worksiteId,
      urgency:       d.urgency,
      requiredDate:  d.requiredDate,
      justification: d.justification,
      items:         d.items.map((item, i) => ({
        id:            item.id,
        description:   item.description,
        quantity:      item.quantity,
        unitOfMeasure: item.unitOfMeasure,
        sortOrder:     item.sortOrder ?? i,
        notes:         item.notes,
        partNumber:    item.partNumber,
        equipmentName: item.equipmentName,
        patent:        item.patent,
        brand:         item.brand,
        model:         item.model,
      })),
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Borrador guardado", requestId }
  } catch (e) {
    logger.error("[saveDraftAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al guardar borrador" }
  }
}

// ── Submit request ────────────────────────────────────────────────────────────

export async function submitRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("repuestos:submit") }
  catch { return { ok: false, message: "Sin permisos para enviar solicitudes de repuestos" } }

  const requestId = formData.get("requestId") as string | null
  if (!requestId) return { ok: false, message: "Solicitud no especificada" }

  // Verify access
  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
    columns: { worksiteId: true, requesterId: true },
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta solicitud" }
  }
  if (request.requesterId !== session.user.id) {
    return { ok: false, message: "Solo el solicitante puede enviar la solicitud" }
  }

  try {
    await submitRepuestoRequest({
      requestId,
      userId:    session.user.id,
      userEmail: session.user.email ?? undefined,
    })

    // Notify approvers (fire-and-forget)
    void getUserIdsWithPermission("repuestos:approve").then((approverIds) =>
      notifyManyUser(approverIds, {
        type:       "request_submitted",
        title:      "Nueva solicitud de repuestos pendiente",
        body:       "Hay una solicitud de repuestos con cotizaciones esperando selección.",
        entityType: "purchase_request",
        entityId:   requestId,
        entityHref: `/repuestos/${requestId}`,
      })
    )

    revalidatePath(REVALIDATE)
    redirect(`/repuestos/${requestId}`)
  } catch (e) {
    if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e
    logger.error("[submitRequestAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al enviar solicitud" }
  }
}

// ── Upload quotation ──────────────────────────────────────────────────────────

export async function uploadQuotationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("repuestos:submit") }
  catch { return { ok: false, message: "Sin permisos para agregar cotizaciones" } }

  const file = formData.get("file") as File | null
  if (!file || file.size === 0) return { ok: false, message: "Selecciona un archivo" }

  if (!ALLOWED_QUOTATION_TYPES.has(file.type)) {
    return { ok: false, message: "Solo se permiten archivos PDF, JPG o PNG" }
  }

  const maxMb = await getPdfMaxSizeMb()
  if (file.size > maxMb * 1024 * 1024) {
    return { ok: false, message: `El archivo supera el tamaño máximo de ${maxMb} MB` }
  }

  const parsed = quotationUploadSchema.safeParse({
    requestId:        formData.get("requestId"),
    totalAmount:      formData.get("totalAmount"),
    supplierId:       formData.get("supplierId") || undefined,
    supplierNameFree: formData.get("supplierNameFree") || "",
    notes:            formData.get("notes") || "",
  })

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los datos de la cotización",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  const d = parsed.data

  // Verify access to the request
  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, d.requestId),
    columns: { worksiteId: true, requesterId: true },
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta solicitud" }
  }
  if (request.requesterId !== session.user.id) {
    return { ok: false, message: "Solo el solicitante puede agregar cotizaciones" }
  }

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    await addQuotation({
      requestId:        d.requestId,
      totalAmount:      d.totalAmount,
      supplierId:       d.supplierId ?? null,
      supplierNameFree: d.supplierNameFree ?? null,
      notes:            d.notes ?? null,
      fileBuffer,
      fileName:         file.name,
      mimeType:         file.type,
      fileSize:         file.size,
      uploadedBy:       session.user.id,
      userEmail:        session.user.email ?? undefined,
    })
    revalidatePath(`/repuestos/${d.requestId}`)
    return { ok: true, message: "Cotización agregada" }
  } catch (e) {
    logger.error("[uploadQuotationAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al subir cotización" }
  }
}

// ── Delete quotation ──────────────────────────────────────────────────────────

export async function deleteQuotationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("repuestos:submit") }
  catch { return { ok: false, message: "Sin permisos para eliminar cotizaciones" } }

  const quotationId = formData.get("quotationId") as string | null
  const requestId   = formData.get("requestId") as string | null
  if (!quotationId || !requestId) return { ok: false, message: "Datos incompletos" }

  try {
    await deleteQuotation({
      quotationId,
      userId:    session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(`/repuestos/${requestId}`)
    return { ok: true, message: "Cotización eliminada" }
  } catch (e) {
    logger.error("[deleteQuotationAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al eliminar cotización" }
  }
}

// ── Select quotation (jefa approves) ─────────────────────────────────────────

export async function selectQuotationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("repuestos:approve") }
  catch { return { ok: false, message: "Sin permisos para aprobar cotizaciones" } }

  const parsed = selectQuotationSchema.safeParse({
    requestId:   formData.get("requestId"),
    quotationId: formData.get("quotationId"),
  })
  if (!parsed.success) {
    return { ok: false, message: "Datos incompletos" }
  }
  const d = parsed.data

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, d.requestId),
    columns: { worksiteId: true, requesterId: true, code: true },
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta solicitud" }
  }

  const roleContext =
    session.user.roles.includes("administrador") ? "admin" :
    session.user.roles.includes("jefa_chome")    ? "jefa_chome" :
    session.user.roles[0] ?? "unknown"

  try {
    await selectRepuestoQuotation({
      requestId:   d.requestId,
      quotationId: d.quotationId,
      userId:      session.user.id,
      userEmail:   session.user.email ?? undefined,
      roleContext,
    })

    // Notify requester (fire-and-forget)
    void notifySafe({
      userId:     request.requesterId,
      type:       "request_approved",
      title:      `Cotización aprobada en ${request.code}`,
      body:       `La jefatura seleccionó la cotización ganadora. Los ítems han sido aprobados y están listos para orden de compra.`,
      entityType: "purchase_request",
      entityId:   d.requestId,
      entityHref: `/repuestos/${d.requestId}`,
    })

    revalidatePath(`/repuestos/${d.requestId}`)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Cotización aprobada. Ítems listos para orden de compra." }
  } catch (e) {
    logger.error("[selectQuotationAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al seleccionar cotización" }
  }
}

// ── Cancel request ────────────────────────────────────────────────────────────

export async function cancelRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("repuestos:submit") }
  catch { return { ok: false, message: "Sin permisos para cancelar solicitudes" } }

  const parsed = cancelRepuestoSchema.safeParse({
    requestId: formData.get("requestId"),
    reason:    formData.get("reason"),
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: "Proporciona un motivo de cancelación",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  const d = parsed.data

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, d.requestId),
    columns: { worksiteId: true, requesterId: true },
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta solicitud" }
  }
  if (request.requesterId !== session.user.id) {
    return { ok: false, message: "Solo el solicitante puede cancelar la solicitud" }
  }

  try {
    await cancelRepuestoRequest(d.requestId, session.user.id, d.reason, {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    redirect(REVALIDATE)
  } catch (e) {
    if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e
    logger.error("[cancelRequestAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al cancelar solicitud" }
  }
}
