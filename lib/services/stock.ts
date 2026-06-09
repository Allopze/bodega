/**
 * Stock service — applyMovement is the ONLY place stock is mutated.
 * Every ingress and egress goes through this function atomically.
 */

import { eq, and } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { worksites, worksiteStock, inventoryMovements } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"

/* ── Movement types ─────────────────────────────────────────────────────────── */
export type MovementType =
  | "ingreso_oc"           // + : received from purchase order
  | "egreso_entrega"       // - : delivered to worker
  | "ingreso_devolucion"   // + : returned from worker/faena

/* ── Apply movement ─────────────────────────────────────────────────────────── */

export interface ApplyMovementInput {
  worksiteId:    string
  productId:     string
  type:          MovementType
  quantity:      number          // positive = in, negative = out
  referenceType?: string          // 'purchase_order' | 'delivery'
  referenceId?:   string
  performedBy:    string
  userEmail?:     string
  reason?:        string
  notes?:         string
}

/**
 * Atomically apply an inventory movement at worksite level.
 *
 * - Validates the worksite exists and is active.
 * - Blocks outbound movements that would drive stock negative.
 * - Upserts worksiteStock.
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

export function applyMovementTx(tx: Tx, input: ApplyMovementInput): number {
  const ws = tx.query.worksites.findFirst({
    where: eq(worksites.id, input.worksiteId),
  }).sync()
  if (!ws) {
    throw new Error(`Worksite ${input.worksiteId} not found`)
  }
  if (!ws.isActive) {
    throw new Error(`Worksite '${ws.name}' is not active`)
  }

  const existing = tx.query.worksiteStock.findFirst({
    where: and(
      eq(worksiteStock.worksiteId, input.worksiteId),
      eq(worksiteStock.productId, input.productId),
    ),
  }).sync()

  const currentQty = existing?.quantity ?? 0
  const newQty = currentQty + input.quantity

  if (newQty < 0) {
    throw new Error(
      `Stock insuficiente: disponible ${currentQty}, solicitado ${Math.abs(input.quantity)}`
    )
  }

  const now = new Date().toISOString()

  if (existing) {
    tx
      .update(worksiteStock)
      .set({
        quantity: newQty,
        lastMovementAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(worksiteStock.worksiteId, input.worksiteId),
          eq(worksiteStock.productId, input.productId),
        ),
      ).run()
  } else {
    tx.insert(worksiteStock).values({
      id: nanoid(),
      worksiteId: input.worksiteId,
      productId: input.productId,
      quantity: newQty,
      minStock: 0,
      lastMovementAt: now,
      updatedAt: now,
    }).run()
  }

  tx.insert(inventoryMovements).values({
    id: nanoid(),
    worksiteId: input.worksiteId,
    productId: input.productId,
    type: input.type,
    quantity: input.quantity,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    stockBefore: currentQty,
    stockAfter: newQty,
    performedBy: input.performedBy,
    reason: input.reason ?? null,
    notes: input.notes ?? null,
  }).run()

  recordAudit({
    userId: input.performedBy,
    userEmail: input.userEmail,
    action: "create",
    entityType: "inventory_movement",
    entityId: input.worksiteId,
    newState: {
      type: input.type,
      productId: input.productId,
      quantity: input.quantity,
      stockBefore: currentQty,
      stockAfter: newQty,
    },
  }, tx)

  return newQty
}
