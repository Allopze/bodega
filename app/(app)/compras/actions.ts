"use server"

import { redirect }     from "next/navigation"
import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { eq } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { createOrder, issueOrder, markOrderSent } from "@/lib/services/purchasing"
import { postponeItem } from "@/lib/services/item-state"
import type { ActionState } from "@/lib/validation/operations"

const REVALIDATE = "/compras"

// ── Create OC ─────────────────────────────────────────────────────────────────

export async function createOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:create_order") }
  catch { return { ok: false, message: "Sin permisos para crear órdenes de compra" } }

  const worksiteId        = formData.get("worksiteId") as string | null
  const supplierId        = formData.get("supplierId") as string | null
  const paymentTerms      = formData.get("paymentTerms") as string | null
  const estimatedDelivery = formData.get("estimatedDelivery") as string | null
  const deliveryAddress   = formData.get("deliveryAddress") as string | null
  const notes             = formData.get("notes") as string | null

  if (!worksiteId) return { ok: false, message: "Selecciona una faena" }
  if (!supplierId) return { ok: false, message: "Selecciona un proveedor" }
  if (!canAccessWorksite(session, worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  // Items JSON: [{requestItemId, productId, productNameFree, quantity, unitOfMeasure, unitPrice, discount, notes}]
  let itemsRaw: unknown[] = []
  try {
    itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]")
  } catch {
    return { ok: false, message: "Error al procesar los ítems" }
  }

  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    return { ok: false, message: "Selecciona al menos un ítem para la orden" }
  }

  type RawItem = {
    requestItemId: string
    productId: string | null
    productNameFree: string | null
    quantity: number
    unitOfMeasure: string
    unitPrice: number
    discount?: number
    notes?: string
  }

  const items = itemsRaw as RawItem[]
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

  // Validate unit prices
  for (const item of items) {
    if (isNaN(item.unitPrice) || item.unitPrice < 0) {
      return { ok: false, message: `Precio unitario inválido en un ítem` }
    }
    if ((item.discount ?? 0) < 0 || (item.discount ?? 0) > 100) {
      return { ok: false, message: "El descuento debe estar entre 0 y 100" }
    }
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
        productId:       item.productId,
        productNameFree: item.productNameFree,
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
