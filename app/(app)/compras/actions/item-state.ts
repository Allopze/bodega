"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { purchaseOrderItems, purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { eq } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { markItemPendingPurchase, postponeItem } from "@/lib/services/item-state"
import { logger } from "@/lib/logger"
import type { ActionState } from "@/lib/validation/operations"
import { dbErrMsg, REVALIDATE } from "./helpers"

// ── Postpone item ─────────────────────────────────────────────────────────────

export async function postponeItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:create_order")
  } catch {
    return { ok: false, message: "Sin permisos" }
  }

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
    logger.error("[postponeItemAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al postergar ítem") }
  }
}

// ── Resume postponed item ───────────────────────────────────────────────────

export async function resumeItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:create_order")
  } catch {
    return { ok: false, message: "Sin permisos" }
  }

  const itemId = formData.get("itemId") as string | null
  if (!itemId) return { ok: false, message: "Ítem no especificado" }

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
  if (item.status !== "postponed") {
    return { ok: false, message: "Solo se pueden reanudar ítems postergados" }
  }
  if (!canAccessWorksite(session, item.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de este ítem" }
  }

  try {
    await markItemPendingPurchase(itemId, session.user.id, {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    revalidatePath("/compras/nueva")
    revalidatePath("/trazabilidad")
    return { ok: true, message: "Ítem reanudado para compra" }
  } catch (e) {
    logger.error("[resumeItemAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al reanudar ítem") }
  }
}
