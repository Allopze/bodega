/**
 * Stock service — applyMovement is the ONLY place stock is mutated.
 * Every ingress and egress goes through this function atomically.
 */

import { eq, and, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { worksites, worksiteStock, inventoryMovements } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"

/* ── Movement types ─────────────────────────────────────────────────────────── */
export type MovementType =
  | "ingreso_oc"           // + : received from purchase order
  | "egreso_entrega"       // - : delivered to worker
  | "ingreso_devolucion"   // + : returned from worker/faena
  | "egreso_desecho"       // 0 : discarded/retired EPP (record only, no stock change)
  | "ajuste"               // +/-: manual inventory adjustment with mandatory reason

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
  return await db.transaction(async (tx) => {
    return await applyMovementTx(tx, input)
  })
}

export async function applyMovementTx(tx: Tx, input: ApplyMovementInput): Promise<number> {
  const ws = await tx.query.worksites.findFirst({
    where: eq(worksites.id, input.worksiteId),
  })
  if (!ws) {
    throw new Error(`Worksite ${input.worksiteId} not found`)
  }
  if (!ws.isActive) {
    throw new Error(`Worksite '${ws.name}' is not active`)
  }

  const now = new Date().toISOString()

  // ajuste requires a reason; quantity may be positive (ingreso) or negative (egreso)
  if (input.type === "ajuste") {
    if (!input.reason?.trim()) {
      throw new Error("El ajuste de inventario requiere un motivo")
    }
    if (input.quantity === 0) {
      throw new Error("La cantidad de ajuste no puede ser cero")
    }
  }

  // egreso_desecho is record-only — no stock delta, just trail the retirement
  if (input.type === "egreso_desecho") {
    // S-17: record-only movements must carry a positive count. The DB CHECK
    // only guards stock_before/after >= 0, not the movement quantity itself,
    // so a negative quantity would silently land in the kardex.
    if (!(input.quantity > 0)) {
      throw new Error("La cantidad de un movimiento de desecho debe ser mayor que cero")
    }
    const existing = await tx.query.worksiteStock.findFirst({
      where: and(
        eq(worksiteStock.worksiteId, input.worksiteId),
        eq(worksiteStock.productId, input.productId),
      ),
    })
    const currentQty = existing?.quantity ?? 0

    await tx.insert(inventoryMovements).values({
      id: nanoid(),
      worksiteId: input.worksiteId,
      productId: input.productId,
      type: input.type,
      quantity: input.quantity,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      stockBefore: currentQty,
      stockAfter: currentQty,
      performedBy: input.performedBy,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
    })

    await recordAudit({
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
        stockAfter: currentQty,
      },
    }, tx)

    return currentQty
  }

  const { currentQty, newQty } = await applyStockDelta(tx, input, now)

  await tx.insert(inventoryMovements).values({
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
  })

  await recordAudit({
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

async function applyStockDelta(tx: Tx, input: ApplyMovementInput, now: string) {
  if (input.quantity >= 0) {
    const [row] = await tx
      .insert(worksiteStock)
      .values({
        id: nanoid(),
        worksiteId: input.worksiteId,
        productId: input.productId,
        quantity: input.quantity,
        minStock: 0,
        lastMovementAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [worksiteStock.worksiteId, worksiteStock.productId],
        set: {
          quantity: sql`${worksiteStock.quantity} + ${input.quantity}`,
          lastMovementAt: now,
          updatedAt: now,
        },
      })
      .returning({
        stockBefore: sql<number>`${worksiteStock.quantity} - ${input.quantity}`,
        stockAfter: worksiteStock.quantity,
      })

    // The upsert always returns exactly one row.
    if (!row) throw new Error("No se pudo aplicar el movimiento de stock")
    return {
      currentQty: Number(row.stockBefore),
      newQty: Number(row.stockAfter),
    }
  }

  const [row] = await tx
    .update(worksiteStock)
    .set({
      quantity: sql`${worksiteStock.quantity} + ${input.quantity}`,
      lastMovementAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(worksiteStock.worksiteId, input.worksiteId),
        eq(worksiteStock.productId, input.productId),
        sql`${worksiteStock.quantity} + ${input.quantity} >= 0`,
      ),
    )
    .returning({
      stockBefore: sql<number>`${worksiteStock.quantity} - ${input.quantity}`,
      stockAfter: worksiteStock.quantity,
    })

  if (row) {
    return {
      currentQty: Number(row.stockBefore),
      newQty: Number(row.stockAfter),
    }
  }

  const existing = await tx.query.worksiteStock.findFirst({
    where: and(
      eq(worksiteStock.worksiteId, input.worksiteId),
      eq(worksiteStock.productId, input.productId),
    ),
  })
  const currentQty = existing?.quantity ?? 0
  throw new Error(
    `Stock insuficiente: disponible ${currentQty}, solicitado ${Math.abs(input.quantity)}`,
  )
}
