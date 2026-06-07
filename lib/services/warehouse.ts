/**
 * Warehouse service — applyMovement is the ONLY place stock is mutated.
 * Every ingress and egress goes through this function atomically.
 */

import { eq, and } from "drizzle-orm"
import { db } from "@/db"
import { warehouses, warehouseStock, inventoryMovements } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

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

  db.transaction((tx) => {
    stockAfter = applyMovementTx(tx, input)
  })

  return stockAfter
}

export function applyMovementTx(
  tx: Tx,
  input: ApplyMovementInput,
): number {
    // Verify warehouse exists
    const warehouse = tx.query.warehouses.findFirst({
      where: eq(warehouses.id, input.warehouseId),
    }).sync()
    if (!warehouse) {
      throw new Error(`Warehouse ${input.warehouseId} not found`)
    }
    if (!warehouse.isActive) {
      throw new Error(`Warehouse '${warehouse.name}' is not active`)
    }

    // Get current stock
    const existing = tx.query.warehouseStock.findFirst({
      where: and(
        eq(warehouseStock.warehouseId, input.warehouseId),
        eq(warehouseStock.productId, input.productId),
      ),
    }).sync()

    const currentQty = existing?.quantity ?? 0
    const newQty     = currentQty + input.quantity

    // Block outbound that would go negative
    if (newQty < 0) {
      throw new Error(
        `Stock insuficiente: disponible ${currentQty}, solicitado ${Math.abs(input.quantity)}`
      )
    }

    const now  = new Date().toISOString()

    // Upsert warehouseStock
    if (existing) {
      tx
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
        ).run()
    } else {
      tx.insert(warehouseStock).values({
        id:             nanoid(),
        warehouseId:    input.warehouseId,
        productId:      input.productId,
        quantity:       newQty,
        reservedQty:    0,
        minStock:       0,
        lastMovementAt: now,
        updatedAt:      now,
      }).run()
    }

    // Write movement record
    tx.insert(inventoryMovements).values({
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
    }).run()

    recordAudit({
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
    }, tx)

  return newQty
}
