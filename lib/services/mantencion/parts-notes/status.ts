import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantPartsNoteItems, mantPartsNotes } from "@/db/schema"
import { roundQty, toCents } from "@/lib/services/stock-reservations"
import type { NoteItemResolution, PartsNoteLineStage, PartsNoteStatus } from "../parts/types"

/**
 * Reglas puras de la nota de pedido (NP): estado de la cabecera derivado de sus
 * líneas, compras «vivas», etapa legible de una línea y reparto de lo usado.
 * Sin base de datos: las comparten el alta, la resolución y las lecturas.
 */

/**
 * Estado de la NP según sus líneas: `enviada` (ninguna resuelta), `en_gestion`
 * (algunas aún pendientes) o `cerrada` (ninguna pendiente). `anulada` no se
 * deriva: la fija quien anula, y `recalcNoteStatusTx` no la toca.
 */
export function deriveNoteStatus(resolutions: readonly string[]): Exclude<PartsNoteStatus, "anulada"> {
  const pending = resolutions.filter((resolution) => resolution === "pendiente").length
  if (pending === resolutions.length) return "enviada"
  return pending > 0 ? "en_gestion" : "cerrada"
}

/** Recalcula y guarda el estado de la NP (y su `updated_at`, que mueve el ETag del catálogo). Llamar con la NP ya bloqueada o dentro de la misma transacción de la línea. */
export async function recalcNoteStatusTx(tx: Tx, noteId: string): Promise<PartsNoteStatus> {
  const [note] = await tx.select({ status: mantPartsNotes.status }).from(mantPartsNotes).where(eq(mantPartsNotes.id, noteId)).limit(1)
  if (!note) throw new Error("La nota de pedido no existe")
  if (note.status === "anulada") return "anulada"
  const items = await tx.select({ resolution: mantPartsNoteItems.resolution }).from(mantPartsNoteItems).where(eq(mantPartsNoteItems.noteId, noteId))
  const next = deriveNoteStatus(items.map((item) => item.resolution))
  await tx.update(mantPartsNotes).set({ status: next, updatedAt: new Date().toISOString() }).where(eq(mantPartsNotes.id, noteId))
  return next
}

// ── Compras de una línea ────────────────────────────────────────────────────

/** Una compra «muerta» ya no va a traer nada: ítem rechazado o solicitud cancelada o rechazada (mismo criterio que `parts-requests.ts`). */
const DEAD_ITEM_STATUSES: readonly string[] = ["rejected"]
const DEAD_REQUEST_STATUSES: readonly string[] = ["cancelled", "rejected"]

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
