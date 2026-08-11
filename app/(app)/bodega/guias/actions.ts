"use server"

import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import {
  cancelDispatchGuide,
  confirmDispatchGuideReceipt,
  createDispatchGuide,
  dispatchDispatchGuide,
  prepareAdditionalDispatchGuideForOfficeReceipt,
  updateDispatchGuide,
} from "@/lib/services/dispatch-guides"
import {
  cancelDispatchGuideSchema,
  dispatchGuideInputSchema,
  receiveDispatchGuideSchema,
} from "@/lib/validation/dispatch-guides"
import type { ActionState } from "@/lib/validation/operations"

const GUIDES_PATH = "/bodega/guias"

function revalidateGuideViews(guideId?: string) {
  revalidateOperationalViews([
    GUIDES_PATH,
    ...(guideId ? [`${GUIDES_PATH}/${guideId}`] : []),
    "/recepcion",
    "/compras",
    "/solicitudes",
    "/bodega",
    "/trazabilidad",
  ])
}

/**
 * Parsea el formulario de la guía.
 *
 * El **origen no se lee del formulario**: lo fija el backend. Aunque alguien
 * añadiera un campo `originWorksiteId` a la petición, aquí no existe y el
 * servicio lo resolvería igual desde la bodega de la oficina.
 */
function parseGuideForm(formData: FormData) {
  let itemsRaw: unknown = []
  try {
    itemsRaw = JSON.parse(String(formData.get("itemsJson") ?? "[]"))
  } catch {
    logger.warn("[dispatch-guides] itemsJson inválido, se usará arreglo vacío")
  }

  return dispatchGuideInputSchema.safeParse({
    destinationWorksiteId: formData.get("destinationWorksiteId"),
    dispatcherWorkerId:    formData.get("dispatcherWorkerId"),
    receiverWorkerId:      formData.get("receiverWorkerId"),
    vehicleId:             formData.get("vehicleId"),
    driverWorkerId:        formData.get("driverWorkerId"),
    notes:                 formData.get("notes"),
    items:                 itemsRaw,
  })
}

function fieldErrorState(parsed: { error: { flatten: () => { fieldErrors: unknown } } }): ActionState {
  return {
    ok: false,
    message: "Revisa los datos de la guía",
    fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
  }
}

export async function createGuideAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:create_guide") }
  catch { return { ok: false, message: "Sin permisos para crear guías de despacho" } }

  const parsed = parseGuideForm(formData)
  if (!parsed.success) return fieldErrorState(parsed)

  let created: { id: string; code: string }
  try {
    created = await createDispatchGuide(
      parsed.data,
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
      serviceWorksiteScope(session),
    )
  } catch (error) {
    logger.error("[createGuideAction]", error)
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo crear la guía" }
  }

  revalidateGuideViews(created.id)
  // Fuera del try: `redirect` señaliza lanzando y no debe confundirse con un error.
  redirect(`${GUIDES_PATH}/${created.id}?creada=1`)
}

export async function updateGuideAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:create_guide") }
  catch { return { ok: false, message: "Sin permisos para editar guías de despacho" } }

  const guideId = String(formData.get("guideId") ?? "")
  if (!guideId) return { ok: false, message: "Guía no indicada" }

  const parsed = parseGuideForm(formData)
  if (!parsed.success) return fieldErrorState(parsed)

  try {
    await updateDispatchGuide(
      guideId,
      parsed.data,
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
      serviceWorksiteScope(session),
    )
  } catch (error) {
    logger.error("[updateGuideAction]", error)
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo guardar la guía" }
  }

  revalidateGuideViews(guideId)
  redirect(`${GUIDES_PATH}/${guideId}?actualizada=1`)
}

export async function dispatchGuideAction(guideId: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:dispatch_guide") }
  catch { return { ok: false, message: "Sin permisos para despachar guías" } }

  try {
    const result = await dispatchDispatchGuide(
      guideId,
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
      serviceWorksiteScope(session),
    )
    revalidateGuideViews(guideId)
    return { ok: true, message: `Guía ${result.code} despachada. Se registraron ${result.movements} movimientos de bodega.` }
  } catch (error) {
    logger.error("[dispatchGuideAction]", error)
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo despachar la guía" }
  }
}

/** Prepara el saldo de una recepción para un segundo despacho parcial. */
export async function prepareAdditionalGuideAction(receiptId: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:create_guide") }
  catch { return { ok: false, message: "Sin permisos para preparar guías de despacho" } }
  if (!receiptId?.trim()) return { ok: false, message: "Recepción no indicada" }

  try {
    const result = await prepareAdditionalDispatchGuideForOfficeReceipt(
      receiptId,
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
      serviceWorksiteScope(session),
    )
    revalidateGuideViews(result.id)
    return { ok: true, message: `Guía ${result.code} preparada.`, data: { guideId: result.id } }
  } catch (error) {
    logger.error("[prepareAdditionalGuideAction]", error)
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo preparar el despacho" }
  }
}

export async function receiveGuideAction(
  guideId: string,
  receivedByWorkerId?: string | null,
  items?: Array<{ guideItemId: string; quantityReceived: number; differenceReason?: string | null }>,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:receive_guide") }
  catch { return { ok: false, message: "Sin permisos para confirmar recepciones" } }

  const parsed = receiveDispatchGuideSchema.safeParse({
    guideId,
    receivedByWorkerId: receivedByWorkerId ?? "",
    items,
  })
  if (!parsed.success) return { ok: false, message: "Revisa los datos de la recepción" }

  try {
    const result = await confirmDispatchGuideReceipt(
      parsed.data.guideId,
      { receivedByWorkerId: parsed.data.receivedByWorkerId, items: parsed.data.items },
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
      serviceWorksiteScope(session),
    )
    revalidateGuideViews(guideId)
    return { ok: true, message: `Recepción de la guía ${result.code} confirmada.` }
  } catch (error) {
    logger.error("[receiveGuideAction]", error)
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo confirmar la recepción" }
  }
}

export async function cancelGuideAction(guideId: string, reason: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:cancel_guide") }
  catch { return { ok: false, message: "Sin permisos para anular guías" } }

  const parsed = cancelDispatchGuideSchema.safeParse({ guideId, reason })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa el motivo de la anulación" }
  }

  try {
    const result = await cancelDispatchGuide(
      parsed.data.guideId,
      { reason: parsed.data.reason },
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
      serviceWorksiteScope(session),
    )
    revalidateGuideViews(guideId)
    return {
      ok: true,
      message: result.reversedMovements > 0
        ? `Guía ${result.code} anulada. Se revirtieron ${result.reversedMovements} movimientos de bodega.`
        : `Guía ${result.code} anulada.`,
    }
  } catch (error) {
    logger.error("[cancelGuideAction]", error)
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo anular la guía" }
  }
}
