"use server"

import { revalidatePath }    from "next/cache"
import { db } from "@/db"
import { deliveryItems, purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { eq } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { applyMovement }     from "@/lib/services/warehouse"
import { registerWorksiteDelivery } from "@/lib/services/deliveries"
import { dispatchSchema, stockAdjustmentSchema, type ActionState }  from "@/lib/validation/operations"
import { logger } from "@/lib/logger"

const REVALIDATE = "/bodega"

// ── Dispatch from warehouse to faena ─────────────────────────────────────────

export async function dispatchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:register_movement") }
  catch { return { ok: false, message: "Sin permisos para registrar movimientos" } }

  const parsed = dispatchSchema.safeParse({
    warehouseId:   formData.get("warehouseId"),
    worksiteId:    formData.get("worksiteId"),
    productId:     formData.get("productId"),
    requestItemId: formData.get("requestItemId"),
    quantity:      formData.get("quantity"),
    unitOfMeasure: formData.get("unitOfMeasure"),
    receiverName:  formData.get("receiverName"),
    notes:         formData.get("notes"),
  })

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los datos de la entrega",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { warehouseId, worksiteId, productId, quantity: qty, unitOfMeasure: unit, receiverName: receiver, notes } = parsed.data
  const requestItemId = parsed.data.requestItemId || null

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
    logger.error("[dispatchAction]", e)
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

  const parsed = stockAdjustmentSchema.safeParse({
    warehouseId: formData.get("warehouseId"),
    productId:   formData.get("productId"),
    quantity:    formData.get("quantity"),
    type:        formData.get("type"),
    reason:      formData.get("reason"),
  })

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los datos del ajuste",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { warehouseId, productId, quantity: qty, type: movType, reason } = parsed.data
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
    logger.error("[adjustStockAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al ajustar stock" }
  }
}
