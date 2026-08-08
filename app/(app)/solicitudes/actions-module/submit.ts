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
import { persistDraft } from "./draft"
import { parseRequestForm } from "./parse-request-form"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"

const REVALIDATE = "/solicitudes"

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
      return await createAndSubmit(session, data)
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
    return { ok: false, message: e instanceof Error ? e.message : "Error al enviar la solicitud" }
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
): Promise<ActionState> {
  const inactiveError = await assertProductsActive(data.items.map((item) => item.productId))
  if (inactiveError) return inactiveError

  let created
  try {
    created = await createSubmittedRequest(session.user.id, session.user.email ?? undefined, data)
  } catch (e) {
    logger.error("[submitRequest:create]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al crear la solicitud" }
  }

  notifyApprovers({
    requestId: created.requestId,
    code:      created.code,
    itemCount: data.items.length,
    actor:     session.user.name ?? session.user.email ?? "Un usuario",
    requestType: data.requestType,
  })

  revalidateOperationalViews([REVALIDATE, `${REVALIDATE}/${created.requestId}`])
  redirect(`${REVALIDATE}/${created.requestId}`)
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
