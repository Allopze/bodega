"use server"

import type { Session } from "next-auth"
import { requireAuth } from "@/lib/auth/can"
import { type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"
import { QUOTATION_TYPES } from "@/lib/request-types"
import { addQuotation, persistRepuestoDraft } from "@/lib/services/repuestos"
import { addServiceQuotation, persistServiceDraft } from "@/lib/services/servicios"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { parseRequestForm } from "./parse-request-form"
import { safeActionMessage } from "@/lib/action-error"

const REVALIDATE = "/solicitudes"

/**
 * Borrador de solicitud. Desde 2026-08-07 solo existe para los tipos con
 * cotización (repuestos/servicios), que necesitan adjuntar cotizaciones antes
 * de enviar. EPP/otro se crean y envían en un solo paso (`submitRequest`).
 */
export async function saveDraft(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { requestId?: string; lastSavedAt?: string }> {
  let session
  try { session = await requireAuth() }
  catch { return { ok: false, message: "Debes iniciar sesión para crear solicitudes" } }

  const result = await persistDraft(session, formData)
  if (!result.ok) return result

  revalidateOperationalViews([REVALIDATE, `${REVALIDATE}/${result.requestId}`])
  // Se reenvían `message` y `data` de persistDraft: cuando algún archivo se
  // rechaza, ahí viaja el detalle y la lista `failedFiles`. Reconstruir el
  // estado acá con un "Borrador guardado" fijo se comía ese aviso entero.
  return {
    ok: true,
    message: result.message ?? "Borrador guardado",
    data: result.data,
    requestId: result.requestId,
    lastSavedAt: new Date().toISOString(),
  }
}

export async function persistDraft(
  session: Session,
  formData: FormData,
): Promise<ActionState & { requestId?: string }> {
  const parsed = parseRequestForm(session, formData)
  if (!parsed.ok) return parsed.error
  const d = parsed.data

  if (!QUOTATION_TYPES.has(d.requestType)) {
    return { ok: false, message: "Las solicitudes de EPP y otros se crean y envían en un solo paso" }
  }

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
    deliveryMode:  d.deliveryMode,
    requiredDate:  d.requiredDate,
    justification: d.notes || null,
    items,
  }
  const factory = d.requestType === "repuestos" ? persistRepuestoDraft : persistServiceDraft
  try {
    const reqId = await factory(session, requestInput)

    const maxSizeMb = await getPdfMaxSizeMb()
    const addFn = d.requestType === "repuestos" ? addQuotation : addServiceQuotation
    const failedFiles: string[] = []
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("cotizacion_") || key.startsWith("cotizacion_meta_") || !(value instanceof File)) continue
      if (value.size === 0) continue
      if (value.size > maxSizeMb * 1024 * 1024) {
        logger.warn(`[persistDraft] cotización ${value.name} excede tamaño máximo (${maxSizeMb}MB)`)
        failedFiles.push(value.name)
        continue
      }

      const cotId = key.slice("cotizacion_".length)
      const metaRaw = formData.get(`cotizacion_meta_${cotId}`)
      let meta: { totalAmount?: string; supplierId?: string; supplierNameFree?: string } = {}
      try { meta = metaRaw ? JSON.parse(String(metaRaw)) : {} } catch { /* deja meta vacía, se rechaza abajo */ }

      const totalAmount = Number(meta.totalAmount)
      if (!Number.isFinite(totalAmount) || totalAmount <= 0 || (!meta.supplierId && !meta.supplierNameFree?.trim())) {
        logger.warn(`[persistDraft] cotización ${value.name} sin proveedor o monto válido`)
        failedFiles.push(value.name)
        continue
      }

      // Mismo camino de validación que el upload en vivo del panel — sin
      // esto, cualquier archivo (aunque no fuera un PDF/imagen real) pasaba
      // igual (LOG-9).
      const fileBuf = new Uint8Array(await value.arrayBuffer())
      const validation = validateFileBuffer(fileBuf, value.size, MimeType.QUOTATION)
      if (validation.error) {
        logger.warn(`[persistDraft] cotización ${value.name} rechazada: ${validation.error}`)
        failedFiles.push(value.name)
        continue
      }

      try {
        await addFn({
          requestId: reqId,
          totalAmount,
          supplierId: meta.supplierId || null,
          supplierNameFree: meta.supplierNameFree?.trim() || null,
          notes: null,
          fileName: value.name,
          fileSize: value.size,
          mimeType: value.type,
          fileBuffer: Buffer.from(fileBuf),
          uploadedBy: session.user.id,
        })
      } catch (e) {
        logger.error(`[persistDraft] Error subiendo cotización ${value.name}`, e)
        failedFiles.push(value.name)
      }
    }

    if (failedFiles.length > 0) {
      // `failedFiles` viaja aparte para que el cliente pueda conservar esas
      // cotizaciones en el formulario (antes las vaciaba todas y los archivos
      // rechazados desaparecían sin dejar rastro) y avisar con un toast de
      // error, no de éxito.
      return {
        ok: true,
        requestId: reqId,
        message: `Borrador guardado, pero ${failedFiles.length} archivo(s) no se subieron: ${failedFiles.join(", ")}`,
        data: { failedFiles },
      }
    }

    return { ok: true, message: "Borrador guardado", requestId: reqId }
  } catch (e) {
    logger.error("[persistDraft:quotation]", e)
    return { ok: false, message: safeActionMessage(e, "Error al guardar la solicitud") }
  }
}
