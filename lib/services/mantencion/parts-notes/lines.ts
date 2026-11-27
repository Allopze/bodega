import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  mantRecordParts, mantRecords, purchaseOrderItems, purchaseOrders, purchaseRequestItems, purchaseRequests,
} from "@/db/schema"
import { roundQty } from "@/lib/services/stock-reservations"
import type { PartsNoteDetailLine, PartsNoteLineStage } from "../parts/types"
import { loadArrivedByLine } from "./arrivals"
import { allocateUsed, lineStage, type PurchaseLiveness } from "./status"

/**
 * Estado calculado de las líneas de NP: compras, lo que llegó a la faena, lo ya
 * usado y la etapa legible. UNA lectura por cada cosa para todas las líneas que se
 * piden (la bandeja, el detalle, la OT web y el catálogo del teléfono la usan con
 * muchas NP a la vez: nunca una consulta por línea).
 *
 * «Llegó» depende de la vía de la línea (`arrivals.ts`): con OT, lo que aportó su reserva; sin OT, lo que la faena
 * recibió de las OC que la compran. Lo usado sólo existe con OT (es consumo de una reserva de esa OT).
 *
 * Excepción: una nota importada de CHOME ERP que ya llegó «Cerrada» (`isImportedClosedNote`) trae sus líneas «en compra»
 * sin ninguna compra en la plataforma: el ERP dio por llegado lo pedido, así que la línea cuenta como llegada completa
 * (etapa «en bodega», llegó = cantidad). Es sólo de lectura: el estado de la nota no cambia (se deriva igual que siempre).
 */

type Reader = Pick<Tx, "select">

/** Lo mínimo de una línea para calcular su estado. */
export interface NoteLineRef {
  id: string
  noteId: string
  /** Null: nota sin OT. */
  workOrderId: string | null
  productId: string | null
  resolution: string
  sortOrder: number
  /** Creación de la NP: ordena el reparto de lo usado entre líneas del mismo repuesto. */
  noteCreatedAt: string
  /** Lo pedido en la línea: sólo hace falta si `importedClosed`. */
  quantity?: number
  /** La nota es una importada de CHOME ERP que llegó «Cerrada» (`isImportedClosedNote`). */
  importedClosed?: boolean
}

/** Nota importada de CHOME ERP (`external_ref`) cuyo estado de origen es «Cerrada»: lo pedido llegó a la faena según el ERP. */
export const isImportedClosedNote = (note: { status: string; externalRef?: string | null }): boolean => note.status === "cerrada" && !!note.externalRef

export interface NoteLineState {
  stage: PartsNoteLineStage
  /** Lo que llegó a la faena para esta línea (reserva o compra recibida, según la vía). */
  arrived: number
  /** Lo consumido de ese repuesto en registros vigentes de la OT, repartido entre sus líneas y con tope `arrived`. Sin OT: 0. */
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
  const [purchases, arrivals] = await Promise.all([loadPurchases(client, itemIds), loadArrivedByLine(client, refs)])
  const productOf = (ref: NoteLineRef) => ref.productId ?? arrivals.get(ref.id)?.productId ?? null

  const productIds = [...new Set(refs.map(productOf).filter((id): id is string => !!id))]
  const workOrderIds = [...new Set(refs.flatMap((ref) => (ref.workOrderId ? [ref.workOrderId] : [])))]
  const consumed = await loadConsumed(client, workOrderIds, productIds)
  const ordered = [...refs].sort((a, b) =>
    a.noteCreatedAt.localeCompare(b.noteCreatedAt) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  const used = allocateUsed(
    ordered.map((ref) => {
      const productId = productOf(ref)
      return {
        id: ref.id,
        key: ref.workOrderId && productId ? `${ref.workOrderId}:${productId}` : null,
        arrived: arrivals.get(ref.id)?.quantity ?? 0,
      }
    }),
    consumed,
  )

  for (const ref of refs) {
    const rows = purchases.get(ref.id) ?? []
    const liveness = rows.map((row) => ({ itemStatus: row.status, requestStatus: row.requestStatus }))
    // Importada «Cerrada»: una línea «en compra» sin ninguna compra en la plataforma llegó completa (lo dijo el ERP).
    const arrivedByImport = !!ref.importedClosed && ref.resolution === "en_compra" && rows.length === 0
    const arrived = arrivedByImport ? roundQty(ref.quantity ?? 0) : arrivals.get(ref.id)?.quantity ?? 0
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
