/**
 * Núcleo de reservas de repuestos por OT (ADR mantención 0001, 2026-11-26).
 *
 * Una reserva activa por (OT, faena, producto). Los cálculos viven en
 * `lib/services/stock-reservations.ts`; aquí, las escrituras: aportar, rebajar,
 * liberar, consumir y revertir.
 *
 * ORDEN GLOBAL DE BLOQUEO (no lo rompas: es lo que impide los deadlocks):
 *   equipo → OT (`FOR UPDATE` en registro y transiciones; `FOR SHARE` ordenado
 *   por id en recepción, guía, NP y anulaciones) → faena (`FOR SHARE`) → filas
 *   de `worksite_stock` ordenadas por `product_id` (`FOR UPDATE`) → reservas.
 *
 * La fila (faena, producto) de `worksite_stock` es el mutex de las reservas de ese
 * par: ninguna reserva se lee para decidir ni se escribe sin tenerla bloqueada
 * (`lockForStockTx`), salvo la liberación al cerrar la OT, que sólo agranda lo
 * libre y ya corre con la OT bloqueada `FOR UPDATE`.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import {
  mantPartsAllocations, mantPartsAllocationSources, mantRecordParts, mantRecords,
  mantWorkOrderEvents, mantWorkOrders, worksites, worksiteStock,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { OT_OPEN_STATUSES } from "@/lib/mantencion/work-order-states"
import { activeReservationsTx, remainingSql, roundQty, toCents } from "@/lib/services/stock-reservations"
import type { AllocationShrinkSource, AllocationSource } from "./types"

type Reader = Pick<Tx, "select">

const OPEN = OT_OPEN_STATUSES as readonly string[]

// ── Bloqueo ─────────────────────────────────────────────────────────────────

export type StockLocks = {
  workOrders: Map<string, { status: string; folio: string }>
  worksite: { name: string; isActive: boolean } | null
  /** Cantidad de cada fila (faena, producto) bloqueada, redondeada a centésimas. */
  stock: Map<string, number>
}

/**
 * Toma los bloqueos en el orden global: OT (`FOR SHARE`, por id) → faena
 * (`FOR SHARE`) → filas de stock (aseguradas con `INSERT … ON CONFLICT DO NOTHING`
 * y bloqueadas `FOR UPDATE` por `product_id`). Una OT que la transacción ya tiene
 * `FOR UPDATE` no espera. Llamarla dos veces en la misma transacción es inocuo.
 *
 * Asegurar la fila antes de bloquearla importa: sin fila, `FOR UPDATE` no bloquea
 * nada (Postgres no tiene bloqueos de rango) y dos primeras recepciones
 * concurrentes no quedarían serializadas.
 */
export async function lockForStockTx(tx: Tx, input: {
  workOrderIds?: readonly string[]
  worksiteId: string
  productIds: readonly string[]
}): Promise<StockLocks> {
  const workOrders = new Map<string, { status: string; folio: string }>()
  const otIds = [...new Set(input.workOrderIds ?? [])].sort()
  if (otIds.length > 0) {
    const rows = await tx
      .select({ id: mantWorkOrders.id, status: mantWorkOrders.status, folio: mantWorkOrders.folio })
      .from(mantWorkOrders)
      .where(inArray(mantWorkOrders.id, otIds))
      .orderBy(asc(mantWorkOrders.id))
      .for("share")
    for (const row of rows) workOrders.set(row.id, { status: row.status, folio: row.folio })
  }

  const [worksite] = await tx
    .select({ name: worksites.name, isActive: worksites.isActive })
    .from(worksites)
    .where(eq(worksites.id, input.worksiteId))
    .for("share")
    .limit(1)

  const stock = new Map<string, number>()
  const productIds = [...new Set(input.productIds)].sort()
  if (worksite && productIds.length > 0) {
    if (worksite.isActive) {
      const now = new Date().toISOString()
      await tx.insert(worksiteStock)
        .values(productIds.map((productId) => ({ id: nanoid(), worksiteId: input.worksiteId, productId, quantity: 0, updatedAt: now })))
        .onConflictDoNothing({ target: [worksiteStock.worksiteId, worksiteStock.productId] })
    }
    const rows = await tx
      .select({ productId: worksiteStock.productId, quantity: worksiteStock.quantity })
      .from(worksiteStock)
      .where(and(eq(worksiteStock.worksiteId, input.worksiteId), inArray(worksiteStock.productId, productIds)))
      .orderBy(asc(worksiteStock.productId))
      .for("update")
    for (const row of rows) stock.set(row.productId, roundQty(Number(row.quantity)))
  }
  return { workOrders, worksite: worksite ?? null, stock }
}

