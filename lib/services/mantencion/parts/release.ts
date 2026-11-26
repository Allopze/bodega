/**
 * Liberación de reservas de repuestos (ADR mantención 0001): al cerrar o anular la
 * OT, y a mano por jefatura. Orden de bloqueo en `allocations.ts`.
 */

import { and, asc, eq, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantPartsAllocations, mantPartsAllocationSources, mantWorkOrderEvents } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { consumedSql, roundQty, toCents } from "@/lib/services/stock-reservations"
import { allocationRemainingTx, lockForStockTx } from "./allocations"
import { PartsValidationError, type ReleasedAllocation } from "./types"

function formatQty(quantity: number): string {
  return roundQty(quantity).toLocaleString("es-CL", { maximumFractionDigits: 2 })
}

/**
 * Libera las reservas activas de la OT al cerrarla o anularla: lo no usado pasa a
 * stock libre. Corre dentro de la transición (OT bloqueada `FOR UPDATE`). Reabrir
 * la OT no vuelve a reservar.
 */
export async function releaseWorkOrderAllocationsTx(tx: Tx, input: {
  workOrderId: string
  actorUserId: string
  userEmail?: string
  reason: string
}): Promise<{ released: ReleasedAllocation[] }> {
  const rows = await tx
    .select({
      id: mantPartsAllocations.id,
      productId: mantPartsAllocations.productId,
      worksiteId: mantPartsAllocations.worksiteId,
      quantity: mantPartsAllocations.quantity,
      // Envuelto: como campo directo de un select de una sola tabla, Drizzle quita los prefijos
      // de tabla y la subconsulta compararía `allocation_id` con su propio `id` (consumido = 0).
      consumed: sql<number>`(${consumedSql})`.mapWith(Number),
    })
    .from(mantPartsAllocations)
    .where(and(eq(mantPartsAllocations.workOrderId, input.workOrderId), eq(mantPartsAllocations.status, "activa")))
    .orderBy(asc(mantPartsAllocations.id))
    .for("update")
  const now = new Date().toISOString()
  const released: ReleasedAllocation[] = []
  for (const row of rows) {
    const quantity = Math.max(0, roundQty(Number(row.quantity) - Number(row.consumed)))
    await tx.update(mantPartsAllocations)
      .set({ status: "liberada", releasedQuantity: quantity, releasedByUserId: input.actorUserId, releasedAt: now, releaseReason: input.reason, updatedAt: now })
      .where(eq(mantPartsAllocations.id, row.id))
    if (toCents(quantity) > 0) released.push({ allocationId: row.id, productId: row.productId, worksiteId: row.worksiteId, quantity })
  }
  if (released.length > 0) {
    await tx.insert(mantWorkOrderEvents).values({
      id: nanoid(),
      workOrderId: input.workOrderId,
      type: "parts_released",
      reason: input.reason,
      changeSet: { items: released },
      actorUserId: input.actorUserId,
    })
    await recordAudit({
      userId: input.actorUserId,
      userEmail: input.userEmail,
      action: "status_change",
      entityType: "mant_parts_allocation",
      entityId: input.workOrderId,
      newState: { released },
      reason: input.reason,
    }, tx)
  }
  return { released }
}

/** Libera a mano parte de una reserva (jefatura, con motivo). Toma sus propios bloqueos. */
export async function releaseAllocationTx(tx: Tx, input: {
  allocationId: string
  quantity: number
  reason: string
  actorUserId: string
  userEmail?: string
}): Promise<{ released: number }> {
  const reason = input.reason.trim()
  if (reason.length < 5) throw new PartsValidationError("Indica el motivo (al menos 5 letras).", "reason")
  const [allocation] = await tx
    .select({ workOrderId: mantPartsAllocations.workOrderId, worksiteId: mantPartsAllocations.worksiteId, productId: mantPartsAllocations.productId, status: mantPartsAllocations.status })
    .from(mantPartsAllocations)
    .where(eq(mantPartsAllocations.id, input.allocationId))
    .limit(1)
  if (!allocation || allocation.status !== "activa") throw new PartsValidationError("Esa reserva ya no está activa.", "allocationId")
  await lockForStockTx(tx, { workOrderIds: [allocation.workOrderId], worksiteId: allocation.worksiteId, productIds: [allocation.productId] })
  const quantity = roundQty(input.quantity)
  const remaining = await allocationRemainingTx(tx, input.allocationId)
  if (toCents(quantity) <= 0 || toCents(quantity) > toCents(remaining)) {
    throw new PartsValidationError(`Puedes liberar hasta ${formatQty(remaining)}.`, "quantity")
  }
  await tx.update(mantPartsAllocations)
    .set({ quantity: sql`${mantPartsAllocations.quantity} - ${quantity}`, updatedAt: new Date().toISOString() })
    .where(eq(mantPartsAllocations.id, input.allocationId))
  await tx.insert(mantPartsAllocationSources).values({
    id: nanoid(), allocationId: input.allocationId, source: "liberacion", quantity: -quantity, actorUserId: input.actorUserId, reason,
  })
  await tx.insert(mantWorkOrderEvents).values({
    id: nanoid(),
    workOrderId: allocation.workOrderId,
    type: "parts_released",
    reason,
    changeSet: { items: [{ allocationId: input.allocationId, productId: allocation.productId, worksiteId: allocation.worksiteId, quantity }] },
    actorUserId: input.actorUserId,
  })
  await recordAudit({
    userId: input.actorUserId, userEmail: input.userEmail, action: "update", entityType: "mant_parts_allocation",
    entityId: input.allocationId, newState: { released: quantity }, reason, worksiteId: allocation.worksiteId,
  }, tx)
  return { released: quantity }
}
