import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import type { Tx } from "@/db"
import { mantPartsNoteItems, mantPartsNotes } from "@/db/schema"
import { canAccessWorksite } from "@/lib/auth/scope"

/** Quien compra lo que pidió una nota de pedido: el mismo permiso con que se resuelve (D3). */
export const PARTS_NOTE_PURCHASE_PERMISSION = "mant:np:manage"

/**
 * La línea de nota de pedido (NP) que un ítem de solicitud compra
 * (`purchase_request_items.parts_note_item_id`, ADR mantención 0001): existe, es de
 * la misma OT del ítem y todavía se puede comprar. Se llama al guardar el borrador
 * (`persist-draft.ts`) y de nuevo al enviar (`submit-request.ts`): jefatura puede
 * rechazar la línea o anular la NP entre una cosa y la otra.
 *
 * El cliente propone el id de la línea, nunca su OT: la base sólo exige que un ítem
 * con línea de NP nombre una OT (CHECK), no que sea la de la NP. Eso se comprueba aquí.
 *
 * `alreadySaved`: el borrador ya tenía ese mismo par guardado. Si después la línea se
 * resolvió o la NP se anuló, volver a guardar (el autoguardado lo hace solo) no puede
 * fallar —el ítem se conserva— y es el envío el que lo frena. Sigue exigiéndose que la
 * línea exista y sea de la OT del ítem.
 *
 * Una línea `en_compra` sí se acepta: es la que ya compra este mismo borrador o la que
 * se compra en partes.
 *
 * `actor`: al guardar el borrador se exige además que quien guarda pueda resolver notas
 * de pedido (`mant:np:manage`) en la faena de la nota. Ocultar el prellenado (`?np=`) no
 * es autorización: el id de la línea viaja en el formulario y cualquiera con permiso de
 * crear solicitudes de repuestos podría mandar otro. Al enviar no se repite: el envío es
 * del mismo solicitante que ya guardó el borrador.
 */
export async function assertPartsNoteLineBuyable(
  tx: Tx,
  link: { partsNoteItemId: string; workOrderId: string },
  opts: { alreadySaved?: boolean; actor?: Session } = {},
): Promise<void> {
  if (opts.actor && !opts.actor.user.permissions?.includes(PARTS_NOTE_PURCHASE_PERMISSION)) {
    throw new Error("No tienes permiso para comprar lo que pidió una nota de pedido: quita ese ítem de la solicitud")
  }
  const [line] = await tx
    .select({
      description: mantPartsNoteItems.description,
      resolution: mantPartsNoteItems.resolution,
      noteCode: mantPartsNotes.code,
      noteStatus: mantPartsNotes.status,
      noteWorkOrderId: mantPartsNotes.workOrderId,
      noteWorksiteId: mantPartsNotes.worksiteId,
    })
    .from(mantPartsNoteItems)
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .where(eq(mantPartsNoteItems.id, link.partsNoteItemId))
  // Una línea de otra faena se informa igual que una inexistente: no se delata su existencia.
  if (!line || (opts.actor && !canAccessWorksite(opts.actor, line.noteWorksiteId))) {
    throw new Error("La línea de la nota de pedido ya no existe: quita ese ítem de la solicitud")
  }
  if (line.noteWorkOrderId !== link.workOrderId) {
    throw new Error("La línea de la nota de pedido no es de la OT elegida: abre la solicitud desde la nota de pedido")
  }
  if (opts.alreadySaved) return

  if (line.noteStatus === "anulada") {
    throw new Error(`La nota de pedido ${line.noteCode} fue anulada: quita ese ítem de la solicitud`)
  }
  if (line.resolution === "rechazada") {
    throw new Error(`La línea «${line.description}» de la nota de pedido ${line.noteCode} fue rechazada: quita ese ítem de la solicitud`)
  }
  if (line.resolution === "desde_stock") {
    throw new Error(`La línea «${line.description}» de la nota de pedido ${line.noteCode} se resolvió desde el stock de la faena: quita ese ítem de la solicitud`)
  }
}
