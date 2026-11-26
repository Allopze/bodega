import type { Tx } from "@/db"
import type { MantViewer } from "@/lib/services/mantencion/access"
import type { PartsActionResult } from "@/lib/services/mantencion/parts/types"

/**
 * Resolución de líneas de nota de pedido por jefatura y su enlace con la
 * solicitud de compra. Stubs de la Fase 0 con la firma acordada: los implementa
 * la línea L3.
 */

export async function resolveNoteItemFromStock(viewer: MantViewer, input: { itemId: string; productId: string; quantity: number }): Promise<PartsActionResult> {
  void viewer
  void input
  throw new Error("resolveNoteItemFromStock: pendiente (línea L3)")
}

export async function rejectNoteItem(viewer: MantViewer, input: { itemId: string; reason: string }): Promise<PartsActionResult> {
  void viewer
  void input
  throw new Error("rejectNoteItem: pendiente (línea L3)")
}

export async function voidPartsNote(viewer: MantViewer, input: { noteId: string; reason: string }): Promise<PartsActionResult> {
  void viewer
  void input
  throw new Error("voidPartsNote: pendiente (línea L3)")
}

/**
 * Llamada por la solicitud de repuestos al guardar ítems que compran líneas de NP
 * (`purchase_request_items.parts_note_item_id`): deja cada línea «en compra», con
 * evento en la OT. Corre dentro de la transacción de la solicitud.
 */
export async function linkNoteItemsToRequestTx(tx: Tx, input: { links: Array<{ noteItemId: string; requestItemId: string }>; actorUserId: string }): Promise<void> {
  void tx
  void input
  throw new Error("linkNoteItemsToRequestTx: pendiente (línea L3)")
}