// ── Lecturas bajo bloqueo ───────────────────────────────────────────────────

/** Restante de una reserva (0 si está liberada o no existe). */
export async function allocationRemainingTx(tx: Reader, allocationId: string): Promise<number> {
  const [row] = await tx
    .select({ remaining: remainingSql })
    .from(mantPartsAllocations)
    .where(eq(mantPartsAllocations.id, allocationId))
    .limit(1)
  return roundQty(Number(row?.remaining ?? 0))
}

/** Stock libre de (faena, producto): stock − Σ restante de las reservas activas, nunca negativo. Exige `lockForStockTx`. */
export async function freeStockTx(tx: Tx, worksiteId: string, productId: string): Promise<number> {
  const [row] = await tx
    .select({ quantity: worksiteStock.quantity })
    .from(worksiteStock)
    .where(and(eq(worksiteStock.worksiteId, worksiteId), eq(worksiteStock.productId, productId)))
    .limit(1)
  const stock = roundQty(Number(row?.quantity ?? 0))
  const reservations = await activeReservationsTx(tx, worksiteId, productId)
  const reserved = reservations.reduce((sum, item) => sum + item.remaining, 0)
  return Math.max(0, roundQty(stock - reserved))
}

// ── Aportar y rebajar ───────────────────────────────────────────────────────

/**
 * Suma `quantity` a la reserva activa de (OT, faena, producto), creándola si no
 * existe, y deja la fila de origen y el evento `parts_allocated` de la OT.
 * Devuelve `null` (sin reserva: el stock queda libre) si la OT ya está cerrada o
 * anulada. Exige `lockForStockTx` con la OT y el producto.
 */
export async function addToAllocationTx(tx: Tx, input: {
  workOrderId: string
  worksiteId: string
  productId: string
  quantity: number
  source: AllocationSource
  noteItemId?: string | null
  requestItemId?: string | null
  receiptId?: string | null
  dispatchGuideId?: string | null
  actorUserId: string
  userEmail?: string
  reason?: string | null
}): Promise<{ allocationId: string } | null> {
  const quantity = roundQty(input.quantity)
  if (toCents(quantity) <= 0) throw new Error("La cantidad a reservar debe ser mayor que cero")

  const [ot] = await tx
    .select({ status: mantWorkOrders.status, folio: mantWorkOrders.folio, worksiteId: mantWorkOrders.worksiteId })
    .from(mantWorkOrders)
    .where(eq(mantWorkOrders.id, input.workOrderId))
    .limit(1)
  if (!ot || !OPEN.includes(ot.status)) return null

  const now = new Date().toISOString()
  const [existing] = await tx
    .select({ id: mantPartsAllocations.id })
    .from(mantPartsAllocations)
    .where(and(
      eq(mantPartsAllocations.workOrderId, input.workOrderId),
      eq(mantPartsAllocations.worksiteId, input.worksiteId),
      eq(mantPartsAllocations.productId, input.productId),
      eq(mantPartsAllocations.status, "activa"),
    ))
    .limit(1)

  let allocationId: string
  if (existing) {
    allocationId = existing.id
    await tx.update(mantPartsAllocations)
      .set({ quantity: sql`${mantPartsAllocations.quantity} + ${quantity}`, updatedAt: now })
      .where(eq(mantPartsAllocations.id, allocationId))
  } else {
    allocationId = nanoid()
    await tx.insert(mantPartsAllocations).values({
      id: allocationId,
      workOrderId: input.workOrderId,
      worksiteId: input.worksiteId,
      productId: input.productId,
      quantity,
      createdByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    })
  }

  await tx.insert(mantPartsAllocationSources).values({
    id: nanoid(),
    allocationId,
    source: input.source,
    quantity,
    noteItemId: input.noteItemId ?? null,
    requestItemId: input.requestItemId ?? null,
    receiptId: input.receiptId ?? null,
    dispatchGuideId: input.dispatchGuideId ?? null,
    actorUserId: input.actorUserId,
    reason: input.reason ?? null,
  })
  await tx.insert(mantWorkOrderEvents).values({
    id: nanoid(),
    workOrderId: input.workOrderId,
    type: "parts_allocated",
    changeSet: { allocationId, productId: input.productId, worksiteId: input.worksiteId, quantity, source: input.source },
    actorUserId: input.actorUserId,
  })
  await recordAudit({
    userId: input.actorUserId,
    userEmail: input.userEmail,
    action: "create",
    entityType: "mant_parts_allocation",
    entityId: allocationId,
    entityCode: ot.folio,
    newState: { workOrderId: input.workOrderId, productId: input.productId, quantity, source: input.source },
    worksiteId: input.worksiteId,
  }, tx)
  return { allocationId }
}

