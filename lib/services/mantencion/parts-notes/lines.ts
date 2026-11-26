import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  mantPartsAllocations, mantPartsAllocationSources, mantRecordParts, mantRecords, purchaseOrderItems, purchaseOrders,
  purchaseRequestItems, purchaseRequests,
} from "@/db/schema"
import { roundQty } from "@/lib/services/stock-reservations"
import type { PartsNoteDetailLine, PartsNoteLineStage } from "../parts/types"
import { allocateUsed, lineStage, type PurchaseLiveness } from "./status"

/**
 * Estado calculado de las líneas de NP: compras, lo que llegó a la faena, lo ya
 * usado y la etapa legible. UNA lectura por cada cosa para todas las líneas que se
 * piden (la bandeja, el detalle, la OT web y el catálogo del teléfono la usan con
 * muchas NP a la vez: nunca una consulta por línea).
 */

type Reader = Pick<Tx, "select">

/** Lo mínimo de una línea para calcular su estado. */
export interface NoteLineRef {
  id: string
  noteId: string
  workOrderId: string
  productId: string | null
  resolution: string
  sortOrder: number
  /** Creación de la NP: ordena el reparto de lo usado entre líneas del mismo repuesto. */
  noteCreatedAt: string
}

export interface NoteLineState {
  stage: PartsNoteLineStage
  /** Σ de lo reservado para esta línea (`mant_parts_allocation_sources.note_item_id`). */
  arrived: number
  /** Lo consumido de ese repuesto en registros vigentes de la OT, repartido entre sus líneas y con tope `arrived`. */
  used: number
  purchases: PartsNoteDetailLine["purchases"]
  /** Estado de cada compra tal como lo ve `allPurchasesDead` (incluye la solicitud). */
  liveness: PurchaseLiveness[]
  /** Producto de la línea; si no lo trae, el de la reserva que la atendió. */
  productId: string | null
}

export type PurchaseRow = PartsNoteDetailLine["purchases"][number] & { noteItemId: string; requestStatus: string }

/** Compras (ítems de solicitud) que apuntan a cada línea, con su solicitud y su OC activa. */
export async function loadPurchases(client: Reader, itemIds: readonly string[]): Promise<Map<string, PurchaseRow[]>> {
  if (itemIds.length === 0) return new Map()
  const rows = await client
    .select({
      noteItemId: purchaseRequestItems.partsNoteItemId,
      requestItemId: purchaseRequestItems.id,
      status: purchaseRequestItems.status,
      requestId: purchaseRequests.id,
      requestCode: purchaseRequests.code,
      requestStatus: purchaseRequests.status,
      orderId: purchaseOrders.id,
      orderCode: purchaseOrders.code,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
    // «Su OC activa»: la línea de OC vigente en una OC que no está cancelada ni borrada.
    .leftJoin(purchaseOrderItems, and(eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id), eq(purchaseOrderItems.status, "issued")))
    .leftJoin(purchaseOrders, and(eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId), isNull(purchaseOrders.deletedAt), ne(purchaseOrders.status, "cancelled")))
    .where(inArray(purchaseRequestItems.partsNoteItemId, [...itemIds]))
    .orderBy(asc(purchaseRequestItems.createdAt), asc(purchaseRequestItems.id))

  // Un ítem con una línea de OC cancelada y otra vigente sale dos veces: gana la que tiene OC.
  const byItem = new Map<string, PurchaseRow>()
  for (const row of rows) {
    if (!row.noteItemId) continue
    const current = byItem.get(row.requestItemId)
    if (!current || (!current.orderId && row.orderId)) byItem.set(row.requestItemId, { ...row, noteItemId: row.noteItemId })
  }
  const result = new Map<string, PurchaseRow[]>()
  for (const row of byItem.values()) result.set(row.noteItemId, [...(result.get(row.noteItemId) ?? []), row])
  return result
}

