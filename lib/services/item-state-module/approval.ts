import { eq, and } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequestItems, approvalDecisions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { resolveReplenishmentLinksTx } from "@/lib/services/epp-replenishment"
import { canTransition, type ItemStatus } from "./types"
import { lockRequestsForRollupTx, rollupRequestStatus } from "./rollup"

/**
 * Bulk-approve multiple items in a single transaction.
 * Each item is locked individually (FOR UPDATE) to prevent deadlocks.
 * If any item fails, the entire transaction is rolled back.
 */
export async function bulkApproveItems(
  itemIds: string[],
  userId: string,
  opts?: { userEmail?: string; roleContext?: string },
): Promise<{ approved: number; errors: string[] }> {
  if (itemIds.length === 0) return { approved: 0, errors: [] }

  const stableItemIds = [...new Set(itemIds)].sort()
  if (stableItemIds.length !== itemIds.length) {
    throw new Error("La aprobación masiva contiene ítems duplicados")
  }

  await db.transaction(async (tx) => {
    const now = new Date().toISOString()
    const lockedItems: Array<{ id: string; status: ItemStatus; requestId: string }> = []

    // Lock and validate the whole batch first, always in the same order. No
    // mutation is issued unless every requested item can be approved.
    for (const itemId of stableItemIds) {
      const [locked] = await tx
        .select({
          id: purchaseRequestItems.id, status: purchaseRequestItems.status, requestId: purchaseRequestItems.requestId,
        })
        .from(purchaseRequestItems)
        .where(eq(purchaseRequestItems.id, itemId))
        .for("update")

      if (!locked) throw new Error(`Ítem ${itemId} no encontrado`)
      if (!canTransition(locked.status as ItemStatus, "approved")) {
        throw new Error(`No se puede aprobar el ítem ${itemId} en estado '${locked.status}'`)
      }
      lockedItems.push({ ...locked, status: locked.status as ItemStatus })
    }

    // DAT-1: los padres, después de los ítems y antes de tocar nada — el insert
    // en `approval_decisions` de más abajo referencia la solicitud, y hacerlo
    // primero obligaría a subir de FOR KEY SHARE a FOR UPDATE (deadlock).
    await lockRequestsForRollupTx(tx, lockedItems.map((item) => item.requestId))

    for (const locked of lockedItems) {
      const [updated] = await tx
        .update(purchaseRequestItems)
        .set({ status: "approved", updatedAt: now })
        .where(and(
          eq(purchaseRequestItems.id, locked.id),
          eq(purchaseRequestItems.status, locked.status),
        ))
        .returning({ id: purchaseRequestItems.id })

      if (!updated) throw new Error(`El ítem ${locked.id} fue modificado concurrentemente`)

      await tx.insert(approvalDecisions).values({
        id:            nanoid(),
        requestItemId: locked.id,
        requestId:     locked.requestId,
        type:          "approve",
        decidedBy:     userId,
        roleContext:   opts?.roleContext ?? null,
      })

      await recordStatusChange({
        entityType: "request_item",
        entityId:   locked.id,
        fromStatus: locked.status,
        toStatus:   "approved",
        changedBy:  userId,
      }, tx)
      await recordAudit({
        userId,
        userEmail:  opts?.userEmail,
        action:     "status_change",
        entityType: "request_item",
        entityId:   locked.id,
        oldState:   { status: locked.status },
        newState:   { status: "approved" },
      }, tx)
    }

    for (const requestId of new Set(lockedItems.map((item) => item.requestId))) {
      await rollupRequestStatus(requestId, tx, userId)
    }
  })

  return { approved: stableItemIds.length, errors: [] }
}

