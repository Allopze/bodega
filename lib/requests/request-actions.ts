/**
 * Shared request actions — factory que elimina la duplicación entre
 * las Server Actions de repuestos y servicios.
 *
 * Uso: cada módulo crea una instancia con su config y re-exporta las funciones.
 *
 *   const actions = createRequestActions(repuestoActionsConfig)
 *   export const saveDraftAction = actions.saveDraftAction
 *   // ...
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle dynamic table types are too complex for proper typing here */

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import type { z } from "zod"

import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { db } from "@/db"
import { purchaseRequests } from "@/db/schema"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { getUserIdsWithPermission, notifyManyUser, notifySafe } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import type { ActionState } from "@/lib/validation/masters"
import type { Permission } from "@/modules/permissions"
import type { Session } from "next-auth"

// ── Config type ───────────────────────────────────────────────────────────────

export interface RequestActionsConfig {
  /** Module identifier used to derive permissions and routes */
  moduleName: "repuestos" | "servicios"
  /** Permission strings for each operation */
  permissions: {
    create: Permission
    submit: Permission
    approve: Permission
  }
  /** Base path for revalidation and redirects */
  routePrefix: string
  /** Zod schemas for each action (use `as any` in the wrappers for inference) */
  schemas: {
    request: z.ZodType<any>
    quotationUpload: z.ZodType<any>
    selectQuotation: z.ZodType<any>
    cancel: z.ZodType<any>
  }
  /** Service functions (already bound to the correct module config) */
  services: {
    persistDraft: (session: Session, data: any) => Promise<string>
    addQuotation: (input: any) => Promise<string>
    deleteQuotation: (input: any) => Promise<void>
    submitRequest: (input: any) => Promise<void>
    selectQuotation: (input: any) => Promise<void>
    cancelRequest: (id: string, userId: string, reason: string, opts?: { userEmail?: string }) => Promise<void>
  }
  /** Maps form items to the input shape expected by the service */
  itemMapper: (item: any, index: number) => Record<string, any>
  /** Log prefix (e.g. "repuestos") */
  logPrefix: string
}

const ALLOWED_QUOTATION_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
])

// ── Factory ───────────────────────────────────────────────────────────────────

