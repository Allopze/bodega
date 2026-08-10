"use server"

import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { recordOrderItemCost } from "@/lib/services/purchasing"
import { logger } from "@/lib/logger"
import { recordItemCostSchema, type ActionState } from "@/lib/validation/operations"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { formatCLP } from "@/lib/utils"
import { dbErrMsg } from "./helpers"
import { REVALIDATE } from "./revalidate"

/**
 * Registra el costo real de una línea que entró a la OC con costo pendiente.
 * Mismo permiso que ponerle precio a la orden al crearla (`purchasing:create_order`):
 * es la misma decisión comercial, sólo que más tarde.
 */
export async function recordItemCostAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:create_order")
  } catch {
    return { ok: false, message: "Sin permisos para registrar costos de una orden" }
  }

  const parsed = recordItemCostSchema.safeParse({
    purchaseOrderItemId: formData.get("purchaseOrderItemId"),
    unitPrice:           formData.get("unitPrice"),
    notes:               formData.get("notes"),
  })
  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    return {
      ok: false,
      message: flattened.fieldErrors.unitPrice?.[0] ?? "Revisa el costo ingresado",
      fieldErrors: flattened.fieldErrors as Record<string, string[]>,
    }
  }

  try {
    const result = await recordOrderItemCost({
      purchaseOrderItemId: parsed.data.purchaseOrderItemId,
      unitPrice:           parsed.data.unitPrice,
      notes:               parsed.data.notes || null,
      userId:              session.user.id,
      userEmail:           session.user.email ?? undefined,
      worksiteScope:       serviceWorksiteScope(session),
    })

    revalidateOperationalViews([REVALIDATE, `/compras/${result.orderId}`, "/trazabilidad"])
    return {
      ok: true,
      message: result.pendingCostLines > 0
        ? `Costo registrado. Quedan ${result.pendingCostLines} línea(s) con costo pendiente.`
        : `Costo registrado. Total de la orden: ${formatCLP(result.totalAmount)}.`,
    }
  } catch (e) {
    logger.error("[recordItemCostAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al registrar el costo") }
  }
}
