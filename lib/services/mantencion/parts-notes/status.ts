import { desc, eq, inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantPartsNoteEvents, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { isPartsNoteOpen } from "@/lib/mantencion/contracts"
import { OT_OPEN_STATUSES } from "@/lib/mantencion/work-order-states"
import { roundQty, toCents } from "@/lib/services/stock-reservations"
import type { NoteItemResolution, PartsNoteLineStage, PartsNoteStatus } from "../parts/types"
import { loadArrivedByLine } from "./arrivals"
import { setNoteStatusTx } from "./set-status"

/**
 * Reglas de la nota de pedido (NP): estado de la cabecera derivado de sus líneas, compras «vivas», etapa legible de una
 * línea y reparto de lo usado. La única escritura es `recalcNoteStatusTx`, que delega en `setNoteStatusTx`.
 *
 * Estados derivados (ADR 0001, NP4-2 y 2026-11-27):
 *  - `enviada`: todas pendientes y nadie la aceptó; `aceptada`: todas pendientes y alguien la aceptó;
 *  - `en_gestion`: hay pendientes y líneas resueltas;
 *  - `en_compra`: ninguna pendiente, alguna línea espera su compra y todavía no llegó nada;
 *  - `recibida_parcial`: ninguna pendiente, alguna espera su compra y algo ya llegó a la faena;
 *  - `rechazada`: todas las líneas rechazadas; `cerrada`: lo demás, todo lo no rechazado llegó.
 * `en_espera` y `anulada` no se derivan: los fija quien actúa. Mientras la NP está en espera el derivado queda congelado
 * (`recalcNoteStatusTx` no la toca salvo con `force`).
 *
 * «Aceptada» se deriva del HISTORIAL (`noteWasAccepted`), no del estado de hoy: si alguien aceptó la nota y después todas sus
 * líneas vuelven a pendiente (una compra que murió, una reserva que se liberó) sigue aceptada y no «enviada». Sólo una
 * reapertura (salir de «cerrada» o «rechazada») borra la aceptación.
 */

/** Estados que puede dar el derivado (sin los que fija una persona). */
export type DerivedNoteStatus = Exclude<PartsNoteStatus, "anulada" | "en_espera">

/** Estados en que la NP sigue abierta: ni cerrada, ni rechazada, ni anulada. */
export const OPEN_NOTE_STATUSES: readonly PartsNoteStatus[] = ["enviada", "aceptada", "en_espera", "en_gestion", "en_compra", "recibida_parcial"]

/**
 * Estado derivado de las líneas. `awaitingArrival`: cuántas líneas «en compra» siguen esperando su repuesto
 * (`lineAwaitsArrival`); sólo pesa cuando ninguna línea está pendiente. `accepted`: jefatura la aceptó y todas siguen
 * pendientes (se conserva como `aceptada`). `arrivedAny`: algo ya llegó a la faena (o se apartó del stock).
 */
export function deriveNoteStatus(
  resolutions: readonly string[],
  awaitingArrival = 0,
  options: { accepted?: boolean; arrivedAny?: boolean } = {},
): DerivedNoteStatus {
  const pending = resolutions.filter((resolution) => resolution === "pendiente").length
  if (pending === resolutions.length) return options.accepted ? "aceptada" : "enviada"
  if (pending > 0) return "en_gestion"
  if (awaitingArrival > 0) return options.arrivedAny ? "recibida_parcial" : "en_compra"
  return resolutions.every((resolution) => resolution === "rechazada") ? "rechazada" : "cerrada"
}

/** Estados finales: salir de uno de ellos es reabrir la nota y empieza una gestión nueva (la aceptación anterior ya no vale). */
const FINAL_NOTE_STATUSES: readonly string[] = ["cerrada", "rechazada"]

/**
 * ¿La nota fue aceptada y no se ha reabierto desde? Recorre su historial del más nuevo al más viejo: un evento hacia
 * `aceptada` dice que sí; uno que sale de `cerrada` o `rechazada` (una reapertura) corta la búsqueda y dice que no.
 * Función pura sobre los eventos en orden cronológico; la lee `acceptedFromHistoryTx`.
 */
export function noteWasAccepted(events: ReadonlyArray<{ fromStatus: string | null; toStatus: string }>): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.toStatus === "aceptada") return true
    if (event.fromStatus && FINAL_NOTE_STATUSES.includes(event.fromStatus)) return false
  }
  return false
}

