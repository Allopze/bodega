import { eq, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantPartsNoteItems, mantPartsNotes } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { roundQty, toCents } from "@/lib/services/stock-reservations"

/**
 * Partir una línea de nota de pedido (NP4-3 y NP4-4): cuando sólo se resuelve (o se mantiene resuelta) una parte de lo
 * pedido, esa parte queda en la línea y el saldo pasa a una línea `pendiente` NUEVA de la misma nota, para comprarla,
 * reservarla o rechazarla. Así lo pedido suma siempre lo mismo y nada queda sin dueño.
 *
 * La línea nueva copia descripción, unidad y número de parte, y va al final de la nota (el índice único
 * `(note_id, sort_order)` impide intercalarla sin mover las demás). Llamar con la OT tomada y la fila de la línea ya
 * bloqueada `FOR NO KEY UPDATE`; la fila de la NP se toma aquí, después de la línea (el mismo orden que
 * `recalcNoteStatusTx`), para que dos saldos de la misma NP no calculen el mismo orden.
 */
export async function splitLineRemainderTx(tx: Tx, input: {
  itemId: string
  /** Lo que conserva la línea (resuelto); el resto va a la línea nueva. Debe ser mayor que cero y menor que lo pedido. */
  keepQuantity: number
  /** Repuesto de la línea nueva: el que pidió el mecánico, no el que jefatura eligió para lo que sacó del stock. */
  remainderProductId: string | null
}): Promise<{ remainderItemId: string; remainderQuantity: number; originalQuantity: number }> {
  const [line] = await tx.select().from(mantPartsNoteItems).where(eq(mantPartsNoteItems.id, input.itemId)).limit(1)
  if (!line) throw new Error("La línea de la nota de pedido no existe")
  const keep = roundQty(input.keepQuantity)
  const original = roundQty(Number(line.quantity))
  if (toCents(keep) <= 0 || toCents(keep) >= toCents(original)) {
    throw new Error("La parte que conserva la línea debe ser mayor que cero y menor que lo pedido")
  }

  await tx.select({ id: mantPartsNotes.id }).from(mantPartsNotes).where(eq(mantPartsNotes.id, line.noteId)).for("no key update")
  const [{ next } = { next: 0 }] = await tx
    .select({ next: sql<number>`coalesce(max(${mantPartsNoteItems.sortOrder}), -1) + 1`.mapWith(Number) })
    .from(mantPartsNoteItems)
    .where(eq(mantPartsNoteItems.noteId, line.noteId))

  const remainder = roundQty(original - keep)
  const remainderItemId = nanoid()
  await tx.insert(mantPartsNoteItems).values({
    id: remainderItemId,
    noteId: line.noteId,
    description: line.description,
    quantity: remainder,
    unitOfMeasure: line.unitOfMeasure,
    partNumber: line.partNumber,
    productId: input.remainderProductId,
    resolution: "pendiente",
    sortOrder: next,
    createdAt: new Date().toISOString(),
  })
  await tx.update(mantPartsNoteItems).set({ quantity: keep }).where(eq(mantPartsNoteItems.id, line.id))
  return { remainderItemId, remainderQuantity: remainder, originalQuantity: original }
}
