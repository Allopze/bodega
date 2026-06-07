"use server"

import { revalidatePath }    from "next/cache"
import { db } from "@/db"
import { deliveryItems, purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { eq } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { applyMovement }     from "@/lib/services/warehouse"
import { registerWorksiteDelivery } from "@/lib/services/deliveries"
import type { ActionState }  from "@/lib/validation/operations"

const REVALIDATE = "/bodega"

// ── Dispatch from warehouse to faena ─────────────────────────────────────────

export async function dispatchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:register_movement") }
  catch { return { ok: false, message: "Sin permisos para registrar movimientos" } }

  const warehouseId = formData.get("warehouseId") as string | null
  const worksiteId  = formData.get("worksiteId")  as string | null
  const productId   = formData.get("productId")   as string | null
  const requestItemId = (formData.get("requestItemId") as string | null) || null
  const qtyRaw      = formData.get("quantity")     as string | null
  const unit        = (formData.get("unitOfMeasure") as string | null)?.trim() || "unidad"
  const receiver    = (formData.get("receiverName") as string | null)?.trim()
  const notes       = (formData.get("notes")  as string | null)?.trim()

  if (!warehouseId) return { ok: false, message: "Selecciona una bodega" }
  if (!worksiteId)  return { ok: false, message: "Selecciona una faena" }
  if (!productId)   return { ok: false, message: "Selecciona un producto" }
  if (!receiver)    return { ok: false, message: "Indica quién recibió" }

  const qty = parseFloat(qtyRaw ?? "0")
  if (isNaN(qty) || qty <= 0) {
    return { ok: false, message: "La cantidad debe ser mayor a 0" }
  }

  if (!canAccessWorksite(session, worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  if (requestItemId) {
    const item = await db
      .select({
        id: purchaseRequestItems.id,
        productId: purchaseRequestItems.productId,
        quantity: purchaseRequestItems.quantity,
        status: purchaseRequestItems.status,
        worksiteId: purchaseRequests.worksiteId,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(eq(purchaseRequestItems.id, requestItemId))
      .then((rows) => rows[0])

    if (!item) return { ok: false, message: "Ítem de solicitud no encontrado" }
    if (!["received", "partially_delivered"].includes(item.status)) {
      return { ok: false, message: "Solo puedes asociar ítems recibidos pendientes de entrega" }
    }
    if (item.productId !== productId || item.worksiteId !== worksiteId) {
      return { ok: false, message: "El ítem trazable no coincide con el producto o la faena" }
    }

    const previousDeliveries = await db
      .select({ quantity: deliveryItems.quantity })
      .from(deliveryItems)
      .where(eq(deliveryItems.requestItemId, requestItemId))
    const alreadyDelivered = previousDeliveries.reduce((sum, row) => sum + row.quantity, 0)
    const pending = item.quantity - alreadyDelivered
    if (pending <= 0) return { ok: false, message: "El ítem ya fue entregado completamente" }
    if (qty > pending) {
      return { ok: false, message: `La cantidad excede el saldo pendiente de entrega (${pending})` }
    }
  }

  try {
    await registerWorksiteDelivery({
      warehouseId,
      worksiteId,
      productId,
      requestItemId,
      quantity: qty,
      unitOfMeasure: unit,
      receiverName: receiver,
      deliveredBy: session.user.id,
      userEmail: session.user.email ?? undefined,
      notes: notes || null,
    })

    revalidatePath(REVALIDATE)
    revalidatePath("/entregas")
    revalidatePath("/trazabilidad")
    return { ok: true, message: `Entrega registrada: ${qty} unidades` }
  } catch (e) {
    console.error("[dispatchAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar entrega" }
  }
}

// ── Manual stock adjustment ───────────────────────────────────────────────────

export async function adjustStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:adjust_stock") }
  catch { return { ok: false, message: "Sin permisos para ajustar stock" } }

  const warehouseId = formData.get("warehouseId") as string | null
  const productId   = formData.get("productId")   as string | null
  const qtyRaw      = formData.get("quantity")     as string | null
  const type        = formData.get("type")          as string | null
  const reason      = (formData.get("reason") as string | null)?.trim()

  if (!warehouseId) return { ok: false, message: "Selecciona una bodega" }
  if (!productId)   return { ok: false, message: "Selecciona un producto" }
  if (!reason)      return { ok: false, message: "El motivo es obligatorio para ajustes" }

  const qty = parseFloat(qtyRaw ?? "0")
  if (isNaN(qty) || qty <= 0) {
    return { ok: false, message: "La cantidad debe ser mayor a 0" }
  }

  const movType = type === "ajuste_negativo" ? "ajuste_negativo" : "ajuste_positivo"
  const signedQty = movType === "ajuste_negativo" ? -qty : qty

  try {
    await applyMovement({
      warehouseId,
      productId,
      type:        movType,
      quantity:    signedQty,
      referenceType: "manual_adjustment",
      performedBy: session.user.id,
      userEmail:   session.user.email ?? undefined,
      reason,
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: "Ajuste registrado" }
  } catch (e) {
    console.error("[adjustStockAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al ajustar stock" }
  }
}
