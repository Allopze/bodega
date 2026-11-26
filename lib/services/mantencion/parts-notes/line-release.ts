import { and, eq, inArray, ne, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantPartsAllocationSources, mantPartsNoteItems, mantPartsNotes, mantWorkOrders } from "@/db/schema"
import { roundQty, toCents } from "@/lib/services/stock-reservations"
import { autoRejectionReason, autoRejectionTrail, rejectLineTx, workOrderEndOf } from "./line-rejection"
import { splitLineRemainderTx } from "./line-split"
import { loadLineStates } from "./lines"
import { recalcNoteStatusTx } from "./status"
import { writeTrail } from "./trail"

/**
 * Liberar una reserva de repuestos y lo que le pasa a las líneas de nota de pedido (NP) que se resolvieron «desde stock»
 * contra ella (NP4-4 y NP4-6, decisión 2026-11-26).
 *
 * Una reserva es de una OT y un repuesto: no sabe de líneas. Lo liberado se atribuye a las líneas `desde_stock` que la
 * alimentaron, de la más nueva a la más vieja (el consumo llena las primeras, `allocateUsed`), y cada línea sólo cede lo
 * que aún no se usó. Con eso la cifra «Llegó» de la línea baja (la rebaja lleva `note_item_id`) y la línea deja de decir
 * que el repuesto está en bodega:
 *
 *  - si se liberó toda su reserva, vuelve a `pendiente`, sin quien la resolvió, para comprarla, reservarla otra vez o
 *    rechazarla; con eso la NP también se puede anular. Si la OT ya terminó, nadie la va a gestionar: se rechaza sola
 *    con el motivo de D13;
 *  - si conserva parte, esa parte queda en la línea y lo liberado pasa a una línea `pendiente` nueva de la misma NP
 *    (`splitLineRemainderTx`), igual que al reservar menos de lo pedido.
 *
 * Lo liberado que no corresponde a ninguna línea (lo que llegó por una compra sin nota, por ejemplo) sigue siendo una
 * rebaja sin línea, como antes. Las líneas `en_compra` no se tocan: la compra ocurrió y jefatura no puede actuar sobre ellas.
 *
 * Bloqueo: se llama con la OT, la faena y la fila de stock ya tomadas (`lockForStockTx`). Las filas de las líneas se
 * toman `FOR NO KEY UPDATE`, ordenadas por id, después del stock (el mismo orden de `resolveNoteItemFromStock`); la
 * fila de la NP, después de sus líneas (`splitLineRemainderTx`, `recalcNoteStatusTx`). Todo en la transacción de la
 * liberación: si algo falla, ni la reserva ni las líneas cambian.
 */

export interface ReleaseCandidate {
  itemId: string
  /** Lo que la reserva sigue aportando a la línea (Σ de sus orígenes en esa reserva). */
  held: number
  /** Lo que los registros ya consumieron de la línea (`allocateUsed`): no se puede liberar. */
  used: number
  resolvedAt: string
  noteCreatedAt: string
  sortOrder: number
}

export interface ReleaseShare {
  itemId: string
  /** Cuánto de la liberación corresponde a esta línea. */
  quantity: number
}

/**
 * Reparte lo liberado entre las líneas que alimentaron la reserva: la más nueva primero, cada una hasta lo que le queda
 * sin usar. El resto (`unattributed`) no es de ninguna línea. Pura: la usa la liberación y la prueban las pruebas.
 */
export function distributeRelease(candidates: readonly ReleaseCandidate[], quantity: number): { shares: ReleaseShare[]; unattributed: number } {
  const time = (value: string) => new Date(value).getTime() || 0
  const ordered = [...candidates].sort((a, b) =>
    time(b.resolvedAt) - time(a.resolvedAt) || time(b.noteCreatedAt) - time(a.noteCreatedAt) || b.sortOrder - a.sortOrder || b.itemId.localeCompare(a.itemId))
  let left = toCents(quantity)
  const shares: ReleaseShare[] = []
  for (const candidate of ordered) {
    if (left <= 0) break
    const unused = Math.max(0, toCents(candidate.held) - toCents(candidate.used))
    const take = Math.min(left, unused)
    if (take <= 0) continue
    shares.push({ itemId: candidate.itemId, quantity: take / 100 })
    left -= take
  }
  return { shares, unattributed: Math.max(0, left) / 100 }
}

/** La línea tal como está bajo bloqueo, con su NP. */
interface LockedLine {
  itemId: string
  noteId: string
  code: string
  noteWorksiteId: string
  workOrderId: string
  description: string
  quantity: number
  productId: string | null
}

export interface ReleasePlan {
  /** Lo que se atribuye a cada línea, con su fila bloqueada. */
  lines: Array<{ line: LockedLine; held: number; share: number }>
  /** Filas de origen de la rebaja: una por línea con `note_item_id`, y una sin línea por lo que sobra. Suman lo liberado. */
  sourceRows: Array<{ noteItemId: string | null; quantity: number }>
}

