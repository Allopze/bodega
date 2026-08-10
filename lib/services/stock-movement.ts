/**
 * Stock service — applyMovement is the ONLY place stock is mutated.
 * Every ingress and egress goes through this function atomically.
 */

import { eq, and, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { deliveries, deliveryItems, worksites, worksiteStock, inventoryMovements, stockAdjustments, stockReturns } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { nextCodeTx } from "@/lib/code-sequences"

/* ── Movement types ─────────────────────────────────────────────────────────── */
export type MovementType =
  | "ingreso_oc"           // + : received from purchase order
  | "egreso_entrega"       // - : delivered to worker
  | "ingreso_devolucion"   // + : returned from worker/faena
  | "egreso_desecho"       // - : discarded from worksite stock
  | "retiro_epp_trabajador" // 0 : retired used EPP from a worker, audit only
  | "ajuste"               // +/-: manual inventory adjustment with mandatory reason
  | "egreso_traslado"      // - : salida por guía de despacho interna (oficina → faena)
  | "ingreso_traslado"     // + : entrada por guía de despacho interna en la faena destino

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

export interface RegisterStockReturnInput {
  deliveryItemId: string
  quantity: number
  performedBy: string
  userEmail?: string
  reason: string
  notes?: string
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

export async function registerStockAdjustment(input: ApplyMovementInput): Promise<{ id: string; code: string }> {
  if (input.type !== "ajuste") throw new Error("El documento no corresponde a un ajuste de stock")
  return db.transaction(async (tx) => {
    const id = nanoid()
    const code = await nextCodeTx(tx, "AJU", new Date().getFullYear())
    await tx.insert(stockAdjustments).values({
      id, code, worksiteId: input.worksiteId, productId: input.productId, quantity: input.quantity,
      reason: input.reason?.trim() ?? "", notes: input.notes ?? null, createdBy: input.performedBy,
    })
    await applyMovementTx(tx, { ...input, referenceType: "stock_adjustment", referenceId: id })
    return { id, code }
  })
}

export async function registerStockReturn(
  input: RegisterStockReturnInput,
  worksiteIds: string[] | "all" = "all",
): Promise<{ id: string; code: string }> {
  if (!input.deliveryItemId || !Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("La devolución debe indicar una entrega y una cantidad mayor que cero")
  }
  return db.transaction(async (tx) => {
    // The delivery item is the serialization point: every return against this
    // source locks the same row before calculating its remaining balance.
    const [deliveryItem] = await tx
      .select({
        id: deliveryItems.id,
        deliveryId: deliveryItems.deliveryId,
        productId: deliveryItems.productId,
        quantity: deliveryItems.quantity,
        worksiteId: deliveries.worksiteId,
        destinationType: deliveries.destinationType,
      })
      .from(deliveryItems)
      .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
      .where(eq(deliveryItems.id, input.deliveryItemId))
      .for("update")

    if (!deliveryItem || deliveryItem.destinationType !== "faena" || !deliveryItem.worksiteId || !deliveryItem.productId) {
      throw new Error("La línea de entrega no está disponible para devolución a stock")
    }
    if (worksiteIds !== "all" && !worksiteIds.includes(deliveryItem.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    const previousReturns = await tx
      .select({ quantity: stockReturns.quantity })
      .from(stockReturns)
      .where(eq(stockReturns.deliveryItemId, deliveryItem.id))
    const returnedQuantity = previousReturns.reduce((sum, item) => sum + item.quantity, 0)
    const remainingQuantity = deliveryItem.quantity - returnedQuantity
    if (input.quantity > remainingQuantity) {
      throw new Error(`La cantidad excede el saldo de la entrega. Máximo devolvible: ${remainingQuantity}`)
    }

    const id = nanoid()
    const code = await nextCodeTx(tx, "DEV", new Date().getFullYear())
    await tx.insert(stockReturns).values({
      id,
      code,
      worksiteId: deliveryItem.worksiteId,
      productId: deliveryItem.productId,
      deliveryItemId: deliveryItem.id,
      quantity: input.quantity,
      reason: input.reason?.trim() ?? "", notes: input.notes ?? null, createdBy: input.performedBy,
    })
    await applyMovementTx(tx, {
      worksiteId: deliveryItem.worksiteId,
      productId: deliveryItem.productId,
      type: "ingreso_devolucion",
      quantity: input.quantity,
      referenceType: "delivery_return",
      referenceId: id,
      performedBy: input.performedBy,
      userEmail: input.userEmail,
      reason: input.reason?.trim(),
      notes: input.notes,
    })
    return { id, code }
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

  // Retiring worn EPP from a worker is evidence of replacement, not an egress
  // from warehouse stock: the original unit was already deducted on delivery.
  if (input.type === "retiro_epp_trabajador") {
    if (!(input.quantity > 0)) {
      throw new Error("La cantidad de un retiro de EPP debe ser mayor que cero")
    }
    const [existing] = await tx
      .select()
      .from(worksiteStock)
      .where(and(
        eq(worksiteStock.worksiteId, input.worksiteId),
        eq(worksiteStock.productId, input.productId),
      ))
      .for("update")
    const currentQty = existing?.quantity ?? 0

    await tx.insert(inventoryMovements).values({
      id: nanoid(),
      worksiteId: input.worksiteId,
      productId: input.productId,
      type: input.type,
      quantity: 0,
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

  // egreso_desecho is a discard from warehouse stock.
  if (input.type === "egreso_desecho") {
    if (!(input.quantity > 0)) {
      throw new Error("La cantidad de un movimiento de desecho debe ser mayor que cero")
    }

    const [existing] = await tx
      .select()
      .from(worksiteStock)
      .where(and(
        eq(worksiteStock.worksiteId, input.worksiteId),
        eq(worksiteStock.productId, input.productId),
      ))
      .for("update")
    const currentQty = existing?.quantity ?? 0
    const deductQty = currentQty > 0 ? Math.min(input.quantity, currentQty) : 0
    const newQty = currentQty - deductQty

    if (deductQty > 0) {
      await tx.update(worksiteStock)
        .set({ quantity: newQty, lastMovementAt: now, updatedAt: now })
        .where(and(
          eq(worksiteStock.worksiteId, input.worksiteId),
          eq(worksiteStock.productId, input.productId),
        ))
    }

    await tx.insert(inventoryMovements).values({
      id: nanoid(),
      worksiteId: input.worksiteId,
      productId: input.productId,
      type: input.type,
      quantity: -deductQty,
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
