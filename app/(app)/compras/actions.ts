"use server"

import { redirect }     from "next/navigation"
import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { purchaseOrderItems, purchaseOrders, purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { eq } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { createOrder, issueOrder, markOrderSent, cancelOrder } from "@/lib/services/purchasing"
import { postponeItem } from "@/lib/services/item-state"
import { createOrderSchema, type ActionState } from "@/lib/validation/operations"

const REVALIDATE = "/compras"

// ── Create OC ─────────────────────────────────────────────────────────────────

export async function createOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:create_order") }
  catch { return { ok: false, message: "Sin permisos para crear órdenes de compra" } }

  let itemsRaw: unknown[] = []
  try {
    itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]")
  } catch {
    return { ok: false, message: "Error al procesar los ítems", fieldErrors: { items: ["Formato de ítems inválido"] } }
  }

  const parsed = createOrderSchema.safeParse({
    worksiteId:        formData.get("worksiteId"),
    supplierId:        formData.get("supplierId"),
    paymentTerms:      formData.get("paymentTerms"),
    estimatedDelivery: formData.get("estimatedDelivery"),
    deliveryAddress:   formData.get("deliveryAddress"),
    notes:             formData.get("notes"),
    items:             itemsRaw,
  })

  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    return {
      ok: false,
      message: "Revisa los datos de la orden",
      fieldErrors: {
        ...flattened.fieldErrors,
        items: flattened.fieldErrors.items ?? flattened.formErrors,
      },
    }
  }

  const {
    worksiteId,
    supplierId,
    paymentTerms,
    estimatedDelivery,
    deliveryAddress,
    notes,
    items,
  } = parsed.data

  if (!canAccessWorksite(session, worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  const itemIds = [...new Set(items.map((item) => item.requestItemId).filter(Boolean))]
  if (itemIds.length !== items.length) {
    return { ok: false, message: "Hay ítems duplicados o inválidos en la orden" }
  }

  const dbItems = await db.query.purchaseRequestItems.findMany({
    where: (item, { inArray }) => inArray(item.id, itemIds),
    with:  { request: true },
  })
  if (dbItems.length !== items.length) {
    return { ok: false, message: "Uno o más ítems ya no están disponibles para compra" }
  }

  const dbItemMap = new Map(dbItems.map((item) => [item.id, item]))

  for (const item of items) {
    const dbItem = dbItemMap.get(item.requestItemId)
    if (!dbItem || !["approved", "pending_purchase"].includes(dbItem.status)) {
      return { ok: false, message: "Solo se pueden comprar ítems aprobados pendientes" }
    }
    if (dbItem.request.worksiteId !== worksiteId || !canAccessWorksite(session, dbItem.request.worksiteId)) {
      return { ok: false, message: "La orden contiene ítems de una faena no autorizada" }
    }
    if (item.quantity !== dbItem.quantity) {
      return { ok: false, message: "La cantidad de compra debe coincidir con la cantidad aprobada" }
    }
  }

  try {
    const orderId = await createOrder({
      worksiteId,
      supplierId,
      createdBy:          session.user.id,
      userEmail:          session.user.email ?? undefined,
      paymentTerms:       paymentTerms || null,
      estimatedDelivery:  estimatedDelivery || null,
      deliveryAddress:    deliveryAddress || null,
      notes:              notes || null,
      items: items.map((item, i) => ({
        requestItemId:   item.requestItemId,
        productId:       item.productId ?? null,
        productNameFree: item.productNameFree ?? null,
        quantity:        item.quantity,
        unitOfMeasure:   item.unitOfMeasure,
        unitPrice:       item.unitPrice,
        discount:        item.discount ?? 0,
        notes:           item.notes ?? null,
        sortOrder:       i,
      })),
    })

    revalidatePath(REVALIDATE)
    redirect(`/compras/${orderId}`)
  } catch (e) {
    if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e
    console.error("[createOrderAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al crear la orden" }
  }
}

// ── Issue OC (draft → issued) ─────────────────────────────────────────────────

export async function issueOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:create_order") }
  catch { return { ok: false, message: "Sin permisos" } }

  const orderId = formData.get("orderId") as string | null
  if (!orderId) return { ok: false, message: "Orden no especificada" }
  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  try {
    await issueOrder(orderId, session.user.id, {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`/compras/${orderId}`)
    return { ok: true, message: "Orden emitida" }
  } catch (e) {
    console.error("[issueOrderAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al emitir orden" }
  }
}

// ── Mark as sent (issued → sent) ──────────────────────────────────────────────

export async function sendOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:send_order") }
  catch { return { ok: false, message: "Sin permisos para enviar órdenes" } }

  const orderId = formData.get("orderId") as string | null
  if (!orderId) return { ok: false, message: "Orden no especificada" }
  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  try {
    await markOrderSent(orderId, session.user.id, {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`/compras/${orderId}`)
    return { ok: true, message: "Orden marcada como enviada al proveedor" }
  } catch (e) {
    console.error("[sendOrderAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al enviar orden" }
  }
}

async function assertOrderAccess(session: Awaited<ReturnType<typeof requirePermission>>, orderId: string): Promise<ActionState | null> {
  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, orderId),
  })
  if (!order) return { ok: false, message: "Orden no encontrada" }
  if (!canAccessWorksite(session, order.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta orden" }
  }
  return null
}

// ── Postpone item ─────────────────────────────────────────────────────────────

export async function postponeItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:create_order") }
  catch { return { ok: false, message: "Sin permisos" } }

  const itemId = formData.get("itemId") as string | null
  const reason = (formData.get("reason") as string | null)?.trim()

  if (!itemId) return { ok: false, message: "Ítem no especificado" }
  if (!reason) return { ok: false, message: "El motivo de postergación es obligatorio" }

  const item = await db
    .select({
      id: purchaseRequestItems.id,
      status: purchaseRequestItems.status,
      worksiteId: purchaseRequests.worksiteId,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(eq(purchaseRequestItems.id, itemId))
    .then((rows) => rows[0])

  if (!item) return { ok: false, message: "Ítem no encontrado" }
  if (!["approved", "pending_purchase"].includes(item.status)) {
    return { ok: false, message: "Solo se pueden postergar ítems aprobados pendientes de compra" }
  }
  if (!canAccessWorksite(session, item.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de este ítem" }
  }

  const orderLink = await db.query.purchaseOrderItems.findFirst({
    where: eq(purchaseOrderItems.requestItemId, itemId),
  })
  if (orderLink) {
    return { ok: false, message: "No se puede postergar un ítem que ya está en una OC" }
  }

  try {
    await postponeItem(itemId, session.user.id, reason, {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Ítem postergado" }
  } catch (e) {
    console.error("[postponeItemAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al postergar ítem" }
  }
}

// ── Cancel Order (draft/issued/sent → cancelled) ──────────────────────────────

export async function cancelOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:create_order") }
  catch { return { ok: false, message: "Sin permisos para anular la orden" } }

  const orderId = formData.get("orderId") as string | null
  const reason = (formData.get("reason") as string | null)?.trim()

  if (!orderId) return { ok: false, message: "Orden no especificada" }
  if (!reason) return { ok: false, message: "El motivo de anulación es obligatorio" }

  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  try {
    await cancelOrder(orderId, session.user.id, reason, {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`/compras/${orderId}`)
    return { ok: true, message: "Orden de compra anulada correctamente" }
  } catch (e) {
    console.error("[cancelOrderAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al anular orden" }
  }
}