/**
 * Lee a qué líneas corresponde lo que se va a liberar y las bloquea. Sin líneas `desde_stock` en la reserva (lo normal
 * cuando la reserva viene de recepciones) no bloquea nada y devuelve una sola fila sin línea.
 */
export async function planReleaseToLinesTx(tx: Tx, input: {
  allocationId: string
  workOrderId: string
  quantity: number
}): Promise<ReleasePlan> {
  const whole: ReleasePlan = { lines: [], sourceRows: [{ noteItemId: null, quantity: input.quantity }] }

  const held = await tx
    .select({ itemId: mantPartsAllocationSources.noteItemId, held: sql<number>`sum(${mantPartsAllocationSources.quantity})`.mapWith(Number) })
    .from(mantPartsAllocationSources)
    .innerJoin(mantPartsNoteItems, eq(mantPartsNoteItems.id, mantPartsAllocationSources.noteItemId))
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .where(and(
      eq(mantPartsAllocationSources.allocationId, input.allocationId),
      eq(mantPartsNoteItems.resolution, "desde_stock"),
      ne(mantPartsNotes.status, "anulada"),
    ))
    .groupBy(mantPartsAllocationSources.noteItemId)
  const heldOf = new Map<string, number>()
  for (const row of held) if (row.itemId && toCents(row.held) > 0) heldOf.set(row.itemId, roundQty(row.held))
  if (heldOf.size === 0) return whole

  // Las líneas, tomadas por id y después del stock. Una que dejó de ser `desde_stock` no se atribuye.
  const locked = await tx
    .select({
      itemId: mantPartsNoteItems.id,
      noteId: mantPartsNoteItems.noteId,
      code: mantPartsNotes.code,
      noteWorksiteId: mantPartsNotes.worksiteId,
      workOrderId: mantPartsNotes.workOrderId,
      description: mantPartsNoteItems.description,
      quantity: mantPartsNoteItems.quantity,
      productId: mantPartsNoteItems.productId,
      resolution: mantPartsNoteItems.resolution,
      resolvedAt: mantPartsNoteItems.resolvedAt,
      sortOrder: mantPartsNoteItems.sortOrder,
      noteCreatedAt: mantPartsNotes.createdAt,
    })
    .from(mantPartsNoteItems)
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .where(inArray(mantPartsNoteItems.id, [...heldOf.keys()]))
    .orderBy(mantPartsNoteItems.id)
    .for("no key update", { of: mantPartsNoteItems })
  const candidates = locked.filter((row) => row.resolution === "desde_stock" && row.resolvedAt)
  if (candidates.length === 0) return whole

  // Lo usado se reparte entre TODAS las líneas de la OT que piden ese repuesto, en su orden: se lee igual que la nota.
  const refs = await tx
    .select({
      id: mantPartsNoteItems.id, noteId: mantPartsNoteItems.noteId, workOrderId: mantPartsNotes.workOrderId, productId: mantPartsNoteItems.productId,
      resolution: mantPartsNoteItems.resolution, sortOrder: mantPartsNoteItems.sortOrder, noteCreatedAt: mantPartsNotes.createdAt,
    })
    .from(mantPartsNoteItems)
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .where(and(eq(mantPartsNotes.workOrderId, input.workOrderId), ne(mantPartsNotes.status, "anulada")))
  const states = await loadLineStates(refs, tx)

  const { shares, unattributed } = distributeRelease(candidates.map((row) => ({
    itemId: row.itemId,
    held: heldOf.get(row.itemId) ?? 0,
    used: states.get(row.itemId)?.used ?? 0,
    resolvedAt: row.resolvedAt!,
    noteCreatedAt: row.noteCreatedAt,
    sortOrder: row.sortOrder,
  })), input.quantity)
  if (shares.length === 0) return whole

  const byId = new Map(candidates.map((row) => [row.itemId, row]))
  return {
    lines: shares.map((share) => {
      const row = byId.get(share.itemId)!
      return {
        line: {
          itemId: row.itemId, noteId: row.noteId, code: row.code, noteWorksiteId: row.noteWorksiteId, workOrderId: row.workOrderId,
          description: row.description, quantity: Number(row.quantity), productId: row.productId,
        },
        held: heldOf.get(share.itemId) ?? 0,
        share: share.quantity,
      }
    }),
    sourceRows: [
      ...shares.map((share) => ({ noteItemId: share.itemId, quantity: share.quantity })),
      ...(toCents(unattributed) > 0 ? [{ noteItemId: null, quantity: unattributed }] : []),
    ],
  }
}

