"use server"

import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrderInvoices } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { requireDifferentActor } from "@/lib/auth/segregation"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { acceptPurchaseOrderInvoiceReconciliation } from "@/lib/services/purchasing-module/invoice-reconciliation-service"
import type { ActionState } from "@/lib/validation/operations"
import { dbErrMsg } from "./helpers"
import { REVALIDATE } from "./revalidate"
import { invoiceNotVoided } from "@/lib/services/purchasing-module/invoice-scope"

export async function acceptInvoiceReconciliationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  /*
   * FAC-004 (auditoría 2026-09-14), patrón P9: `purchasing:send_order`
   * habilitaba adjuntar la factura y también aprobar su diferencia de monto o
   * de precio, de modo que quien reconoce la obligación de pago aprobaba su
   * propio descuadre. El control que existía —motivo de 10 a 1000 caracteres,
   * huella de la evidencia, auditoría— es de rastro, no de separación.
   */
  let session
  try {
    session = await requirePermission("purchasing:accept_invoice_exception")
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

  /*
   * Y el segundo control: no la acepta quien cargó la evidencia sobre la que se
   * decide. Basta con que **una** de las facturas vinculadas sea suya: la
   * aceptación resuelve el descuadre de la orden completa, no de un documento.
   * Una factura que llegó por integración no tiene actor y no bloquea a nadie.
   */
  const uploaders = await db
    .select({ uploadedBy: purchaseOrderInvoices.uploadedBy })
    .from(purchaseOrderInvoices)
    .where(and(eq(purchaseOrderInvoices.purchaseOrderId, purchaseOrderId), invoiceNotVoided))

  for (const row of uploaders) {
    const segregation = requireDifferentActor(
      { actedByUserId: row.uploadedBy, actorUserId: session.user.id },
      "Aceptar la diferencia de una factura",
    )
    if (!segregation.ok) return { ok: false, message: segregation.message ?? "Sin autorización" }
  }

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
