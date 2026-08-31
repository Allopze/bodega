import { and, asc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries,
  deliveryItems,
  inventoryMovements,
  products,
  purchaseOrderItems,
  purchaseRequestItems,
  stockAdjustments,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nextCodeTx } from "@/lib/code-sequences"
import { nanoid } from "@/lib/id"
import { deliverItemTx } from "@/lib/services/item-state-module/receiving"
import { applyMovementTx } from "@/lib/services/stock-movement"
import { codeYear } from "@/lib/utils"

const BUG_INTRODUCED_AT = "2026-08-11T00:00:00.000Z"
const BUGGY_QUANTITY_MAX = 0.1
const BUGGY_QUANTITY_SCALE = 100
const QUANTITY_EPSILON = 0.000_1
export const EPP_DELIVERY_SCALE_CORRECTION_REASON =
  "Regularización automática: el formulario de entregas EPP registró centésimas en vez de unidades enteras"

type ReconciliationCandidate = {
  deliveryItemId: string
  deliveryId: string
  deliveryCode: string
  deliveredBy: string
  sourceWorksiteId: string | null
  productId: string
  requestItemId: string | null
  recordedQuantity: number
  deliveredAt: string
}

export type EppDeliveryScaleReconciliationResult = {
  correctedDeliveries: number
  totalOriginalQuantity: number
  totalCorrectedQuantity: number
  totalStockAdjustment: number
  adjustmentCodes: string[]
}

function correctedQuantity(recordedQuantity: number) {
  const scaled = recordedQuantity * BUGGY_QUANTITY_SCALE
  const corrected = Math.round(scaled)
  if (
    corrected < 1
    || Math.abs(scaled - corrected) > QUANTITY_EPSILON
  ) {
    throw new Error(`La cantidad ${recordedQuantity} no coincide con la huella del error de escala EPP`)
  }
  return corrected
}