async function consumerOf(tx: Reader, allocationId: string): Promise<string> {
  const [row] = await tx
    .select({ recordFolio: mantRecords.folio, workOrderFolio: mantWorkOrders.folio })
    .from(mantRecordParts)
    .innerJoin(mantRecords, eq(mantRecords.id, mantRecordParts.recordId))
    .innerJoin(mantPartsAllocations, eq(mantPartsAllocations.id, mantRecordParts.allocationId))
    .innerJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsAllocations.workOrderId))
    .where(and(eq(mantRecordParts.allocationId, allocationId), eq(mantRecordParts.stockStatus, "descontado")))
    .orderBy(desc(mantRecords.receivedAt))
    .limit(1)
  if (!row) return "Ya se usó en una orden de trabajo."
  return `Ya se usó en el registro ${row.recordFolio ?? "sin folio"} de la OT ${row.workOrderFolio}.`
}

/**
 * Rebaja las reservas que aportó una recepción o una guía al anularse (o al cotejar
 * una diferencia). Si lo aportado ya se usó, rechaza con un mensaje que nombra el
 * registro y la OT. Llamar ANTES del movimiento de stock (`egreso_anulacion`), para
 * que la guarda del motor ya vea la reserva rebajada. Exige `lockForStockTx`.
 */
export async function shrinkAllocationsForSourceTx(tx: Tx, input: {
  receiptId?: string | null
  dispatchGuideId?: string | null
  productId: string
  /** Cuánto se anula de ese producto; se rebaja hasta lo que esa fuente aportó. */
  quantity: number
  source: AllocationShrinkSource
  actorUserId: string
  reason: string
}): Promise<{ shrunk: number }> {
  if (!input.receiptId === !input.dispatchGuideId) throw new Error("Indica una recepción o una guía, no ambas")
  const bySource = input.receiptId
    ? eq(mantPartsAllocationSources.receiptId, input.receiptId)
    : eq(mantPartsAllocationSources.dispatchGuideId, input.dispatchGuideId as string)
  const contributions = await tx
    .select({
      allocationId: mantPartsAllocationSources.allocationId,
      contributed: sql<number>`sum(${mantPartsAllocationSources.quantity})`.mapWith(Number),
    })
    .from(mantPartsAllocationSources)
    .innerJoin(mantPartsAllocations, eq(mantPartsAllocations.id, mantPartsAllocationSources.allocationId))
    .where(and(bySource, eq(mantPartsAllocations.productId, input.productId), eq(mantPartsAllocations.status, "activa")))
    .groupBy(mantPartsAllocationSources.allocationId)
    .orderBy(asc(mantPartsAllocationSources.allocationId))

  let pending = roundQty(input.quantity)
  let shrunk = 0
  for (const row of contributions) {
    if (toCents(pending) <= 0) break
    const contributed = roundQty(Number(row.contributed))
    if (toCents(contributed) <= 0) continue
    const cut = roundQty(Math.min(contributed, pending))
    const remaining = await allocationRemainingTx(tx, row.allocationId)
    if (toCents(remaining) < toCents(cut)) throw new Error(await consumerOf(tx, row.allocationId))
    await tx.update(mantPartsAllocations)
      .set({ quantity: sql`${mantPartsAllocations.quantity} - ${cut}`, updatedAt: new Date().toISOString() })
      .where(eq(mantPartsAllocations.id, row.allocationId))
    await tx.insert(mantPartsAllocationSources).values({
      id: nanoid(),
      allocationId: row.allocationId,
      source: input.source,
      quantity: -cut,
      receiptId: input.receiptId ?? null,
      dispatchGuideId: input.dispatchGuideId ?? null,
      actorUserId: input.actorUserId,
      reason: input.reason,
    })
    pending = roundQty(pending - cut)
    shrunk = roundQty(shrunk + cut)
  }
  return { shrunk }
}
