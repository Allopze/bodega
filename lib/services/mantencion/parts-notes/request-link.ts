import { and, asc, eq, inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantPartsNoteItems, mantPartsNotes, mantWorkOrders } from "@/db/schema"
import { PartsValidationError } from "../parts/types"
import { lockWorkOrdersShare } from "./context"
import { autoRejectionReason, autoRejectionTrail, rejectLineTx, workOrderEndOf } from "./line-rejection"
import { loadPurchases } from "./lines"
import { allPurchasesDead, recalcNoteStatusTx } from "./status"
import { writeTrail } from "./trail"

/**
 * Enlace entre las líneas de una nota de pedido (NP) y la solicitud de repuestos
 * que las compra (`purchase_request_items.parts_note_item_id`). Corre dentro de la
 * transacción de la solicitud; las líneas se toman `FOR NO KEY UPDATE`, ordenadas por
 * id (no chocan con la FK de las reservas ni de las solicitudes, que piden `KEY SHARE`).
 * Antes de las líneas se toman sus OT `FOR SHARE` (orden global de bloqueo): cerrar o
 * anular una OT rechaza sus líneas pendientes y no se cruza con esta transacción. Una
 * línea sin OT no tiene OT que tomar.
 */

/** Líneas con su NP y el estado de su OT (si tiene), tomadas con el bloqueo (la OT va primero). */
async function lockLines(tx: Tx, itemIds: readonly string[]) {
  const owners = await tx
    .select({ workOrderId: mantPartsNotes.workOrderId })
    .from(mantPartsNoteItems)
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .where(inArray(mantPartsNoteItems.id, [...itemIds]))
  await lockWorkOrdersShare(tx, owners.map((row) => row.workOrderId))
  return tx
    .select({
      itemId: mantPartsNoteItems.id,
      description: mantPartsNoteItems.description,
      resolution: mantPartsNoteItems.resolution,
      noteId: mantPartsNotes.id,
      code: mantPartsNotes.code,
      noteStatus: mantPartsNotes.status,
      workOrderId: mantPartsNotes.workOrderId,
      workOrderStatus: mantWorkOrders.status,
      workOrderVoidReason: mantWorkOrders.voidReason,
      worksiteId: mantPartsNotes.worksiteId,
    })
    .from(mantPartsNoteItems)
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .where(inArray(mantPartsNoteItems.id, [...itemIds]))
    .orderBy(asc(mantPartsNoteItems.id))
    .for("no key update", { of: mantPartsNoteItems })
}

/**
 * Llamada por la solicitud de repuestos al guardar ítems que compran líneas de NP:
 * deja cada línea PENDIENTE «en compra», con evento en la OT si la hay.
 *
 * Es idempotente: el autoguardado del borrador, o una segunda solicitud que compra el
 * saldo, la vuelven a llamar con líneas que ya están «en compra» (aunque su compra
 * anterior haya muerto), y eso ni falla ni repite el evento. Sólo una línea pendiente
 * cambia y deja rastro. Una línea rechazada, apartada del stock, de una NP anulada o de
 * una NP en espera NO se puede comprar: se lanza `PartsValidationError` y la solicitud
 * entera se revierte (comprarla otra vez duplicaría lo que jefatura ya resolvió).
 */
export async function linkNoteItemsToRequestTx(tx: Tx, input: { links: Array<{ noteItemId: string; requestItemId: string }>; actorUserId: string }): Promise<void> {
  const requestOf = new Map<string, string>()
  for (const link of input.links) if (!requestOf.has(link.noteItemId)) requestOf.set(link.noteItemId, link.requestItemId)
  if (requestOf.size === 0) return

  const rows = await lockLines(tx, [...requestOf.keys()])
  if (rows.length !== requestOf.size) throw new PartsValidationError("Una línea de la nota de pedido ya no existe: vuelve a abrirla desde la bandeja.")

  const touched = new Set<string>()
  for (const row of rows) {
    if (row.noteStatus === "anulada") throw new PartsValidationError(`La nota ${row.code} está anulada: no se puede comprar «${row.description}».`)
    if (row.resolution === "rechazada") throw new PartsValidationError(`«${row.description}» de ${row.code} ya está rechazada: no se puede comprar.`)
    if (row.resolution === "desde_stock") throw new PartsValidationError(`«${row.description}» de ${row.code} ya se apartó del stock: no se puede comprar.`)
    if (row.resolution !== "pendiente") continue
    if (row.noteStatus === "en_espera") throw new PartsValidationError("La nota está en espera: acéptala primero.")
    await tx.update(mantPartsNoteItems).set({
      resolution: "en_compra", resolutionReason: null, resolvedByUserId: input.actorUserId, resolvedAt: new Date().toISOString(),
    }).where(and(eq(mantPartsNoteItems.id, row.itemId), eq(mantPartsNoteItems.resolution, "pendiente")))
    await writeTrail(tx, {
      workOrderId: row.workOrderId, worksiteId: row.worksiteId, noteId: row.noteId, code: row.code,
      actor: { userId: input.actorUserId }, action: "update",
      oldState: { itemId: row.itemId, resolution: "pendiente" },
      changeSet: { itemId: row.itemId, resolution: "en_compra", requestItemId: requestOf.get(row.itemId) },
    })
    touched.add(row.noteId)
  }
  for (const noteId of touched) await recalcNoteStatusTx(tx, noteId, { actorUserId: input.actorUserId })
}

