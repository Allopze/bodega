/**
 * Workflow actions (quotation upload/delete/select) — extracted from the
 * shared request actions factory.
 *
 * ARQ-1: este archivo también tenía `submitRequestActionImpl` y
 * `cancelRequestActionImpl`, sin ningún consumidor en la UI — el envío y la
 * cancelación de verdad viven en `app/(app)/solicitudes/actions-module/
 * {submit,cancel}.ts`. Las dos implementaciones ya habían divergido (LOG-3);
 * se borraron en vez de mantenerlas sincronizadas a mano.
 */
import { revalidatePath } from "next/cache"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { safeActionMessage } from "@/lib/action-error"
import { eq } from "drizzle-orm"

import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { db } from "@/db"
import { purchaseRequests } from "@/db/schema"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { notifySafe } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import type { ActionState } from "@/lib/validation/masters"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import type { RequestActionsConfig } from "./request-actions.types"

// ── Upload quotation ─────────────────────────────────────────────────────────

export async function uploadQuotationActionImpl(
  config: RequestActionsConfig,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { permissions, schemas, services, routePrefix, logPrefix } = config
  let session
  try { session = await requirePermission(permissions.submit) }
  catch { return { ok: false, message: "Sin permisos para agregar cotizaciones" } }

  const file = formData.get("file") as File | null
  if (!file || file.size === 0) return { ok: false, message: "Selecciona un archivo" }

  const maxMb = await getPdfMaxSizeMb()
  if (file.size > maxMb * 1024 * 1024) {
    return { ok: false, message: `El archivo supera el tamaño máximo de ${maxMb} MB` }
  }

  // Read once, validate magic bytes, then use the same buffer for storage
  const fileBuf = new Uint8Array(await file.arrayBuffer())
  const validation = validateFileBuffer(fileBuf, file.size, MimeType.QUOTATION)
  if (validation.error) {
    return { ok: false, message: validation.error }
  }

  const parsed = schemas.quotationUpload.safeParse({
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
    await services.addQuotation({
      requestId:        d.requestId,
      totalAmount:      d.totalAmount,
      supplierId:       d.supplierId ?? null,
      supplierNameFree: d.supplierNameFree ?? null,
      notes:            d.notes ?? null,
      fileBuffer:       fileBuf as unknown as Buffer,
      fileName:         file.name,
      mimeType:         validation.mimeType,
      fileSize:         file.size,
      uploadedBy:       session.user.id,
      userEmail:        session.user.email ?? undefined,
    })
    revalidatePath(`${routePrefix}/${d.requestId}`)
    return { ok: true, message: "Cotización agregada" }
  } catch (e) {
    logger.error(`[${logPrefix}/uploadQuotationAction]`, e)
    return { ok: false, message: safeActionMessage(e, "Error al subir cotización") }
  }
}

// ── Delete quotation ─────────────────────────────────────────────────────────

export async function deleteQuotationActionImpl(
  config: RequestActionsConfig,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { permissions, services, routePrefix, logPrefix } = config
  let session
  try { session = await requirePermission(permissions.submit) }
  catch { return { ok: false, message: "Sin permisos para eliminar cotizaciones" } }

  const quotationId = formData.get("quotationId") as string | null
  const requestId   = formData.get("requestId") as string | null
  if (!quotationId || !requestId) return { ok: false, message: "Datos incompletos" }

  try {
    await services.deleteQuotation({
      quotationId,
      expectedRequestId: requestId,
      session,
      elevatedPermission: permissions.approve,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(`${routePrefix}/${requestId}`)
    return { ok: true, message: "Cotización eliminada" }
  } catch (e) {
    logger.error(`[${logPrefix}/deleteQuotationAction]`, e)
    return { ok: false, message: safeActionMessage(e, "Error al eliminar cotización") }
  }
}

// ── Select quotation (jefa approves) ─────────────────────────────────────────

export async function selectQuotationActionImpl(
  config: RequestActionsConfig,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { permissions, schemas, services, routePrefix, logPrefix } = config
  let session
  try { session = await requirePermission(permissions.approve) }
  catch { return { ok: false, message: "Sin permisos para aprobar cotizaciones" } }

  const parsed = schemas.selectQuotation.safeParse({
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

  const roleContext = session.user.roles[0] ?? "unknown"

  try {
    await services.selectQuotation({
      requestId:   d.requestId,
      quotationId: d.quotationId,
      userId:      session.user.id,
      userEmail:   session.user.email ?? undefined,
      roleContext,
      worksiteIds: isGlobalRole(session) ? "all" : visibleWorksiteIds(session),
    })

    // Notify requester (fire-and-forget)
    void notifySafe({
      userId:     request.requesterId,
      type:       "request_approved",
      title:      `Cotización aprobada en ${request.code}`,
      body:       `La jefatura seleccionó la cotización ganadora. Los ítems han sido aprobados y están listos para orden de compra.`,
      entityType: "purchase_request",
      entityId:   d.requestId,
      entityHref: `${routePrefix}/${d.requestId}`,
    })

    // Adjudicar deja los ítems `approved`, es decir: trabajo nuevo para Compras
    // y una tarea menos en la cola. Sin esto, el comprador no veía el ítem en
    // /compras/nueva hasta que otra mutación cualquiera revalidara.
    revalidateOperationalViews([
      `${routePrefix}/${d.requestId}`,
      routePrefix,
      "/solicitudes",
      `/solicitudes/${d.requestId}`,
      "/compras",
      "/compras/nueva",
    ])
    return { ok: true, message: "Cotización aprobada. Ítems listos para orden de compra." }
  } catch (e) {
    logger.error(`[${logPrefix}/selectQuotationAction]`, e)
    return { ok: false, message: safeActionMessage(e, "Error al seleccionar cotización") }
  }
}
