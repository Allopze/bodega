/**
 * Consumo de repuestos desde el registro del mecánico y su reverso al anularlo
 * (ADR mantención 0001). Orden de bloqueo en `allocations.ts`.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { inventoryMovements, mantPartsAllocations, mantRecordParts, mantRecords, products, worksiteStock } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { requiresWholeQuantity } from "@/lib/utils"
import { applyMovementTx } from "@/lib/services/stock-movement"
import { activeReservationsTx, remainingSql, roundQty, toCents } from "@/lib/services/stock-reservations"
import { lockForStockTx } from "./allocations"
import {
  MANT_CONSUMPTION_REFERENCE, MANT_CONSUMPTION_REVERSAL_REFERENCE, PartsValidationError,
  type ConsumePartInput, type ConsumePartResult,
} from "./types"

function formatQty(quantity: number): string {
  return roundQty(quantity).toLocaleString("es-CL", { maximumFractionDigits: 2 })
}

/**
 * Descuenta un repuesto usado en el registro (D6: nunca rechaza el registro por
 * stock). Corre dentro de la transacción del registro, con la OT ya bloqueada
 * `FOR UPDATE`, y ANTES de insertar la línea (que guarda el `movementId`).
 *
 * - Datos inválidos (no es repuesto, reserva de otra OT u otro repuesto, unidad
 *   fraccionaria en un repuesto entero) → `PartsValidationError` (422).
 * - Falta de stock, faena inactiva o cualquier error del motor → `pendiente_conciliar`
 *   con su motivo, sin movimiento. El movimiento corre en un savepoint para que un
 *   error no aborte la transacción del registro.
 *
 * Faena: la de la reserva (la OT sigue al equipo en un traslado, la reserva no);
 * sin reserva, la del registro. Si la línea pide más de lo reservado, el exceso
 * sale del stock libre y la línea igual queda enlazada a la reserva.
 */
export async function consumePartTx(tx: Tx, input: ConsumePartInput): Promise<ConsumePartResult> {
  const [product] = await tx
    .select({ isSparePart: products.isSparePart, unit: products.unitOfMeasure, name: products.name })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1)
  if (!product?.isSparePart) throw new PartsValidationError("Ese producto no es un repuesto del catálogo.", "productId")
  const quantity = roundQty(input.quantity)
  if (toCents(quantity) <= 0) throw new PartsValidationError("La cantidad debe ser mayor que cero.", "quantity")
  if (requiresWholeQuantity(product.unit) && toCents(quantity) % 100 !== 0) {
    throw new PartsValidationError(`${product.name} va en unidades enteras.`, "quantity")
  }

  const allocation = await resolveAllocation(tx, input)
  const worksiteId = allocation?.worksiteId ?? input.recordWorksiteId
  const allocationId = allocation?.id ?? null
  const locks = await lockForStockTx(tx, { workOrderIds: [input.workOrderId], worksiteId, productIds: [input.productId] })
  if (!locks.worksite?.isActive) {
    const note = locks.worksite ? `La faena ${locks.worksite.name} no está activa.` : "La faena del repuesto no existe."
    return { status: "pendiente_conciliar", allocationId, worksiteId, note }
  }

  const stock = locks.stock.get(input.productId) ?? 0
  const reservations = await activeReservationsTx(tx, worksiteId, input.productId)
  const othersReserved = roundQty(reservations.filter((row) => row.allocationId !== allocationId).reduce((sum, row) => sum + row.remaining, 0))
  const available = roundQty(stock - othersReserved)
  if (toCents(quantity) > toCents(available)) {
    const missing = roundQty(quantity - Math.max(available, 0))
    return { status: "pendiente_conciliar", allocationId, worksiteId, note: `Faltaban ${formatQty(missing)} en la bodega de ${locks.worksite.name} al sincronizar.` }
  }

  const otFolio = locks.workOrders.get(input.workOrderId)?.folio ?? ""
  const movementId = nanoid()
  const delta = toCents(quantity) === toCents(stock) ? -(await exactStockTx(tx, worksiteId, input.productId)) : -quantity
  try {
    await tx.transaction(async (sp) => {
      await applyMovementTx(sp as unknown as Tx, {
        worksiteId,
        productId: input.productId,
        type: "egreso_mantencion",
        quantity: delta,
        referenceType: MANT_CONSUMPTION_REFERENCE,
        referenceId: input.recordId,
        performedBy: input.actorUserId,
        userEmail: input.userEmail,
        movementId,
        notes: `Uso en la OT ${otFolio}`,
      })
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: "pendiente_conciliar", allocationId, worksiteId, note: message.slice(0, 300) }
  }
  return { status: "descontado", movementId, allocationId, worksiteId }
}

/**
 * Valor exacto guardado (float4 ensanchado a float8). Si la línea se lleva todo lo
 * que hay, se descuenta este valor y no el redondeado: con `0.7` guardado como
 * `0.69999999`, restar `0.7` daría negativo y el motor lo rechazaría.
 */
async function exactStockTx(tx: Tx, worksiteId: string, productId: string): Promise<number> {
  const [row] = await tx
    .select({ quantity: sql<number>`${worksiteStock.quantity}::float8`.mapWith(Number) })
    .from(worksiteStock)
    .where(and(eq(worksiteStock.worksiteId, worksiteId), eq(worksiteStock.productId, productId)))
    .limit(1)
  return Number(row?.quantity ?? 0)
}