export function createRequestActions(config: RequestActionsConfig) {
  const { moduleName, permissions, routePrefix, schemas, services, itemMapper, logPrefix } = config
  const REVALIDATE = routePrefix

  // ── Save as draft ─────────────────────────────────────────────────────────

  async function saveDraftAction(
    _prev: ActionState,
    formData: FormData,
  ): Promise<ActionState & { requestId?: string }> {
    let session
    try { session = await requirePermission(permissions.create) }
    catch { return { ok: false, message: `Sin permisos para crear solicitudes de ${moduleName === "repuestos" ? "repuestos" : "servicios"}` } }

    let itemsRaw: unknown[] = []
    try { itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]") } catch { /* ignore */ }

    const parsed = schemas.request.safeParse({
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
  const d = parsed.data as any
    if (!canAccessWorksite(session, d.worksiteId)) {
      return { ok: false, message: "No tienes acceso a la faena seleccionada" }
    }

    try {
      const requestId = await services.persistDraft(session, {
        id:            d.id,
        worksiteId:    d.worksiteId,
        urgency:       d.urgency,
        requiredDate:  d.requiredDate,
        justification: d.justification,
        items:         d.items.map(itemMapper),
      })
      revalidatePath(REVALIDATE)
      return { ok: true, message: "Borrador guardado", requestId }
    } catch (e) {
      logger.error(`[${logPrefix}/saveDraftAction]`, e)
      return { ok: false, message: e instanceof Error ? e.message : "Error al guardar borrador" }
    }
  }

  // ── Submit request ────────────────────────────────────────────────────────

  async function submitRequestAction(
    _prev: ActionState,
    formData: FormData,
  ): Promise<ActionState> {
    let session
    try { session = await requirePermission(permissions.submit) }
    catch { return { ok: false, message: `Sin permisos para enviar solicitudes de ${moduleName === "repuestos" ? "repuestos" : "servicios"}` } }

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
      await services.submitRequest({
        requestId,
        userId:    session.user.id,
        userEmail: session.user.email ?? undefined,
      })

      // Notify approvers (fire-and-forget)
      void getUserIdsWithPermission(permissions.approve).then((approverIds) =>
        notifyManyUser(approverIds, {
          type:       "request_submitted",
          title:      `Nueva solicitud de ${moduleName === "repuestos" ? "repuestos" : "servicios"} pendiente`,
          body:       `Hay una solicitud de ${moduleName === "repuestos" ? "repuestos con cotizaciones" : "servicios externos con cotizaciones"} esperando selección.`,
          entityType: "purchase_request",
          entityId:   requestId,
          entityHref: `${routePrefix}/${requestId}`,
        })
      )

      revalidatePath(REVALIDATE)
      redirect(`${routePrefix}/${requestId}`)
    } catch (e) {
      if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e
      logger.error(`[${logPrefix}/submitRequestAction]`, e)
      return { ok: false, message: e instanceof Error ? e.message : "Error al enviar solicitud" }
    }
  }

  // ── Upload quotation ──────────────────────────────────────────────────────

  async function uploadQuotationAction(
    _prev: ActionState,
    formData: FormData,
  ): Promise<ActionState> {
    let session
    try { session = await requirePermission(permissions.submit) }
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
  const d = parsed.data as any

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
      await services.addQuotation({
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
      revalidatePath(`${routePrefix}/${d.requestId}`)
      return { ok: true, message: "Cotización agregada" }
    } catch (e) {
      logger.error(`[${logPrefix}/uploadQuotationAction]`, e)
      return { ok: false, message: e instanceof Error ? e.message : "Error al subir cotización" }
    }
  }

  // ── Delete quotation ──────────────────────────────────────────────────────

  async function deleteQuotationAction(
    _prev: ActionState,
    formData: FormData,
  ): Promise<ActionState> {
    let session
    try { session = await requirePermission(permissions.submit) }
    catch { return { ok: false, message: "Sin permisos para eliminar cotizaciones" } }

    const quotationId = formData.get("quotationId") as string | null
    const requestId   = formData.get("requestId") as string | null
    if (!quotationId || !requestId) return { ok: false, message: "Datos incompletos" }

    try {
      await services.deleteQuotation({
        quotationId,
        userId:    session.user.id,
        userEmail: session.user.email ?? undefined,
      })
      revalidatePath(`${routePrefix}/${requestId}`)
      return { ok: true, message: "Cotización eliminada" }
    } catch (e) {
      logger.error(`[${logPrefix}/deleteQuotationAction]`, e)
      return { ok: false, message: e instanceof Error ? e.message : "Error al eliminar cotización" }
    }
  }

  // ── Select quotation (jefa approves) ─────────────────────────────────────

  async function selectQuotationAction(
    _prev: ActionState,
    formData: FormData,
  ): Promise<ActionState> {
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
    const d = parsed.data as any

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
      await services.selectQuotation({
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
        entityHref: `${routePrefix}/${d.requestId}`,
      })

      revalidatePath(`${routePrefix}/${d.requestId}`)
      revalidatePath(REVALIDATE)
      return { ok: true, message: "Cotización aprobada. Ítems listos para orden de compra." }
    } catch (e) {
      logger.error(`[${logPrefix}/selectQuotationAction]`, e)
      return { ok: false, message: e instanceof Error ? e.message : "Error al seleccionar cotización" }
    }
  }

  // ── Cancel request ────────────────────────────────────────────────────────

  async function cancelRequestAction(
    _prev: ActionState,
    formData: FormData,
  ): Promise<ActionState> {
    let session
    try { session = await requirePermission(permissions.submit) }
    catch { return { ok: false, message: "Sin permisos para cancelar solicitudes" } }

    const parsed = schemas.cancel.safeParse({
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
const d = parsed.data as any

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
      await services.cancelRequest(d.requestId, session.user.id, d.reason, {
        userEmail: session.user.email ?? undefined,
      })
      revalidatePath(REVALIDATE)
      redirect(REVALIDATE)
    } catch (e) {
      if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e
      logger.error(`[${logPrefix}/cancelRequestAction]`, e)
      return { ok: false, message: e instanceof Error ? e.message : "Error al cancelar solicitud" }
    }
  }

  return {
    saveDraftAction,
    submitRequestAction,
    uploadQuotationAction,
    deleteQuotationAction,
    selectQuotationAction,
    cancelRequestAction,
  }
}
