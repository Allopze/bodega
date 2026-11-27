import { and, eq, inArray, isNull, ne } from "drizzle-orm"
import type { Tx } from "@/db"
import {
  mantPartsAllocations, mantPartsAllocationSources, purchaseOrderItems, purchaseOrders, purchaseRequestItems,
} from "@/db/schema"
import { roundQty } from "@/lib/services/stock-reservations"

/**
 * «Llegó» de cada línea de nota de pedido (NP), por la vía que le corresponde (ADR 0001, 2026-11-27):
 *  - Con OT: lo que aportó a su reserva (`mant_parts_allocation_sources.note_item_id`, Σ con rebajas). Igual que siempre.
 *  - Sin OT: lo que la faena recibió de las OC que la compran (Σ `purchase_order_items.quantity_received`, la
 *    recepción en FAENA, no la de oficina). No hay reserva: lo recibido entra a stock libre de la faena.
 * Lectura sin bloqueo: sirve para decidir el estado con la misma regla en todos los caminos.
 */

type Reader = Pick<Tx, "select">

export interface ArrivalLineRef {
  id: string
  /** Null = línea sin OT: su llegada sale de las OC. */
  workOrderId: string | null
}

/** Σ de los aportes a la reserva de cada línea con OT, y el repuesto de esa reserva. */
export async function loadAllocationArrivals(client: Reader, itemIds: readonly string[]): Promise<Map<string, { quantity: number; productId: string }>> {
  const arrivals = new Map<string, { quantity: number; productId: string }>()
  if (itemIds.length === 0) return arrivals
  const rows = await client
    .select({
      noteItemId: mantPartsAllocationSources.noteItemId,
      quantity: mantPartsAllocationSources.quantity,
      productId: mantPartsAllocations.productId,
    })
    .from(mantPartsAllocationSources)
    .innerJoin(mantPartsAllocations, eq(mantPartsAllocations.id, mantPartsAllocationSources.allocationId))
    .where(inArray(mantPartsAllocationSources.noteItemId, [...itemIds]))
  for (const row of rows) {
    if (!row.noteItemId) continue
    const current = arrivals.get(row.noteItemId)
    arrivals.set(row.noteItemId, { quantity: roundQty((current?.quantity ?? 0) + Number(row.quantity)), productId: current?.productId ?? row.productId })
  }
  return arrivals
}

/**
 * Σ de lo que la faena recibió de las OC vivas que compran cada línea (`purchase_request_items.parts_note_item_id`).
 * Una OC cancelada o borrada no cuenta.
 */
export async function loadOrderArrivals(client: Reader, itemIds: readonly string[]): Promise<Map<string, number>> {
  const arrived = new Map<string, number>()
  if (itemIds.length === 0) return arrived
  const rows = await client
    .select({ noteItemId: purchaseRequestItems.partsNoteItemId, quantity: purchaseOrderItems.quantityReceived })
    .from(purchaseOrderItems)
    .innerJoin(purchaseRequestItems, eq(purchaseRequestItems.id, purchaseOrderItems.requestItemId))
    .innerJoin(purchaseOrders, and(eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId), isNull(purchaseOrders.deletedAt), ne(purchaseOrders.status, "cancelled")))
    .where(inArray(purchaseRequestItems.partsNoteItemId, [...itemIds]))
  for (const row of rows) {
    if (!row.noteItemId) continue
    arrived.set(row.noteItemId, roundQty((arrived.get(row.noteItemId) ?? 0) + Number(row.quantity)))
  }
  return arrived
}

/**
 * Lo que llegó a la faena para cada línea, con la vía de cada una (OT o sin OT). Las líneas sin OT no tienen reserva ni
 * repuesto de reserva: su repuesto sale de la línea misma (`productOf` en `lines.ts`).
 */
export async function loadArrivedByLine(client: Reader, lines: readonly ArrivalLineRef[]): Promise<Map<string, { quantity: number; productId: string | null }>> {
  const withOt = lines.filter((line) => line.workOrderId).map((line) => line.id)
  const withoutOt = lines.filter((line) => !line.workOrderId).map((line) => line.id)
  const [allocation, orders] = await Promise.all([loadAllocationArrivals(client, withOt), loadOrderArrivals(client, withoutOt)])
  const arrived = new Map<string, { quantity: number; productId: string | null }>()
  for (const [id, row] of allocation) arrived.set(id, { quantity: row.quantity, productId: row.productId })
  for (const [id, quantity] of orders) arrived.set(id, { quantity, productId: null })
  return arrived
}
