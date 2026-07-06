"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { cancelOrder, closeOrder, deleteOrder, isOrderDeletable } from "@/lib/services/purchasing"
import { logger } from "@/lib/logger"
import type { ActionState } from "@/lib/validation/operations"
import { assertOrderAccess } from "../actions.helpers"
import { dbErrMsg, serviceWorksiteScope, REVALIDATE } from "./helpers"

// ── Close order (supplier_confirmed/partially_received/received → closed) ─────

export async function closeOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:create_order")
  } catch {
    return { ok: false, message: "Sin permisos para cerrar la orden" }
  }

  const orderId = formData.get("orderId") as string | null
  const reason = (formData.get("reason") as string | null)?.trim()

  if (!orderId) return { ok: false, message: "Orden no especificada" }
  if (!reason) return { ok: false, message: "El motivo de cierre es obligatorio" }

  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  try {
    await closeOrder(orderId, session.user.id, reason, serviceWorksiteScope(session), {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`/compras/${orderId}`)
    return { ok: true, message: "Orden de compra cerrada" }
  } catch (e) {
    logger.error("[closeOrderAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al cerrar orden") }
  }
}

// ── Cancel Order (draft/issued/sent → cancelled) ──────────────────────────────

export async function cancelOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:create_order")
  } catch {
    return { ok: false, message: "Sin permisos para anular la orden" }
  }

  const orderId = formData.get("orderId") as string | null
  const reason = (formData.get("reason") as string | null)?.trim()

  if (!orderId) return { ok: false, message: "Orden no especificada" }
  if (!reason) return { ok: false, message: "El motivo de anulación es obligatorio" }

  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  try {
    await cancelOrder(orderId, session.user.id, reason, serviceWorksiteScope(session), {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`/compras/${orderId}`)
    return { ok: true, message: "Orden de compra anulada correctamente" }
  } catch (e) {
    logger.error("[cancelOrderAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al anular orden") }
  }
}

// ── Delete Order (hard delete: draft/issued/sent) ─────────────────────────────

export async function deleteOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:delete_order")
  } catch {
    return { ok: false, message: "Sin permisos para eliminar la orden" }
  }

  const orderId = formData.get("orderId") as string | null
  if (!orderId) return { ok: false, message: "Orden no especificada" }

  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, orderId),
    columns: { status: true },
  })
  if (!order) return { ok: false, message: "Orden no encontrada" }
  if (!isOrderDeletable(order.status)) {
    return { ok: false, message: `No se puede eliminar una orden en estado '${order.status}'` }
  }

  try {
    await deleteOrder(orderId, session.user.id, serviceWorksiteScope(session), {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Orden de compra eliminada correctamente" }
  } catch (e) {
    logger.error("[deleteOrderAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al eliminar orden") }
  }
}