/** Lo que le pasó a una línea al liberarse su reserva, para el mensaje de la acción. */
export interface ReturnedNoteLine {
  itemId: string
  noteId: string
  noteCode: string
  description: string
  /** Lo que se le quitó a la línea. */
  quantity: number
  /** `pendiente`: vuelve a la bandeja; `rechazada`: su OT ya terminó y se rechazó sola (D13). */
  outcome: "pendiente" | "rechazada"
  /** La línea nueva que recibió lo liberado, si la línea conservaba parte de lo reservado. */
  remainderItemId: string | null
}

/**
 * Aplica el plan a las líneas: vuelve a pendiente (o rechaza si la OT terminó) lo liberado, recalcula el estado de cada
 * NP y deja el evento de la OT y la auditoría de la NP por línea. Llamar DESPUÉS de escribir la rebaja de la reserva.
 */
export async function returnReleasedLinesTx(tx: Tx, input: {
  plan: ReleasePlan
  allocationId: string
  reason: string
  actor: { userId: string; email?: string | null }
}): Promise<ReturnedNoteLine[]> {
  if (input.plan.lines.length === 0) return []
  const workOrderId = input.plan.lines[0]!.line.workOrderId
  const [ot] = await tx.select({ status: mantWorkOrders.status, voidReason: mantWorkOrders.voidReason }).from(mantWorkOrders).where(eq(mantWorkOrders.id, workOrderId)).limit(1)
  const end = ot ? workOrderEndOf(ot.status, ot.voidReason) : null
  const trailReason = `Reserva liberada: ${input.reason}`

  const returned: ReturnedNoteLine[] = []
  const touched = new Set<string>()
  for (const { line, held, share } of input.plan.lines) {
    const keep = roundQty(line.quantity - share)
    const wholeLine = toCents(roundQty(held - share)) <= 0 || toCents(keep) <= 0
    const base = { itemId: line.itemId, noteId: line.noteId, code: line.code, noteWorksiteId: line.noteWorksiteId, workOrderId: line.workOrderId }
    touched.add(line.noteId)

    if (wholeLine) {
      if (end) {
        await rejectLineTx(tx, { ...base, resolution: "desde_stock" }, {
          reason: autoRejectionReason(end), actor: input.actor,
          extra: { ...autoRejectionTrail(end), previousResolution: "desde_stock", releasedQuantity: share, allocationId: input.allocationId },
        })
      } else {
        await tx.update(mantPartsNoteItems).set({
          resolution: "pendiente", resolutionReason: null, resolvedByUserId: null, resolvedAt: null,
        }).where(and(eq(mantPartsNoteItems.id, line.itemId), eq(mantPartsNoteItems.resolution, "desde_stock")))
        await writeTrail(tx, {
          workOrderId: line.workOrderId, worksiteId: line.noteWorksiteId, noteId: line.noteId, code: line.code,
          actor: input.actor, action: "update", reason: trailReason,
          oldState: { itemId: line.itemId, resolution: "desde_stock" },
          changeSet: {
            itemId: line.itemId, resolution: "pendiente", previousResolution: "desde_stock", returned: "reserva liberada",
            releasedQuantity: share, allocationId: input.allocationId,
          },
        })
      }
      returned.push({
        itemId: line.itemId, noteId: line.noteId, noteCode: line.code, description: line.description, quantity: share,
        outcome: end ? "rechazada" : "pendiente", remainderItemId: null,
      })
      continue
    }

    // La línea conserva parte de lo reservado: esa parte queda resuelta y lo liberado pasa a una línea pendiente nueva.
    const split = await splitLineRemainderTx(tx, { itemId: line.itemId, keepQuantity: keep, remainderProductId: line.productId })
    if (end) {
      await rejectLineTx(tx, { ...base, itemId: split.remainderItemId, resolution: "pendiente" }, {
        reason: autoRejectionReason(end), actor: input.actor,
        extra: { ...autoRejectionTrail(end), previousResolution: "pendiente", splitFromItemId: line.itemId, allocationId: input.allocationId },
      })
    }
    await writeTrail(tx, {
      workOrderId: line.workOrderId, worksiteId: line.noteWorksiteId, noteId: line.noteId, code: line.code,
      actor: input.actor, action: "update", reason: trailReason,
      oldState: { itemId: line.itemId, resolution: "desde_stock", quantity: split.originalQuantity },
      changeSet: {
        itemId: line.itemId, resolution: "desde_stock", quantity: keep, releasedQuantity: share, allocationId: input.allocationId,
        originalQuantity: split.originalQuantity, remainderItemId: split.remainderItemId, remainderQuantity: split.remainderQuantity,
        returned: end ? "lo liberado se rechazó solo" : "lo liberado pasa a una línea pendiente",
      },
    })
    returned.push({
      itemId: line.itemId, noteId: line.noteId, noteCode: line.code, description: line.description, quantity: share,
      outcome: end ? "rechazada" : "pendiente", remainderItemId: split.remainderItemId,
    })
  }
  for (const noteId of [...touched].sort()) await recalcNoteStatusTx(tx, noteId)
  return returned
}