async function resolveAllocation(tx: Tx, input: ConsumePartInput): Promise<{ id: string; worksiteId: string } | null> {
  if (input.allocationId) {
    const [chosen] = await tx
      .select({ id: mantPartsAllocations.id, workOrderId: mantPartsAllocations.workOrderId, productId: mantPartsAllocations.productId, worksiteId: mantPartsAllocations.worksiteId, status: mantPartsAllocations.status })
      .from(mantPartsAllocations)
      .where(eq(mantPartsAllocations.id, input.allocationId))
      .limit(1)
    if (!chosen || chosen.workOrderId !== input.workOrderId || chosen.productId !== input.productId) {
      throw new PartsValidationError("Esa reserva es de otra orden de trabajo o de otro repuesto.", "allocationId")
    }
    // Una reserva ya liberada (catálogo viejo en el teléfono) no es un error: se busca la vigente.
    if (chosen.status === "activa") return { id: chosen.id, worksiteId: chosen.worksiteId }
  }
  const candidates = await tx
    .select({ id: mantPartsAllocations.id, worksiteId: mantPartsAllocations.worksiteId, remaining: remainingSql })
    .from(mantPartsAllocations)
    .where(and(
      eq(mantPartsAllocations.workOrderId, input.workOrderId),
      eq(mantPartsAllocations.productId, input.productId),
      eq(mantPartsAllocations.status, "activa"),
    ))
    .orderBy(asc(mantPartsAllocations.createdAt))
  if (candidates.length === 0) return null
  const sameSite = candidates.find((row) => row.worksiteId === input.recordWorksiteId)
  if (sameSite) return { id: sameSite.id, worksiteId: sameSite.worksiteId }
  const largest = [...candidates].sort((a, b) => Number(b.remaining) - Number(a.remaining))[0]!
  return { id: largest.id, worksiteId: largest.worksiteId }
}

/**
 * Al anular un registro: repone (`ingreso_anulacion`, en la faena del movimiento
 * original) cada línea `descontado` → `revertido`, y cierra las `pendiente_conciliar`
 * como `sin_movimiento`. El registro ya viene bloqueado por quien llama
 * (orden registro → OT → faena → stock).
 */
export async function reverseRecordPartsTx(tx: Tx, input: {
  recordId: string
  actorUserId: string
  userEmail?: string
  reason: string
}): Promise<{ reversed: number; closedPending: number }> {
  const [record] = await tx
    .select({ workOrderId: mantRecords.workOrderId })
    .from(mantRecords)
    .where(eq(mantRecords.id, input.recordId))
    .limit(1)
  const lines = await tx
    .select({
      id: mantRecordParts.id,
      productId: mantRecordParts.productId,
      stockStatus: mantRecordParts.stockStatus,
      movementId: mantRecordParts.inventoryMovementId,
    })
    .from(mantRecordParts)
    .where(and(eq(mantRecordParts.recordId, input.recordId), inArray(mantRecordParts.stockStatus, ["descontado", "pendiente_conciliar"])))
    .orderBy(asc(mantRecordParts.id))
    .for("update")

  const pending = lines.filter((line) => line.stockStatus === "pendiente_conciliar")
  if (pending.length > 0) {
    await tx.update(mantRecordParts)
      .set({ stockStatus: "sin_movimiento", stockNote: "Registro anulado antes de conciliar." })
      .where(inArray(mantRecordParts.id, pending.map((line) => line.id)))
  }

  const discounted = lines.filter((line) => line.stockStatus === "descontado" && line.movementId)
  if (discounted.length === 0) return { reversed: 0, closedPending: pending.length }
  const movements = await tx
    .select({ id: inventoryMovements.id, worksiteId: inventoryMovements.worksiteId, productId: inventoryMovements.productId, quantity: inventoryMovements.quantity })
    .from(inventoryMovements)
    .where(inArray(inventoryMovements.id, discounted.map((line) => line.movementId as string)))
  const byId = new Map(movements.map((movement) => [movement.id, movement]))

  const byWorksite = new Map<string, typeof discounted>()
  for (const line of discounted) {
    const movement = byId.get(line.movementId as string)
    if (!movement) throw new Error("No se encontró el movimiento de stock de una línea del registro")
    byWorksite.set(movement.worksiteId, [...(byWorksite.get(movement.worksiteId) ?? []), line])
  }

  for (const [worksiteId, siteLines] of [...byWorksite.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const productIds = siteLines.map((line) => byId.get(line.movementId as string)!.productId)
    const locks = await lockForStockTx(tx, { workOrderIds: record?.workOrderId ? [record.workOrderId] : [], worksiteId, productIds })
    if (!locks.worksite?.isActive) {
      throw new Error(`La faena ${locks.worksite?.name ?? ""} está cerrada: no se puede reponer el repuesto del registro. Avisa a bodega.`)
    }
    for (const line of siteLines) {
      const movement = byId.get(line.movementId as string)!
      const reversalId = nanoid()
      await applyMovementTx(tx, {
        worksiteId,
        productId: movement.productId,
        type: "ingreso_anulacion",
        quantity: Math.abs(Number(movement.quantity)),
        referenceType: MANT_CONSUMPTION_REVERSAL_REFERENCE,
        referenceId: input.recordId,
        performedBy: input.actorUserId,
        userEmail: input.userEmail,
        movementId: reversalId,
        reason: input.reason,
      })
      await tx.update(mantRecordParts)
        .set({ stockStatus: "revertido", reversalMovementId: reversalId })
        .where(eq(mantRecordParts.id, line.id))
    }
  }
  return { reversed: discounted.length, closedPending: pending.length }
}