/**
 * Inverso de `linkNoteItemsToRequestTx`: la solicitud de repuestos llama aquí al quitar
 * ítems del borrador, eliminarlo o cancelarlo, DESPUÉS de quitar o cancelar esos ítems
 * (un ítem aún vivo cuenta como comprador).
 *
 * Una línea «en compra» a la que ya no le queda NINGÚN comprador vivo (ítem de solicitud
 * con `parts_note_item_id` = la línea, sin estar rechazado ni en una solicitud cancelada o
 * rechazada) vuelve a «pendiente», sin quien la resolvió, para que jefatura la gestione de
 * nuevo; se recalcula el estado de la NP y la OT recibe el evento. Con un comprador vivo, o
 * con una línea en otro estado, no hace nada.
 *
 * Si la OT ya se cerró o se anuló nadie va a gestionar la línea: en vez de volver a «pendiente»
 * (y dejar la NP otra vez en «Pendientes» por una orden terminada) se rechaza sola, con el
 * mismo motivo que las líneas pendientes al terminar la OT (NP4-7). Una NP sin OT nunca se
 * rechaza sola por esto: vuelve a pendiente.
 */
export async function unlinkNoteItemsFromRequestTx(tx: Tx, input: { noteItemIds: string[]; actorUserId: string }): Promise<void> {
  const itemIds = [...new Set(input.noteItemIds)]
  if (itemIds.length === 0) return
  const rows = (await lockLines(tx, itemIds)).filter((row) => row.resolution === "en_compra" && row.noteStatus !== "anulada")
  if (rows.length === 0) return

  const purchases = await loadPurchases(tx, rows.map((row) => row.itemId))
  const touched = new Set<string>()
  for (const row of rows) {
    const liveness = (purchases.get(row.itemId) ?? []).map((purchase) => ({ itemStatus: purchase.status, requestStatus: purchase.requestStatus }))
    if (!allPurchasesDead(liveness)) continue
    const end = row.workOrderId && row.workOrderStatus ? workOrderEndOf(row.workOrderStatus, row.workOrderVoidReason) : null
    if (end) {
      await rejectLineTx(tx, {
        itemId: row.itemId, noteId: row.noteId, code: row.code, noteWorksiteId: row.worksiteId, workOrderId: row.workOrderId, resolution: "en_compra",
      }, { reason: autoRejectionReason(end), actor: { userId: input.actorUserId }, extra: { ...autoRejectionTrail(end), previousResolution: "en_compra" }, automatic: true })
      touched.add(row.noteId)
      continue
    }
    await tx.update(mantPartsNoteItems).set({
      resolution: "pendiente", resolutionReason: null, resolvedByUserId: null, resolvedAt: null,
    }).where(and(eq(mantPartsNoteItems.id, row.itemId), eq(mantPartsNoteItems.resolution, "en_compra")))
    await writeTrail(tx, {
      workOrderId: row.workOrderId, worksiteId: row.worksiteId, noteId: row.noteId, code: row.code,
      actor: { userId: input.actorUserId }, action: "update",
      reason: "Vuelve a pendiente: la solicitud que la compraba ya no existe",
      oldState: { itemId: row.itemId, resolution: "en_compra" },
      changeSet: { itemId: row.itemId, resolution: "pendiente", previousResolution: "en_compra", returned: "vuelve a pendiente" },
    })
    touched.add(row.noteId)
  }
  for (const noteId of touched) await recalcNoteStatusTx(tx, noteId, { actorUserId: input.actorUserId })
}