async function listCandidates(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<ReconciliationCandidate[]> {
  const rows = await tx
    .select({
      deliveryItemId: deliveryItems.id,
      deliveryId: deliveries.id,
      deliveryCode: deliveries.code,
      deliveredBy: deliveries.deliveredBy,
      sourceWorksiteId: deliveries.sourceWorksiteId,
      productId: deliveryItems.productId,
      requestItemId: deliveryItems.requestItemId,
      recordedQuantity: deliveryItems.quantity,
      deliveredAt: deliveries.deliveredAt,
    })
    .from(deliveryItems)
    .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
    .innerJoin(products, eq(deliveryItems.productId, products.id))
    .where(and(
      eq(deliveries.destinationType, "worker"),
      eq(products.isEpp, true),
      isNull(deliveryItems.quantityOriginal),
      gt(deliveryItems.quantity, 0),
      lte(deliveryItems.quantity, BUGGY_QUANTITY_MAX),
      gte(deliveries.createdAt, BUG_INTRODUCED_AT),
    ))
    // Todos los movimientos toman locks en el mismo orden para no introducir
    // un deadlock si el reconciliador coincide con una operación de bodega.
    .orderBy(
      asc(deliveries.sourceWorksiteId),
      asc(deliveryItems.productId),
      asc(deliveries.deliveredAt),
      asc(deliveryItems.id),
    )
    .for("update")
  return rows as ReconciliationCandidate[]
}

/**
 * Corrige una sola vez las entregas creadas por el control `step=0.01`.
 *
 * Huella exigida para tocar una línea:
 * - entrega a trabajador posterior a la introducción del formulario afectado;
 * - producto marcado EPP;
 * - cantidad entre 0,01 y 0,10 que al multiplicarse por 100 da un entero;
 * - exactamente un egreso de entrega por el mismo valor;
 * - sin una corrección previa (`quantityOriginal IS NULL`).
 *
 * La cantidad original se conserva, la cantidad efectiva se actualiza y la
 * diferencia sale mediante un AJU + movimiento de kardex. Todo comparte una
 * transacción: ante stock insuficiente o una huella ambigua no cambia nada.
 */
export async function reconcileEppDeliveryScale(): Promise<EppDeliveryScaleReconciliationResult> {
  return db.transaction(async (tx) => {
    const candidates = await listCandidates(tx)
    const now = new Date().toISOString()
    const result: EppDeliveryScaleReconciliationResult = {
      correctedDeliveries: 0,
      totalOriginalQuantity: 0,
      totalCorrectedQuantity: 0,
      totalStockAdjustment: 0,
      adjustmentCodes: [],
    }
    const linkedRequestItems = new Map<string, string>()

    for (const candidate of candidates) {
      if (!candidate.productId || !candidate.sourceWorksiteId) {
        throw new Error(`La entrega ${candidate.deliveryCode} no tiene producto o bodega de origen para conciliar`)
      }

      const recorded = Number(candidate.recordedQuantity)
      const corrected = correctedQuantity(recorded)
      const stockDelta = corrected - recorded

      const matchingMovements = await tx
        .select({ id: inventoryMovements.id, quantity: inventoryMovements.quantity })
        .from(inventoryMovements)
        .where(and(
          eq(inventoryMovements.referenceType, "delivery"),
          eq(inventoryMovements.referenceId, candidate.deliveryId),
          eq(inventoryMovements.productId, candidate.productId),
          eq(inventoryMovements.type, "egreso_entrega"),
        ))
        .for("update")

      if (
        matchingMovements.length !== 1
        || Math.abs(Number(matchingMovements[0]?.quantity) + recorded) > QUANTITY_EPSILON
      ) {
        throw new Error(`La entrega ${candidate.deliveryCode} no tiene un movimiento de stock inequívoco`)
      }

      const adjustmentId = nanoid()
      const adjustmentCode = await nextCodeTx(tx, "AJU", codeYear())
      const notes = `${candidate.deliveryCode}: cantidad original ${recorded}; cantidad corregida ${corrected}.`

      await tx.insert(stockAdjustments).values({
        id: adjustmentId,
        code: adjustmentCode,
        kind: "ajuste",
        worksiteId: candidate.sourceWorksiteId,
        productId: candidate.productId,
        quantity: -stockDelta,
        reason: EPP_DELIVERY_SCALE_CORRECTION_REASON,
        notes,
        // La FK exige un usuario. Se conserva el autor del documento origen;
        // el motivo y el audit log distinguen que la ejecución fue automática.
        createdBy: candidate.deliveredBy,
        createdAt: now,
      })

      await applyMovementTx(tx, {
        worksiteId: candidate.sourceWorksiteId,
        productId: candidate.productId,
        type: "ajuste",
        quantity: -stockDelta,
        referenceType: "stock_adjustment",
        referenceId: adjustmentId,
        performedBy: candidate.deliveredBy,
        userEmail: "sistema@chome.cl",
        reason: EPP_DELIVERY_SCALE_CORRECTION_REASON,
        notes,
      })

      await tx
        .update(deliveryItems)
        .set({
          quantity: corrected,
          quantityOriginal: recorded,
          quantityCorrectedAt: now,
          quantityCorrectionReason: EPP_DELIVERY_SCALE_CORRECTION_REASON,
        })
        .where(and(
          eq(deliveryItems.id, candidate.deliveryItemId),
          isNull(deliveryItems.quantityOriginal),
        ))

      await recordAudit({
        userId: null,
        userEmail: "sistema@chome.cl",
        action: "update",
        entityType: "delivery_item",
        entityId: candidate.deliveryItemId,
        entityCode: candidate.deliveryCode,
        oldState: { quantity: recorded },
        newState: {
          quantity: corrected,
          quantityOriginal: recorded,
          stockAdjustmentId: adjustmentId,
          stockAdjustmentCode: adjustmentCode,
        },
        reason: EPP_DELIVERY_SCALE_CORRECTION_REASON,
      }, tx)

      if (candidate.requestItemId) {
        linkedRequestItems.set(candidate.requestItemId, candidate.deliveredBy)
      }
      result.correctedDeliveries += 1
      result.totalOriginalQuantity += recorded
      result.totalCorrectedQuantity += corrected
      result.totalStockAdjustment += stockDelta
      result.adjustmentCodes.push(adjustmentCode)
    }

    // Dos de las líneas detectadas conservan trazabilidad a solicitud. Después
    // de corregir todas las cantidades se recompone su estado y el roll-up de
    // la solicitud con el total efectivo, no con la centésima defectuosa.
    for (const [requestItemId, deliveredBy] of linkedRequestItems) {
      const [requestItem, deliveredRow, receivedRow] = await Promise.all([
        tx.query.purchaseRequestItems.findFirst({
          where: eq(purchaseRequestItems.id, requestItemId),
        }),
        tx
          .select({ delivered: sql<number>`coalesce(sum(${deliveryItems.quantity}), 0)` })
          .from(deliveryItems)
          .where(eq(deliveryItems.requestItemId, requestItemId)),
        tx
          .select({ received: sql<number>`coalesce(sum(${purchaseOrderItems.quantityReceived}), 0)` })
          .from(purchaseOrderItems)
          .where(eq(purchaseOrderItems.requestItemId, requestItemId)),
      ])
      if (!requestItem) throw new Error(`Ítem trazable ${requestItemId} no encontrado`)
      const totalDelivered = Number(deliveredRow[0]?.delivered ?? 0)
      const totalReceived = Number(receivedRow[0]?.received ?? 0)
      if (totalDelivered > Math.min(requestItem.quantity, totalReceived) + QUANTITY_EPSILON) {
        throw new Error(`La corrección excede el saldo trazable del ítem ${requestItemId}`)
      }
      await deliverItemTx(tx, requestItemId, deliveredBy, {
        userEmail: "sistema@chome.cl",
        deliveredQuantity: totalDelivered,
        totalDelivered,
      })
    }

    return result
  })
}
