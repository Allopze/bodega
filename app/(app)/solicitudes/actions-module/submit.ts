"use server"

import { redirect } from "next/navigation"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests, products } from "@/db/schema"
import { can, canAccessWorksite, requireAuth } from "@/lib/auth/can"
import { notifyManyUser, getUserIdsWithPermission, notifyAfterCommit } from "@/lib/services/notifications"
import { type ActionState, type RequestFormData } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"
import { isRequestType, permissionForRequestType, QUOTATION_TYPES, type RequestType } from "@/lib/request-types"
import { submitRepuestoRequest } from "@/lib/services/repuestos"
import { submitServiceRequest } from "@/lib/services/servicios"
import { createSubmittedRequest } from "@/lib/services/requests-draft"
import { EppStockAvailabilityError } from "@/lib/services/epp-stock-availability"
import { EppStockConfirmationError, EPP_STOCK_CONFIRMATION_MAX_LENGTH } from "@/lib/services/epp-stock-confirmation"
import { RequestSubmissionKeyConflictError } from "@/lib/services/requests-draft-create"
import { persistDraft } from "./draft"
import { parseRequestForm } from "./parse-request-form"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { safeActionMessage } from "@/lib/action-error"

const REVALIDATE = "/solicitudes"

type DirectSubmission = {
  submissionKey: string
  confirmationToken?: string
}

/** Validate transport-only fields that are not part of RequestFormData. */
function parseDirectSubmission(formData: FormData): { ok: true; submission: DirectSubmission } | { ok: false; error: ActionState } {
  const rawKey = formData.get("submissionKey")
  if (typeof rawKey !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(rawKey)) {
    return { ok: false, error: { ok: false, message: "No se pudo preparar el envío. Actualiza la página e inténtalo nuevamente." } }
  }
  const rawConfirmation = formData.get("eppStockConfirmation")
  if (rawConfirmation !== null && (typeof rawConfirmation !== "string" || rawConfirmation.length > EPP_STOCK_CONFIRMATION_MAX_LENGTH)) {
    return { ok: false, error: { ok: false, message: "La confirmación de stock no es válida. Solicita una nueva revisión." } }
  }
  return {
    ok: true,
    submission: { submissionKey: rawKey, confirmationToken: typeof rawConfirmation === "string" && rawConfirmation ? rawConfirmation : undefined },
  }
}

/**
 * Notifica a quienes aprueban que hay una solicitud nueva esperando.
 *
 * UX-5: antes notificaba siempre a `approvals:approve`, el permiso de
 * EPP/otro — una solicitud de repuestos/servicios (que se aprueba
 * seleccionando la cotización ganadora, permiso `repuestos:approve` /
 * `servicios:approve`) nunca llegaba a quien de verdad tenía la tarea.
 */
function notifyApprovers(args: {
  requestId: string; code: string; itemCount: number; actor: string; requestType: RequestType
}) {
  notifyAfterCommit(() => getUserIdsWithPermission(permissionForRequestType(args.requestType, "approve")).then((approverIds) =>
    notifyManyUser(approverIds, {
      type:       "request_submitted",
      title:      `Nueva solicitud: ${args.code}`,
      body:       `${args.actor} envió una solicitud con ${args.itemCount} ítem${args.itemCount !== 1 ? "s" : ""}`,
      entityType: "purchase_request",
      entityId:   args.requestId,
      entityHref: `/solicitudes/${args.requestId}`,
    }),
  ))
}

/**
 * Crea la solicitud y la envía a aprobación en un solo paso (EPP/otro).
 *
 * Repuestos y servicios conservan su flujo de dos pasos: se guardan en borrador
 * para adjuntar cotizaciones y se envían después con esta misma acción, que en
 * ese caso recibe un `requestId` existente.
 */
