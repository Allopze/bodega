import { eq, inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import {
  mantPartsAllocationSources, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, purchaseRequestItems, purchaseRequests,
} from "@/db/schema"
import { OT_OPEN_STATUSES } from "@/lib/mantencion/work-order-states"
import { roundQty, toCents } from "@/lib/services/stock-reservations"
import type { NoteItemResolution, PartsNoteLineStage, PartsNoteStatus } from "../parts/types"

/**
 * Reglas puras de la nota de pedido (NP): estado de la cabecera derivado de sus
 * líneas, compras «vivas», etapa legible de una línea y reparto de lo usado.
 * Sin base de datos: las comparten el alta, la resolución y las lecturas
 * (`recalcNoteStatusTx`, al final, es lo único que escribe).
 */

/**
 * Estado de la NP según sus líneas (NP4-2, decisión 2026-11-26):
 *  - `enviada`: ninguna línea resuelta (todas pendientes);
 *  - `en_gestion`: queda una línea pendiente, o una línea «en compra» cuyo repuesto aún no llegó a la faena;
 *  - `cerrada`: toda línea está rechazada, sacada de stock o en compra ya recibida.
 * `anulada` no se deriva: la fija quien anula, y `recalcNoteStatusTx` no la toca.
 *
 * `awaitingArrival`: cuántas líneas «en compra» siguen esperando su repuesto (ver `lineAwaitsArrival`).
 * Sólo pesa cuando no queda ninguna pendiente: con una pendiente la nota ya está abierta.
 */
export function deriveNoteStatus(resolutions: readonly string[], awaitingArrival = 0): Exclude<PartsNoteStatus, "anulada"> {
  const pending = resolutions.filter((resolution) => resolution === "pendiente").length
  if (pending === resolutions.length) return "enviada"
  return pending > 0 || awaitingArrival > 0 ? "en_gestion" : "cerrada"
}

// ── Compras de una línea ────────────────────────────────────────────────────

/** Una compra «muerta» ya no va a traer nada: ítem rechazado o solicitud cancelada o rechazada (mismo criterio que `parts-requests.ts`). */
const DEAD_ITEM_STATUSES: readonly string[] = ["rejected"]
const DEAD_REQUEST_STATUSES: readonly string[] = ["cancelled", "rejected"]
/** Ítems de solicitud que Compras ya da por recibidos en faena (D10: llegan como `received` o `delivered`). */
const RECEIVED_ITEM_STATUSES: readonly string[] = ["received", "delivered"]

export interface PurchaseLiveness {
  itemStatus: string
  requestStatus: string
}

export function isDeadPurchase(purchase: PurchaseLiveness): boolean {
  return DEAD_ITEM_STATUSES.includes(purchase.itemStatus) || DEAD_REQUEST_STATUSES.includes(purchase.requestStatus)
}

/** Todas sus compras murieron (o no queda ninguna): la línea `en_compra` vuelve a poder resolverse. */
export function allPurchasesDead(purchases: readonly PurchaseLiveness[]): boolean {
  return purchases.every(isDeadPurchase)
}

/** Una línea se puede resolver (desde stock, rechazar o enlazar a otra solicitud) si está pendiente o su compra murió. */
export function isResolvableLine(resolution: string, purchases: readonly PurchaseLiveness[]): boolean {
  return resolution === "pendiente" || (resolution === "en_compra" && allPurchasesDead(purchases))
}

/**
 * Una línea «en compra» todavía espera su repuesto: su OT sigue abierta, tiene al menos una compra viva y ni lo llegado
 * cubre lo pedido ni Compras da todas sus compras vivas por recibidas. Con la OT terminada nadie espera: lo que llegue
 * ya no se reserva para ella (`addToAllocationTx`). Una línea sin compra viva no espera nada; vuelve sola a pendiente al
 * morir su compra (`unlinkNoteItemsFromRequestTx`).
 */
export function lineAwaitsArrival(input: {
  resolution: string
  quantity: number
  arrived: number
  purchases: readonly PurchaseLiveness[]
  workOrderOpen: boolean
}): boolean {
  if (input.resolution !== "en_compra" || !input.workOrderOpen) return false
  const alive = input.purchases.filter((purchase) => !isDeadPurchase(purchase))
  if (alive.length === 0) return false
  if (toCents(input.arrived) >= toCents(input.quantity)) return false
  return !alive.every((purchase) => RECEIVED_ITEM_STATUSES.includes(purchase.itemStatus))
}

/** Etapa legible de la línea para la app y la jefatura. */
export function lineStage(input: { resolution: NoteItemResolution | string; arrived: number; purchases: readonly PurchaseLiveness[] }): PartsNoteLineStage {
  switch (input.resolution) {
    case "rechazada":
      return "rechazado"
    case "desde_stock":
      return "en_bodega"
    case "en_compra":
      if (toCents(input.arrived) > 0) return "en_bodega"
      return allPurchasesDead(input.purchases) ? "pedido" : "en_compra"
    default:
      return "pedido"
  }
}

// ── Usado ───────────────────────────────────────────────────────────────────

export interface UsedShareLine {
  id: string
  /** Mismo valor = mismo repuesto de la misma OT: comparten lo consumido. */
  key: string | null
  arrived: number
}

/**
 * Reparte lo consumido de un repuesto entre las líneas que lo pidieron, EN EL
 * ORDEN RECIBIDO (la primera se llena antes) y con tope en lo que llegó a cada una.
 * `consumed` es lo descontado de ese (OT, producto) en los registros vigentes.
 */
export function allocateUsed(lines: readonly UsedShareLine[], consumed: ReadonlyMap<string, number>): Map<string, number> {
  const left = new Map<string, number>()
  const used = new Map<string, number>()
  for (const line of lines) {
    if (!line.key) { used.set(line.id, 0); continue }
    const available = left.get(line.key) ?? roundQty(consumed.get(line.key) ?? 0)
    const take = Math.max(0, Math.min(roundQty(line.arrived), available))
    used.set(line.id, roundQty(take))
    left.set(line.key, roundQty(available - take))
  }
  return used
}

// ── Escritura ───────────────────────────────────────────────────────────────

const OPEN: readonly string[] = OT_OPEN_STATUSES

/**
 * Cuántas de las líneas «en compra» esperan todavía su repuesto (`lineAwaitsArrival`). Lecturas sin bloqueo: se llama con
 * la NP ya tomada o dentro de la transacción de la línea. Dos consultas, no una por línea.
 */
async function countLinesAwaitingArrivalTx(tx: Tx, workOrderId: string, lines: ReadonlyArray<{ id: string; quantity: number }>): Promise<number> {
  if (lines.length === 0) return 0
  const [ot] = await tx.select({ status: mantWorkOrders.status }).from(mantWorkOrders).where(eq(mantWorkOrders.id, workOrderId)).limit(1)
  const workOrderOpen = !!ot && OPEN.includes(ot.status)
  if (!workOrderOpen) return 0

  const ids = lines.map((line) => line.id)
  const purchaseRows = await tx
    .select({ noteItemId: purchaseRequestItems.partsNoteItemId, itemStatus: purchaseRequestItems.status, requestStatus: purchaseRequests.status })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
    .where(inArray(purchaseRequestItems.partsNoteItemId, ids))
  const arrivalRows = await tx
    .select({ noteItemId: mantPartsAllocationSources.noteItemId, quantity: mantPartsAllocationSources.quantity })
    .from(mantPartsAllocationSources)
    .where(inArray(mantPartsAllocationSources.noteItemId, ids))

  const purchasesOf = new Map<string, PurchaseLiveness[]>()
  for (const row of purchaseRows) {
    if (!row.noteItemId) continue
    purchasesOf.set(row.noteItemId, [...(purchasesOf.get(row.noteItemId) ?? []), { itemStatus: row.itemStatus, requestStatus: row.requestStatus }])
  }
  const arrivedOf = new Map<string, number>()
  for (const row of arrivalRows) {
    if (!row.noteItemId) continue
    arrivedOf.set(row.noteItemId, roundQty((arrivedOf.get(row.noteItemId) ?? 0) + Number(row.quantity)))
  }
  return lines.filter((line) => lineAwaitsArrival({
    resolution: "en_compra", quantity: line.quantity, arrived: arrivedOf.get(line.id) ?? 0, purchases: purchasesOf.get(line.id) ?? [], workOrderOpen,
  })).length
}

/**
 * Recalcula y guarda el estado de la NP (y su `updated_at`, que mueve el ETag del catálogo). Llamar dentro de la misma
 * transacción que cambió la línea y con la OT tomada (`FOR SHARE` o `FOR UPDATE`).
 *
 * Toma la fila de la NP (`FOR NO KEY UPDATE`) ANTES de leer sus líneas: dos transacciones que resuelven líneas distintas
 * de una misma NP se serializan aquí y la segunda lee lo que la primera ya confirmó. Sin eso cada una veía la otra línea
 * todavía pendiente y la última en escribir dejaba la NP «en gestión» con todo resuelto. Es el mismo orden de siempre
 * (la línea primero, la NP después); sólo se adelanta el bloqueo que el `UPDATE` de abajo iba a tomar de todos modos.
 *
 * `onlyIfChanged`: no escribe si el estado ya es el que corresponde. Es para los barridos que no tocan ninguna línea
 * (el fin de la OT, la llegada de un repuesto): repetirlos no deja ni un `updated_at` distinto.
 */
export async function recalcNoteStatusTx(tx: Tx, noteId: string, options: { onlyIfChanged?: boolean } = {}): Promise<PartsNoteStatus> {
  const [note] = await tx
    .select({ status: mantPartsNotes.status, workOrderId: mantPartsNotes.workOrderId })
    .from(mantPartsNotes)
    .where(eq(mantPartsNotes.id, noteId))
    .limit(1)
    .for("no key update")
  if (!note) throw new Error("La nota de pedido no existe")
  if (note.status === "anulada") return "anulada"
  const items = await tx
    .select({ id: mantPartsNoteItems.id, resolution: mantPartsNoteItems.resolution, quantity: mantPartsNoteItems.quantity })
    .from(mantPartsNoteItems)
    .where(eq(mantPartsNoteItems.noteId, noteId))
  const resolutions = items.map((item) => item.resolution)
  // Con una línea pendiente la nota ya está abierta: no hace falta mirar las compras.
  const awaiting = resolutions.includes("pendiente")
    ? 0
    : await countLinesAwaitingArrivalTx(tx, note.workOrderId, items.filter((item) => item.resolution === "en_compra").map((item) => ({ id: item.id, quantity: Number(item.quantity) })))
  const next = deriveNoteStatus(resolutions, awaiting)
  if (options.onlyIfChanged && next === note.status) return next
  await tx.update(mantPartsNotes).set({ status: next, updatedAt: new Date().toISOString() }).where(eq(mantPartsNotes.id, noteId))
  return next
}

/** Lo mismo desde una línea: para quien sólo conoce el id de la línea (la llegada de un repuesto a la reserva). */
export async function recalcNoteStatusOfLineTx(tx: Tx, noteItemId: string, options: { onlyIfChanged?: boolean } = {}): Promise<void> {
  const [line] = await tx.select({ noteId: mantPartsNoteItems.noteId }).from(mantPartsNoteItems).where(eq(mantPartsNoteItems.id, noteItemId)).limit(1)
  if (line) await recalcNoteStatusTx(tx, line.noteId, options)
}
