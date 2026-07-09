"use server"

import { revalidatePath, revalidateTag } from "next/cache"
  revalidateTag("badge-counts", { expire: 0 })
import type { Session } from "next-auth"
import { can, canAccessWorksite, requireAuth } from "@/lib/auth/can"
import { requestSchema, type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"
import { isRequestType, permissionForRequestType, QUOTATION_TYPES } from "@/lib/request-types"
import { addQuotation, persistRepuestoDraft } from "@/lib/services/repuestos"
import { addServiceQuotation, persistServiceDraft } from "@/lib/services/servicios"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { persistRequestWithDiff } from "@/lib/services/requests-draft"

const REVALIDATE = "/solicitudes"

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
  revalidateTag("badge-counts", { expire: 0 })
  return { ok: true, message: "Borrador guardado", requestId: result.requestId, lastSavedAt: new Date().toISOString() }
}

export async function persistDraft(
  session: Session,
  formData: FormData,
): Promise<ActionState & { requestId?: string }> {
  let itemsRaw: unknown[] = []
  try { itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]") } catch {}

  const requestTypeRaw = formData.get("requestType") || "epp"
  if (isRequestType(requestTypeRaw) && !can(session, permissionForRequestType(requestTypeRaw, "create"))) {
    return { ok: false, message: "No tienes permisos para crear este tipo de solicitud" }
  }

  const parsed = requestSchema.safeParse({
    id:           formData.get("id") || undefined,
    worksiteId:   formData.get("worksiteId"),
    requestType:  requestTypeRaw,
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

  const isEdit = !!d.id
  if (!canAccessWorksite(session, d.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  if (QUOTATION_TYPES.has(d.requestType)) {
    const items = d.items.map((item, i) => ({
      id:            item.id,
      description:   item.productNameFree?.trim() || item.productId || "",
      quantity:      item.quantity,
      unitOfMeasure: item.unitOfMeasure,
      sortOrder:     i,
      notes:         item.notes || null,
      partNumber:    item.partNumber || null,
      location:      item.location || null,
      equipmentName: item.equipmentName || null,
      patent:        item.patent || null,
      brand:         item.brand || null,
      model:         item.model || null,
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
