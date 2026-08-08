"use server"

import { redirect } from "next/navigation"
import { db } from "@/db"
import { purchaseOrderItems, purchaseOrders, suppliers, worksites } from "@/db/schema"
import { count, eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { issueAndSendOrder } from "@/lib/services/purchasing"
import { getUserIdsWithPermission, notifyManyUser, notifyAfterCommit } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import type { ActionState } from "@/lib/validation/operations"
import { assertOrderAccess } from "../actions.helpers"
import { dbErrMsg } from "./helpers"
import { REVALIDATE } from "./revalidate"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { pluralize } from "@/lib/utils"

// ── Emitir y enviar (draft → sent) ────────────────────────────────────────────
// Fusión 2026-08-07: antes eran `issueOrderAction` (draft → issued) y
// `sendOrderAction` (issued → sent). El compromiso con el proveedor es lo que
// exige `purchasing:send_order`, así que ese es el permiso de la acción fusionada.

export async function issueAndSendOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:send_order")
  } catch {
    return { ok: false, message: "Sin permisos para emitir y enviar órdenes" }
  }

  const orderId = formData.get("orderId") as string | null
  if (!orderId) return { ok: false, message: "Orden no especificada" }
  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  // Pull the order summary BEFORE the transition so we can build the
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
    await issueAndSendOrder(orderId, session.user.id, serviceWorksiteScope(session), {
      userEmail: session.user.email ?? undefined,
    })
  } catch (e) {
    logger.error("[issueAndSendOrderAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al emitir y enviar la orden") }
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
        body: `${worksiteName} · ${pluralize(itemCount, "ítem")} ${pluralize(itemCount, "enviado", "enviados")} al proveedor${supplierTag}.`,
        entityType: "purchase_order",
        entityId: orderId,
        entityHref: `/recepcion/nueva?oc=${orderId}`,
      }),
    )
  })

  revalidateOperationalViews([REVALIDATE, `/compras/${orderId}`, "/recepcion"])
  redirect(`/compras/${orderId}?actualizada=enviada`)
}