export async function submitRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireAuth() }
  catch { return { ok: false, message: "Debes iniciar sesión para enviar solicitudes" } }

  let requestId = (formData.get("requestId") as string | null) || null

  // ── El formulario viene completo: EPP/otro se crean ya enviadas; los tipos
  //    con cotización guardan aquí su borrador antes de enviarlo, porque el
  //    usuario puede pulsar "Enviar" con cambios sin guardar. ────────────────
  if (formData.get("itemsJson")) {
    const parsed = parseRequestForm(session, formData)
    if (!parsed.ok) return parsed.error
    const data = parsed.data

    if (!QUOTATION_TYPES.has(data.requestType)) {
      const submission = parseDirectSubmission(formData)
      if (!submission.ok) return submission.error
      return await createAndSubmit(session, data, submission.submission)
    }

    if (requestId) formData.set("id", requestId)
    const saved = await persistDraft(session, formData)
    if (!saved.ok) return saved
    requestId = saved.requestId ?? requestId
  }

  if (!requestId) return { ok: false, message: "ID de solicitud requerido" }

  // ── Envío de un borrador existente (repuestos/servicios) ────────────────────
  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
    with:  { items: true },
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (!isRequestType(request.requestType)) return { ok: false, message: "Tipo de solicitud no soportado" }
  if (!QUOTATION_TYPES.has(request.requestType)) {
    return { ok: false, message: "Las solicitudes de EPP y otros se crean y envían en un solo paso" }
  }
  if (!can(session, permissionForRequestType(request.requestType, "submit"))) {
    return { ok: false, message: "Sin permisos para enviar este tipo de solicitud" }
  }
  if (request.items.length === 0) return { ok: false, message: "La solicitud debe tener al menos un ítem" }
  const itemsWithoutDate = request.items.filter((i) => !i.requiredDate)
  if (itemsWithoutDate.length > 0 && !request.requiredDate) {
    return { ok: false, message: "Falta la fecha requerida en ítems y en la solicitud. Define una fecha estimada de necesidad." }
  }
  if (request.requesterId !== session.user.id && !session.user.permissions.includes("requests:view_all")) {
    return { ok: false, message: "Solo puedes enviar tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }

  const inactiveError = await assertProductsActive(request.items.map((item) => item.productId))
  if (inactiveError) return inactiveError

  try {
    const submitFn = request.requestType === "repuestos" ? submitRepuestoRequest : submitServiceRequest
    await submitFn({
      requestId,
      userId:    session.user.id,
      userEmail: session.user.email ?? undefined,
    })
  } catch (e) {
    logger.error("[submitRequest:quotation]", e)
    return { ok: false, message: safeActionMessage(e, "Error al enviar la solicitud") }
  }

  notifyApprovers({
    requestId,
    code:      request.code,
    itemCount: request.items.length,
    actor:     session.user.name ?? session.user.email ?? "Un usuario",
    requestType: request.requestType,
  })

  revalidateOperationalViews([REVALIDATE, `${REVALIDATE}/${requestId}`])
  redirect(`${REVALIDATE}/${requestId}`)
}

/**
 * Crea la solicitud ya enviada a aprobación (EPP/otro) y redirige a su detalle.
 * Nunca retorna: `redirect` lanza, y el tipo de retorno sólo sirve al camino de
 * error.
 */
async function createAndSubmit(
  session: Awaited<ReturnType<typeof requireAuth>>,
  data: RequestFormData,
  submission: DirectSubmission,
): Promise<ActionState> {
  // `parseRequestForm` already checks these at the input boundary. Repeat them
  // immediately before the transactional preflight: actions are public POST
  // endpoints and a user can never use a stale client state as authorization.
  if (!can(session, permissionForRequestType(data.requestType, "create"))) {
    return { ok: false, message: "No tienes permisos para crear este tipo de solicitud" }
  }
  if (!canAccessWorksite(session, data.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  let outcome
  try {
    outcome = await createSubmittedRequest(session.user.id, session.user.email ?? undefined, data, submission)
  } catch (e) {
    logger.error("[submitRequest:create]", e)
    if (e instanceof EppStockAvailabilityError || e instanceof EppStockConfirmationError || e instanceof RequestSubmissionKeyConflictError) {
      return { ok: false, message: e.message }
    }
    return { ok: false, message: safeActionMessage(e, "Error al crear la solicitud") }
  }

  if (outcome.kind === "epp-stock-warning") {
    // This is not an error/toast. The form opens an explicit decision dialog and
    // resubmits only when the requester chooses to continue.
    return {
      ok: true,
      data: {
        kind: "epp-stock-warning",
        confirmationToken: outcome.confirmationToken,
        worksiteName: outcome.worksiteName,
        items: outcome.items,
      },
    }
  }

  if (!outcome.replayed) {
    notifyApprovers({
      requestId: outcome.requestId,
      code:      outcome.code,
      itemCount: data.items.length,
      actor:     session.user.name ?? session.user.email ?? "Un usuario",
      requestType: data.requestType,
    })
  }

  revalidateOperationalViews([REVALIDATE, `${REVALIDATE}/${outcome.requestId}`])
  redirect(`${REVALIDATE}/${outcome.requestId}`)
}

/** Un producto dado de baja no puede entrar a aprobación. */
async function assertProductsActive(productIds: Array<string | null | undefined>): Promise<ActionState | null> {
  const catalogProductIds = productIds.filter((id): id is string => !!id)
  if (catalogProductIds.length === 0) return null

  const inactiveProducts = await db
    .select({ name: products.name })
    .from(products)
    .where(and(inArray(products.id, catalogProductIds), eq(products.isActive, false)))
  if (inactiveProducts.length === 0) return null

  const names = inactiveProducts.map((p) => p.name).join(", ")
  return { ok: false, message: `Los siguientes productos están inactivos y no pueden solicitarse: ${names}` }
}
