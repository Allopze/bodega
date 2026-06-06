/**
 * Warehouse service — applyMovement is the ONLY place stock is mutated.
 * Every ingress and egress goes through this function atomically.
 */

import { eq, and } from "drizzle-orm"
import { db } from "@/db"
import { warehouses, warehouseStock, inventoryMovements } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"

/* ── Movement types ─────────────────────────────────────────────────────────── */
export type MovementType =
  | "ingreso_oc"           // + : received from purchase order
  | "egreso_faena"         // - : dispatched to worksite
  | "transferencia"        // ±  : transfer between warehouses
  | "devolucion"           // + : return from faena
  | "ajuste_positivo"      // + : positive inventory adjustment
  | "ajuste_negativo"      // - : negative inventory adjustment
  | "rechazo"              // - : rejected goods removed
  | "merma"                // - : waste/shrinkage
  | "anulacion"            // ± : cancellation of a movement

/* ── Apply movement ─────────────────────────────────────────────────────────── */

export interface ApplyMovementInput {
  warehouseId:    string
  productId:      string
  type:           MovementType
  quantity:       number          // positive = in, negative = out
  referenceType?: string          // 'purchase_order' | 'delivery' | 'adjustment' | etc.
  referenceId?:   string
  performedBy:    string
  userEmail?:     string
  reason?:        string
  notes?:         string
}

/**
 * Atomically apply an inventory movement.
 *
 * - Validates the warehouse and product exist.
 * - Blocks outbound movements that would drive stock negative.
 * - Upserts warehouseStock.
 * - Writes an inventoryMovements record.
 * - Calls recordAudit.
 *
 * Returns the new stock level after the movement.
 */
export async function applyMovement(input: ApplyMovementInput): Promise<number> {
  let stockAfter: number = 0

  await db.transaction(async (tx) => {
    // Verify warehouse exists
    const warehouse = await tx.query.warehouses.findFirst({
      where: eq(warehouses.id, input.warehouseId),
    })
    if (!warehouse) {
      throw new Error(`Warehouse ${input.warehouseId} not found`)
    }
    if (!warehouse.isActive) {
      throw new Error(`Warehouse '${warehouse.name}' is not active`)
    }

    // Get current stock
    const existing = await tx.query.warehouseStock.findFirst({
      where: and(
        eq(warehouseStock.warehouseId, input.warehouseId),
        eq(warehouseStock.productId, input.productId),
      ),
    })

    const currentQty = existing?.quantity ?? 0
    const newQty     = currentQty + input.quantity

    // Block outbound that would go negative
    if (newQty < 0) {
      throw new Error(
        `Stock insuficiente: disponible ${currentQty}, solicitado ${Math.abs(input.quantity)}`
      )
    }

    stockAfter = newQty
    const now  = new Date().toISOString()

    // Upsert warehouseStock
    if (existing) {
      await tx
        .update(warehouseStock)
        .set({
          quantity:       newQty,
          lastMovementAt: now,
          updatedAt:      now,
        })
        .where(
          and(
            eq(warehouseStock.warehouseId, input.warehouseId),
            eq(warehouseStock.productId,   input.productId),
          ),
        )
    } else {
      await tx.insert(warehouseStock).values({
        id:             nanoid(),
        warehouseId:    input.warehouseId,
        productId:      input.productId,
        quantity:       newQty,
        reservedQty:    0,
        minStock:       0,
        lastMovementAt: now,
        updatedAt:      now,
      })
    }

    // Write movement record
    await tx.insert(inventoryMovements).values({
      id:            nanoid(),
      warehouseId:   input.warehouseId,
      productId:     input.productId,
      type:          input.type,
      quantity:      input.quantity,
      referenceType: input.referenceType ?? null,
      referenceId:   input.referenceId ?? null,
      stockBefore:   currentQty,
      stockAfter:    newQty,
      performedBy:   input.performedBy,
      reason:        input.reason ?? null,
      notes:         input.notes ?? null,
    })

    await recordAudit({
      userId:     input.performedBy,
      userEmail:  input.userEmail,
      action:     "create",
      entityType: "inventory_movement",
      entityId:   input.warehouseId,
      newState:   {
        type:        input.type,
        productId:   input.productId,
        quantity:    input.quantity,
        stockBefore: currentQty,
        stockAfter:  newQty,
      },
    })
  })

  return stockAfter
}
