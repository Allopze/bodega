/**
 * Registro posterior del costo real de una línea de OC.
 *
 * Los servicios (mantención de monogás, calibración de alcotest, vacunas) entran
 * a la orden con `unit_price = NULL` — costo pendiente— porque su precio recién
 * se conoce al ejecutarlos o facturarlos. Esta función es la única puerta para
 * ponerle precio a esa línea después: recalcula los totales de la OC y deja la
 * traza (quién, cuándo, de qué valor a qué valor) en `audit_log` además de las
 * columnas `cost_recorded_at` / `cost_recorded_by`.
 *
 * No reescribe la solicitud de origen: el historial de la solicitud queda tal
 * como se aprobó.
 */

import { and, eq, ne } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrderItems, purchaseOrders } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { computeLineSubtotal, computeOrderTotals } from "@/lib/order-totals"

export interface RecordOrderItemCostInput {
  purchaseOrderItemId: string
  /** Costo unitario real. 0 es válido: significa "sin costo", no "desconocido". */
  unitPrice:           number
  notes?:              string | null
  userId:              string
  userEmail?:          string
  /** Alcance de faenas del actor; "all" para roles globales. */
  worksiteScope?:      string[] | "all"
}

export interface RecordOrderItemCostResult {
  orderId:          string
  orderCode:        string
  totalAmount:      number
  pendingCostLines: number
}

export async function recordOrderItemCost(
  input: RecordOrderItemCostInput,
): Promise<RecordOrderItemCostResult> {
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
    throw new Error("El costo debe ser un monto válido y no negativo")
  }

  return await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ item: purchaseOrderItems, order: purchaseOrders })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .where(eq(purchaseOrderItems.id, input.purchaseOrderItemId))
      .for("update")
    if (!locked) throw new Error("Ítem de la orden no encontrado")

    const { item, order } = locked
    if (input.worksiteScope && input.worksiteScope !== "all"
      && !input.worksiteScope.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a la faena de esta orden")
    }
    if (order.status === "cancelled") throw new Error("La orden está anulada")
    if (item.status === "cancelled") throw new Error("La línea está anulada")
    // Sólo una línea que nació con costo pendiente —o una corrección de un costo
    // registrado por esta misma vía— pasa por aquí. Una línea con precio de
    // catálogo se repriza cambiando la OC, no por esta puerta.
    if (item.unitPrice !== null && item.costRecordedAt === null) {
      throw new Error("Esta línea ya tiene un precio acordado en la orden")
    }

    const now = new Date().toISOString()
    const subtotal = computeLineSubtotal(item.quantity, input.unitPrice, item.discount)

    await tx
      .update(purchaseOrderItems)
      .set({
        unitPrice:      input.unitPrice,
        subtotal,
        costRecordedAt: now,
        costRecordedBy: input.userId,
        notes:          input.notes?.trim() ? input.notes.trim() : item.notes,
      })
      .where(eq(purchaseOrderItems.id, item.id))

    const liveLines = await tx
      .select({
        quantity:  purchaseOrderItems.quantity,
        unitPrice: purchaseOrderItems.unitPrice,
        discount:  purchaseOrderItems.discount,
      })
      .from(purchaseOrderItems)
      .where(and(
        eq(purchaseOrderItems.purchaseOrderId, order.id),
        ne(purchaseOrderItems.status, "cancelled"),
      ))

    const totals = computeOrderTotals(liveLines)
    await tx
      .update(purchaseOrders)
      .set({
        netAmount:   totals.netAmount,
        taxAmount:   totals.taxAmount,
        totalAmount: totals.totalAmount,
        updatedAt:   now,
      })
      .where(eq(purchaseOrders.id, order.id))

    await recordAudit({
      userId:     input.userId,
      userEmail:  input.userEmail,
      action:     "update",
      entityType: "purchase_order_item",
      entityId:   item.id,
      entityCode: order.code,
      oldState:   { unitPrice: item.unitPrice, subtotal: item.subtotal },
      newState:   {
        unitPrice:   input.unitPrice,
        subtotal,
        orderTotal:  totals.totalAmount,
        pendingCostLines: totals.pendingCostLines,
      },
    }, tx)

    return {
      orderId:          order.id,
      orderCode:        order.code,
      totalAmount:      totals.totalAmount,
      pendingCostLines: totals.pendingCostLines,
    }
  })
}
