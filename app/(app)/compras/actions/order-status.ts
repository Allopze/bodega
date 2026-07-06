"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { purchaseOrderItems, purchaseOrders, suppliers, worksites } from "@/db/schema"
import { count, eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { issueOrder, markOrderSent, confirmOrder } from "@/lib/services/purchasing"
import { getUserIdsWithPermission, notifyManyUser, notifyAfterCommit } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import type { ActionState } from "@/lib/validation/operations"
import { assertOrderAccess } from "../actions.helpers"
import { dbErrMsg, serviceWorksiteScope } from "./helpers"
import { REVALIDATE } from "./revalidate"

// ── Issue OC (draft → issued) ─────────────────────────────────────────────────

export async function issueOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:create_order")
  } catch {
    return { ok: false, message: "Sin permisos" }
  }

  const orderId = formData.get("orderId") as string | null
  if (!orderId) return { ok: false, message: "Orden no especificada" }
  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  try {
    await issueOrder(orderId, session.user.id, serviceWorksiteScope(session), {
      userEmail: session.user.email ?? undefined,
    })
  } catch (e) {
    logger.error("[issueOrderAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al emitir orden") }
  }
  redirect(`/compras/${orderId}?actualizada=emitida`)
}

// ── Mark as sent (issued → sent) ──────────────────────────────────────────────

export async function sendOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:send_order")
  } catch {
    return { ok: false, message: "Sin permisos para enviar órdenes" }
  }

  const orderId = formData.get("orderId") as string | null
  if (!orderId) return { ok: false, message: "Orden no especificada" }
  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  // Pull the order summary BEFORE markOrderSent so we can build the
  // notification body, and so we can fire the notification after the
  // status change has actually committed (S-05).
  const [[orderSummary], [itemCountRow]] = await Promise.all([
    db
      .select({
        code: purchaseOrders.code,
        worksiteName: worksites.name,
        supplierName: suppliers.name,
      })
      .from(purchaseOrders)
      .innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id))
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(eq(purchaseOrders.id, orderId)),
    db
      .select({ n: count() })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId)),
  ])

  try {
    await markOrderSent(orderId, session.user.id, serviceWorksiteScope(session), {
      userEmail: session.user.email ?? undefined,
    })
  } catch (e) {
    logger.error("[sendOrderAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al enviar orden") }
  }

  // S-05: notify only after the status change has committed.
  notifyAfterCommit(() => {
    const code = orderSummary?.code ?? "Orden enviada"
    const worksiteName = orderSummary?.worksiteName ?? "Faena"
    const itemCount = itemCountRow?.n ?? 0
    const supplierTag = orderSummary?.supplierName ? ` ${orderSummary.supplierName}` : ""
    return getUserIdsWithPermission("receiving:register_office").then((receiverIds) =>
      notifyManyUser(receiverIds, {
        type: "oc_sent",
        title: `OC lista para recepción: ${code}`,
        body: `${worksiteName} · ${itemCount} ítem${itemCount === 1 ? "" : "s"} enviado${itemCount === 1 ? "" : "s"} al proveedor${supplierTag}.`,
        entityType: "purchase_order",
        entityId: orderId,
        entityHref: `/recepcion/nueva?oc=${orderId}`,
      }),
    )
  })

  redirect(`/compras/${orderId}?actualizada=enviada`)
}

// ── Confirm order (sent → supplier_confirmed) ─────────────────────────────────

export async function confirmOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:create_order")
  } catch {
    return { ok: false, message: "Sin permisos" }
  }

  const orderId = formData.get("orderId") as string | null
  if (!orderId) return { ok: false, message: "Orden no especificada" }
  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  try {
    await confirmOrder(orderId, session.user.id, serviceWorksiteScope(session), {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`/compras/${orderId}`)
    return { ok: true, message: "Orden confirmada por proveedor" }
  } catch (e) {
    logger.error("[confirmOrderAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al confirmar orden") }
  }
}