async function acceptedFromHistoryTx(tx: Tx, noteId: string): Promise<boolean> {
  const events = await tx
    .select({ fromStatus: mantPartsNoteEvents.fromStatus, toStatus: mantPartsNoteEvents.toStatus })
    .from(mantPartsNoteEvents)
    .where(eq(mantPartsNoteEvents.noteId, noteId))
    .orderBy(desc(mantPartsNoteEvents.seq))
  return noteWasAccepted(events.reverse())
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

/**
 * Por qué las líneas de una nota en estado final (`cerrada`, `rechazada`, `anulada`) no admiten que una PERSONA las resuelva,
 * las rechace ni las compre, o `null` si la nota sigue abierta. Sólo «Reabrir» las devuelve a pendiente. Es una regla de las
 * acciones de personas: los barridos automáticos (`unlinkNoteItemsFromRequestTx`, la anulación de una recepción, el cierre de
 * la OT) siguen tocando las líneas de una nota cerrada cuando su compra cambia.
 */
export function whyNoteLinesAreLocked(status: string, code: string): string | null {
  if (isPartsNoteOpen(status)) return null
  if (status === "anulada") return `La nota ${code} está anulada.`
  return `La nota ${code} está ${status === "cerrada" ? "cerrada" : "rechazada"}: sus líneas ya no se resuelven. Sólo «Reabrir» las devuelve a pendiente.`
}

/** Una línea se puede resolver (desde stock, rechazar o enlazar a otra solicitud) si está pendiente o su compra murió. */
export function isResolvableLine(resolution: string, purchases: readonly PurchaseLiveness[]): boolean {
  return resolution === "pendiente" || (resolution === "en_compra" && allPurchasesDead(purchases))
}

/**
 * Una línea «en compra» todavía espera su repuesto: su OT sigue abierta (o no tiene OT), tiene al menos una compra viva y
 * ni lo llegado cubre lo pedido ni Compras da todas sus compras vivas por recibidas. Con la OT terminada nadie espera: lo
 * que llegue ya no se reserva para ella (`addToAllocationTx`). Una línea sin compra viva no espera nada; vuelve sola a
 * pendiente al morir su compra (`unlinkNoteItemsFromRequestTx`).
 */
export function lineAwaitsArrival(input: {
  resolution: string
  quantity: number
  arrived: number
  purchases: readonly PurchaseLiveness[]
  /** Sin OT la línea no tiene OT que cerrar: quien llama la pasa como abierta. */
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

// ── Derivación (lectura dentro de la transacción) ───────────────────────────

interface LineFacts {
  id: string
  resolution: string
  quantity: number
}

async function isWorkOrderOpenTx(tx: Tx, workOrderId: string): Promise<boolean> {
  const [ot] = await tx.select({ status: mantWorkOrders.status }).from(mantWorkOrders).where(eq(mantWorkOrders.id, workOrderId)).limit(1)
  return !!ot && (OT_OPEN_STATUSES as readonly string[]).includes(ot.status)
}

/** Compras vivas (ítem + solicitud) de cada línea, en una sola consulta. */
async function purchasesOfTx(tx: Tx, itemIds: readonly string[]): Promise<Map<string, PurchaseLiveness[]>> {
  const result = new Map<string, PurchaseLiveness[]>()
  if (itemIds.length === 0) return result
  const rows = await tx
    .select({ noteItemId: purchaseRequestItems.partsNoteItemId, itemStatus: purchaseRequestItems.status, requestStatus: purchaseRequests.status })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
    .where(inArray(purchaseRequestItems.partsNoteItemId, [...itemIds]))
  for (const row of rows) {
    if (!row.noteItemId) continue
    result.set(row.noteItemId, [...(result.get(row.noteItemId) ?? []), { itemStatus: row.itemStatus, requestStatus: row.requestStatus }])
  }
  return result
}

/**
 * Estado que corresponde a las líneas de una NP ahora mismo, sin escribir nada. `accepted`: si se omite, sale del historial
 * (`noteWasAccepted`; sólo importa si todas las líneas siguen pendientes). Llamar con la OT tomada, si la hay, y con la fila
 * de la NP ya bloqueada.
 */
export async function deriveNoteStatusTx(tx: Tx, noteId: string, options: { accepted?: boolean } = {}): Promise<DerivedNoteStatus> {
  const [note] = await tx.select({ workOrderId: mantPartsNotes.workOrderId }).from(mantPartsNotes).where(eq(mantPartsNotes.id, noteId)).limit(1)
  if (!note) throw new Error("La nota de pedido no existe")
  const lines: LineFacts[] = (await tx
    .select({ id: mantPartsNoteItems.id, resolution: mantPartsNoteItems.resolution, quantity: mantPartsNoteItems.quantity })
    .from(mantPartsNoteItems)
    .where(eq(mantPartsNoteItems.noteId, noteId))).map((line) => ({ id: line.id, resolution: line.resolution, quantity: Number(line.quantity) }))
  const resolutions = lines.map((line) => line.resolution)
  const inCompra = lines.filter((line) => line.resolution === "en_compra")
  const accepted = options.accepted ?? (resolutions.every((resolution) => resolution === "pendiente") && await acceptedFromHistoryTx(tx, noteId))
  // Con una pendiente la nota ya está abierta, y sin compras en curso no hay nada que esperar: no hace falta mirar más.
  if (resolutions.includes("pendiente") || inCompra.length === 0) return deriveNoteStatus(resolutions, 0, { accepted })

  const workOrderOpen = note.workOrderId ? await isWorkOrderOpenTx(tx, note.workOrderId) : true
  const purchases = await purchasesOfTx(tx, inCompra.map((line) => line.id))
  const arrived = await loadArrivedByLine(tx, lines.map((line) => ({ id: line.id, workOrderId: note.workOrderId })))
  const awaiting = inCompra.filter((line) => lineAwaitsArrival({
    resolution: "en_compra",
    quantity: line.quantity,
    arrived: arrived.get(line.id)?.quantity ?? 0,
    purchases: purchases.get(line.id) ?? [],
    workOrderOpen,
  })).length
  const arrivedAny = lines.some((line) => line.resolution === "desde_stock" || toCents(arrived.get(line.id)?.quantity ?? 0) > 0)
  return deriveNoteStatus(resolutions, awaiting, { accepted, arrivedAny })
}

// ── Escritura ───────────────────────────────────────────────────────────────

export interface RecalcOptions {
  /** No escribe si el estado ya es el que corresponde (los barridos que no tocan ninguna línea). */
  onlyIfChanged?: boolean
  /** Quién causó el recálculo. `null` / omitido = automático del sistema. */
  actorUserId?: string | null
  reason?: string | null
  itemId?: string | null
  /** Ignora la espera: sólo lo usan el rechazo de la nota, la anulación y la aceptación al salir de la espera. */
  force?: boolean
}

/**
 * Recalcula el estado de la NP a partir de sus líneas y lo guarda con `setNoteStatusTx` (que escribe el evento sólo si
 * cambia). Toma la fila de la NP primero (`FOR NO KEY UPDATE`): dos transacciones que resuelven líneas distintas de una
 * misma NP se serializan aquí. Llamar dentro de la transacción que cambió la línea, con la OT tomada si la hay (`FOR
 * SHARE` o `FOR UPDATE`).
 *
 * Sin `onlyIfChanged` también sella `updated_at` aunque el estado no cambie: el ETag del catálogo del teléfono sale de ahí
 * y una línea cambió. Con `onlyIfChanged` (barridos) no escribe nada si no hay cambio.
 */
export async function recalcNoteStatusTx(tx: Tx, noteId: string, options: RecalcOptions = {}): Promise<PartsNoteStatus> {
  const [note] = await tx
    .select({ status: mantPartsNotes.status })
    .from(mantPartsNotes)
    .where(eq(mantPartsNotes.id, noteId))
    .limit(1)
    .for("no key update")
  if (!note) throw new Error("La nota de pedido no existe")
  const current = note.status as PartsNoteStatus
  if (current === "anulada") return current
  if (current === "en_espera" && !options.force) return current

  // «Aceptada» se conserva por el historial: una nota que ya estaba aceptada lo sigue estando; de un estado final sólo se sale
  // reabriendo, y una reapertura empieza sin aceptación; en cualquier otro estado lo dice el historial (`noteWasAccepted`).
  const accepted = current === "aceptada" ? true : FINAL_NOTE_STATUSES.includes(current) ? false : undefined
  const next = await deriveNoteStatusTx(tx, noteId, { accepted })
  if (next === current) {
    if (!options.onlyIfChanged) await tx.update(mantPartsNotes).set({ updatedAt: new Date().toISOString() }).where(eq(mantPartsNotes.id, noteId))
    return next
  }
  await setNoteStatusTx(tx, noteId, next, {
    actorUserId: options.actorUserId ?? null,
    reason: options.reason ?? null,
    itemId: options.itemId ?? null,
  })
  return next
}

/** Lo mismo desde una línea: para quien sólo conoce el id de la línea (la llegada de un repuesto a la reserva). */
export async function recalcNoteStatusOfLineTx(tx: Tx, noteItemId: string, options: RecalcOptions = {}): Promise<void> {
  const [line] = await tx.select({ noteId: mantPartsNoteItems.noteId }).from(mantPartsNoteItems).where(eq(mantPartsNoteItems.id, noteItemId)).limit(1)
  if (line) await recalcNoteStatusTx(tx, line.noteId, options)
}