async function loadArrivals(client: Reader, itemIds: readonly string[]): Promise<Map<string, { quantity: number; productId: string }>> {
  const rows = await client
    .select({
      noteItemId: mantPartsAllocationSources.noteItemId,
      quantity: mantPartsAllocationSources.quantity,
      productId: mantPartsAllocations.productId,
    })
    .from(mantPartsAllocationSources)
    .innerJoin(mantPartsAllocations, eq(mantPartsAllocations.id, mantPartsAllocationSources.allocationId))
    .where(inArray(mantPartsAllocationSources.noteItemId, [...itemIds]))
  const arrivals = new Map<string, { quantity: number; productId: string }>()
  for (const row of rows) {
    if (!row.noteItemId) continue
    const current = arrivals.get(row.noteItemId)
    arrivals.set(row.noteItemId, { quantity: roundQty((current?.quantity ?? 0) + Number(row.quantity)), productId: current?.productId ?? row.productId })
  }
  return arrivals
}

/** Lo descontado por (OT, producto) en registros vigentes. */
async function loadConsumed(client: Reader, workOrderIds: readonly string[], productIds: readonly string[]): Promise<Map<string, number>> {
  if (workOrderIds.length === 0 || productIds.length === 0) return new Map()
  const rows = await client
    .select({
      workOrderId: mantRecords.workOrderId,
      productId: mantRecordParts.productId,
      quantity: sql<number>`sum(${mantRecordParts.quantity})`.mapWith(Number),
    })
    .from(mantRecordParts)
    .innerJoin(mantRecords, eq(mantRecords.id, mantRecordParts.recordId))
    .where(and(
      inArray(mantRecords.workOrderId, [...workOrderIds]),
      inArray(mantRecordParts.productId, [...productIds]),
      eq(mantRecordParts.stockStatus, "descontado"),
      eq(mantRecords.status, "vigente"),
    ))
    .groupBy(mantRecords.workOrderId, mantRecordParts.productId)
  return new Map(rows.map((row) => [`${row.workOrderId}:${row.productId}`, roundQty(Number(row.quantity))]))
}

export async function loadLineStates(refs: readonly NoteLineRef[], client: Reader = db): Promise<Map<string, NoteLineState>> {
  const states = new Map<string, NoteLineState>()
  if (refs.length === 0) return states
  const itemIds = refs.map((ref) => ref.id)
  const [purchases, arrivals] = await Promise.all([loadPurchases(client, itemIds), loadArrivals(client, itemIds)])
  const productOf = (ref: NoteLineRef) => ref.productId ?? arrivals.get(ref.id)?.productId ?? null

  const productIds = [...new Set(refs.map(productOf).filter((id): id is string => !!id))]
  const consumed = await loadConsumed(client, [...new Set(refs.map((ref) => ref.workOrderId))], productIds)
  const ordered = [...refs].sort((a, b) =>
    a.noteCreatedAt.localeCompare(b.noteCreatedAt) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  const used = allocateUsed(
    ordered.map((ref) => {
      const productId = productOf(ref)
      return { id: ref.id, key: productId ? `${ref.workOrderId}:${productId}` : null, arrived: arrivals.get(ref.id)?.quantity ?? 0 }
    }),
    consumed,
  )

  for (const ref of refs) {
    const rows = purchases.get(ref.id) ?? []
    const liveness = rows.map((row) => ({ itemStatus: row.status, requestStatus: row.requestStatus }))
    const arrived = arrivals.get(ref.id)?.quantity ?? 0
    states.set(ref.id, {
      stage: lineStage({ resolution: ref.resolution, arrived, purchases: liveness }),
      arrived,
      used: used.get(ref.id) ?? 0,
      purchases: rows.map(({ requestItemId, requestId, requestCode, status, orderId, orderCode }) => ({ requestItemId, requestId, requestCode, status, orderId, orderCode })),
      liveness,
      productId: productOf(ref),
    })
  }
  return states
}
