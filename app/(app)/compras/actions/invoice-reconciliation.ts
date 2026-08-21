"use server"

import { can, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { acceptPurchaseOrderInvoiceReconciliation } from "@/lib/services/purchasing-module/invoice-reconciliation-service"
import type { ActionState } from "@/lib/validation/operations"
import { dbErrMsg } from "./helpers"
import { REVALIDATE } from "./revalidate"

export async function acceptInvoiceReconciliationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:send_order")
  } catch {
    return { ok: false, message: "Sin permisos para aceptar diferencias de facturación" }
  }

  const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "").trim()
  const fingerprint = String(formData.get("fingerprint") ?? "").trim()
  const reason = String(formData.get("reason") ?? "").trim()
  if (!purchaseOrderId || !fingerprint) return { ok: false, message: "La conciliación ya no está disponible" }
  if (reason.length < 10 || reason.length > 1000) {
    return { ok: false, message: "El motivo debe tener entre 10 y 1000 caracteres", fieldErrors: { reason: ["Escribe un motivo de 10 a 1000 caracteres"] } }
  }

  const pendingCosts = formData.getAll("pendingCostSelection").map((value) => {
    const [purchaseOrderItemId, invoiceItemId] = String(value).split(":")
    return { purchaseOrderItemId: purchaseOrderItemId ?? "", invoiceItemId: invoiceItemId ?? "" }
  }).filter((selection) => selection.purchaseOrderItemId && selection.invoiceItemId)
  const catalogInvoiceItemIds = formData.getAll("catalogInvoiceItemId").map(String).filter(Boolean)

  try {
    const result = await acceptPurchaseOrderInvoiceReconciliation({
      purchaseOrderId,
      fingerprint,
      reason,
      pendingCosts,
      catalogInvoiceItemIds,
      canUpdateCatalog: can(session, "admin:products"),
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      worksiteScope: serviceWorksiteScope(session),
    })
    revalidateOperationalViews([REVALIDATE, `/compras/${purchaseOrderId}`, "/trazabilidad"])
    return {
      ok: true,
      message: result.status === "matched"
        ? "Costos registrados y conciliación completada."
        : "Diferencias aceptadas para la evidencia actual.",
    }
  } catch (error) {
    logger.error("[acceptInvoiceReconciliationAction]", error)
    return { ok: false, message: dbErrMsg(error, "No se pudieron aceptar las diferencias") }
  }
}