/** @see approveItem */
export async function approveItem(
  itemId: string,
  userId: string,
  opts?: { modifiedQty?: number; reason?: string; userEmail?: string; roleContext?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        id: purchaseRequestItems.id, status: purchaseRequestItems.status, requestId: purchaseRequestItems.requestId,
        // Necesaria para topear `modifiedQty` contra lo solicitado bajo el lock.
        quantity: purchaseRequestItems.quantity,
      })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.id, itemId))
      .for("update")

    if (!locked) throw new Error(`Item ${itemId} not found`)
    // DAT-1: el padre, después del ítem y antes del UPDATE y del insert en
    // `approval_decisions` (que lo referencia).
    await lockRequestsForRollupTx(tx, [locked.requestId])
    if (!canTransition(locked.status as ItemStatus, "approved")) {
      throw new Error(`Cannot approve item in state '${locked.status}'`)
    }
    if (opts?.modifiedQty !== undefined && !opts?.reason) {
      throw new Error("Se requiere un motivo al modificar la cantidad aprobada")
    }
    // El tope vivía sólo en la action: cualquier otro caller (script, API, una
    // action futura) podía escribir 0, negativo o más de lo solicitado. La regla
    // del motivo ya había migrado acá; ésta faltaba.
    if (opts?.modifiedQty !== undefined) {
      if (!Number.isFinite(opts.modifiedQty) || opts.modifiedQty <= 0) {
        throw new Error("La cantidad aprobada debe ser mayor a 0")
      }
      if (opts.modifiedQty > locked.quantity) {
        throw new Error("La cantidad aprobada no puede superar la solicitada")
      }
    }

    const now = new Date().toISOString()
    const updates: Partial<typeof purchaseRequestItems.$inferSelect> = {
      status:    "approved",
      updatedAt: now,
    }
    if (opts?.modifiedQty !== undefined) {
      updates.quantity = opts.modifiedQty
    }

    const [updated] = await tx
      .update(purchaseRequestItems)
      .set(updates)
      .where(
        and(
          eq(purchaseRequestItems.id, itemId),
          eq(purchaseRequestItems.status, locked.status),
        ),
      )
      .returning({ id: purchaseRequestItems.id })

    if (!updated) {
      throw new Error("El ítem ya no está disponible: posible concurrencia")
    }

    await tx.insert(approvalDecisions).values({
      id:            nanoid(),
      requestItemId: itemId,
      requestId:     locked.requestId,
      type:          opts?.modifiedQty !== undefined ? "modify" : "approve",
      decidedBy:     userId,
      reason:        opts?.reason ?? null,
      modifiedQty:   opts?.modifiedQty ?? null,
      roleContext:   opts?.roleContext ?? null,
    })

    await recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: locked.status,
      toStatus:   "approved",
      changedBy:  userId,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: locked.status },
      newState:   { status: "approved", modifiedQty: opts?.modifiedQty },
    }, tx)
    await rollupRequestStatus(locked.requestId, tx, userId)
  })
}

/**
 * Reject an item: requested → rejected. Reason is mandatory.
 * After the transition, rolls up the parent request status.
 */
export async function rejectItem(
  itemId: string,
  userId: string,
  reason: string,
  opts?: { userEmail?: string; roleContext?: string },
): Promise<void> {
  if (!reason?.trim()) throw new Error("Reason is required to reject an item")

  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: purchaseRequestItems.id, status: purchaseRequestItems.status, requestId: purchaseRequestItems.requestId })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.id, itemId))
      .for("update")
    if (!item) throw new Error(`Item ${itemId} not found`)
    // DAT-1: mismo orden que approveItem — ítem, padre, y recién ahí mutar.
    await lockRequestsForRollupTx(tx, [item.requestId])
    if (!canTransition(item.status as ItemStatus, "rejected")) {
      throw new Error(`Cannot reject item in state '${item.status}'`)
    }

    const now = new Date().toISOString()
    const [updated] = await tx
      .update(purchaseRequestItems)
      .set({ status: "rejected", updatedAt: now })
      .where(and(eq(purchaseRequestItems.id, itemId), eq(purchaseRequestItems.status, item.status)))
      .returning({ id: purchaseRequestItems.id })
    if (!updated) throw new Error("El ítem ya no está disponible: posible concurrencia")

    await tx.insert(approvalDecisions).values({
      id:            nanoid(),
      requestItemId: itemId,
      requestId:     item.requestId,
      type:          "reject",
      decidedBy:     userId,
      reason,
      roleContext:   opts?.roleContext ?? null,
    })

    await recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "rejected",
      changedBy:  userId,
      reason,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   { status: "rejected" },
      reason,
    }, tx)
    await resolveReplenishmentLinksTx(tx, [itemId])
    await rollupRequestStatus(item.requestId, tx, userId)
  })
}
