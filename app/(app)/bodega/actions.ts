"use server"

import { revalidatePath }    from "next/cache"
import { db } from "@/db"
import { deliveryItems, purchaseRequestItems, purchaseRequests, worksiteStock } from "@/db/schema"
import { eq } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { registerWorksiteDelivery } from "@/lib/services/deliveries"
import { applyMovement } from "@/lib/services/stock"
import { dispatchSchema, setMinStockSchema, returnStockSchema, type ActionState }  from "@/lib/validation/operations"
import { logger } from "@/lib/logger"

const REVALIDATE = "/bodega"

// ── Dispatch from worksite stock to worker ───────────────────────────────────

export async function dispatchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:register_movement") }
  catch { return { ok: false, message: "Sin permisos para registrar movimientos" } }

  const parsed = dispatchSchema.safeParse({
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

  const { worksiteId, productId, quantity: qty, unitOfMeasure: unit, receiverName: receiver, notes } = parsed.data
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

// ── Set minStock threshold ───────────────────────────────────────────────────

export async function setMinStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:register_movement") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = setMinStockSchema.safeParse({
    stockId:  formData.get("stockId"),
    minStock: formData.get("minStock"),
  })

  if (!parsed.success) {
    return { ok: false, message: "Valor inválido" }
  }

  const { stockId, minStock } = parsed.data

  try {
    const stockRow = await db.query.worksiteStock.findFirst({ where: eq(worksiteStock.id, stockId) })
    if (!stockRow) return { ok: false, message: "Stock no encontrado" }
    if (!canAccessWorksite(session, stockRow.worksiteId)) {
      return { ok: false, message: "No tienes acceso a esta faena" }
    }

    await db.update(worksiteStock).set({ minStock }).where(eq(worksiteStock.id, stockId))
    revalidatePath(REVALIDATE)
    return { ok: true, message: `Stock mínimo actualizado a ${minStock}` }
  } catch (e) {
    logger.error("[setMinStockAction]", e)
    return { ok: false, message: "Error al actualizar stock mínimo" }
  }
}

// ── Return stock to worksite ─────────────────────────────────────────────────

export async function returnStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:register_movement") }
  catch { return { ok: false, message: "Sin permisos para registrar movimientos" } }

  const parsed = returnStockSchema.safeParse({
    worksiteId: formData.get("worksiteId"),
    productId:  formData.get("productId"),
    quantity:   formData.get("quantity"),
    reason:     formData.get("reason"),
    notes:      formData.get("notes"),
  })

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los datos de la devolución",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { worksiteId, productId, quantity, reason, notes } = parsed.data

  if (!canAccessWorksite(session, worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta faena" }
  }

  try {
    await applyMovement({
      worksiteId,
      productId,
      type: "ingreso_devolucion",
      quantity,
      referenceType: "return",
      performedBy: session.user.id,
      userEmail: session.user.email ?? undefined,
      reason,
      notes: notes || undefined,
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: `Devolución registrada: ${quantity} unidades` }
  } catch (e) {
    logger.error("[returnStockAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar devolución" }
  }
}
