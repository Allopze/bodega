import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import type { Tx } from "@/db"
import { mantPartsNoteItems, mantPartsNotes } from "@/db/schema"
import { canAccessWorksite } from "@/lib/auth/scope"

/**
 * Quien compra lo que pidió una nota de pedido: `mant:np:manage` (resuelve) o `mant:np:purchase` (compra) (ADR 0001,
 * 2026-11-27). El alcance de faena se aplica igual en los dos casos.
 */
export const PARTS_NOTE_PURCHASE_PERMISSION = ["mant:np:manage", "mant:np:purchase"] as const

export function canBuyPartsNoteLines(permissions: readonly string[] | undefined): boolean {
  return !!permissions && PARTS_NOTE_PURCHASE_PERMISSION.some((permission) => permissions.includes(permission))
}

/**
 * ¿La línea de NP pertenece a una nota con OT? Un ítem sin OT no se vincula a una línea así (como siempre: la línea
 * queda pendiente y no se cuenta como comprada). Una línea de una nota sin OT sí se vincula: ver `assertPartsNoteLineBuyable`.
 * `false` si la línea no existe: la validación de `assertPartsNoteLineBuyable` lo dirá.
 */
export async function partsNoteLineHasWorkOrder(tx: Tx, partsNoteItemId: string): Promise<boolean> {
  const [row] = await tx
    .select({ workOrderId: mantPartsNotes.workOrderId })
    .from(mantPartsNoteItems)
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .where(eq(mantPartsNoteItems.id, partsNoteItemId))
    .limit(1)
  return !!row?.workOrderId
}

/** Lo que la solicitud dice de la línea que compra: el id de la línea, la OT que nombra (si la hay) y la faena de la solicitud. */
export interface PartsNoteLineLink {
  partsNoteItemId: string
  workOrderId: string | null
  /** Faena de la solicitud. Una línea sin OT sólo se compra en la faena de su nota. */
  worksiteId?: string | null
}

/**
 * La línea de nota de pedido (NP) que un ítem de solicitud compra (`purchase_request_items.parts_note_item_id`, ADR
 * mantención 0001): existe, está en una faena que el actor puede ver y todavía se puede comprar. Se llama al guardar el
 * borrador (`persist-draft.ts`) y de nuevo al enviar (`submit-request.ts`): jefatura puede rechazar la línea, poner la
 * nota en espera o anularla entre una cosa y la otra.
 *
 * La OT: si la NP tiene OT, el ítem debe nombrar esa OT (el cliente propone el id de la línea, nunca la OT). Si la NP NO
 * tiene OT (ADR 0001, 2026-11-27), el ítem se pide sin OT, en la faena de la NP, y el equipo del ítem es el de cargo de
 * la línea (`chargeVehicleId`): quien guarda lo copia en el ítem. Devuelve eso para que lo haga.
 *
 * `alreadySaved`: el borrador ya tenía ese mismo par guardado. Si después la línea se resolvió o la NP se anuló o puso en
 * espera, volver a guardar (el autoguardado lo hace solo) no puede fallar —el ítem se conserva— y es el envío el que lo
 * frena. Sigue exigiéndose que la línea exista y sea de la OT del ítem.
 *
 * Una línea `en_compra` sí se acepta: es la que ya compra este mismo borrador o la que se compra en partes.
 *
 * `actor`: al guardar el borrador se exige además que quien guarda pueda comprar (`canBuyPartsNoteLines`) en la faena de
 * la nota. Ocultar el prellenado (`?np=`) no es autorización: el id de la línea viaja en el formulario y cualquiera con
 * permiso de crear solicitudes de repuestos podría mandar otro. Al enviar no se repite: el envío es del mismo solicitante
 * que ya guardó el borrador.
 */
export async function assertPartsNoteLineBuyable(
  tx: Tx,
  link: PartsNoteLineLink,
  opts: { alreadySaved?: boolean; actor?: Session } = {},
): Promise<{ workOrderId: string | null; chargeVehicleId: string | null }> {
  if (opts.actor && !canBuyPartsNoteLines(opts.actor.user?.permissions)) {
    throw new Error("No tienes permiso para comprar lo que pidió una nota de pedido: quita ese ítem de la solicitud")
  }
  const [line] = await tx
    .select({
      description: mantPartsNoteItems.description,
      resolution: mantPartsNoteItems.resolution,
      chargeVehicleId: mantPartsNoteItems.chargeVehicleId,
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
  if (line.noteWorkOrderId) {
    if (link.workOrderId !== line.noteWorkOrderId) {
      throw new Error("La línea de la nota de pedido no es de la OT elegida: abre la solicitud desde la nota de pedido")
    }
  } else if (link.workOrderId) {
    throw new Error("La línea de la nota de pedido no tiene OT: quita la orden de trabajo de ese ítem")
  }
  if (!line.noteWorkOrderId && link.worksiteId && link.worksiteId !== line.noteWorksiteId) {
    throw new Error(`La línea de la nota de pedido ${line.noteCode} es de otra faena: abre la solicitud desde la nota de pedido`)
  }
  const result = { workOrderId: line.noteWorkOrderId, chargeVehicleId: line.chargeVehicleId }
  if (opts.alreadySaved) return result

  if (line.noteStatus === "anulada") {
    throw new Error(`La nota de pedido ${line.noteCode} fue anulada: quita ese ítem de la solicitud`)
  }
  if (line.noteStatus === "en_espera") {
    throw new Error(`La nota de pedido ${line.noteCode} está en espera: jefatura debe aceptarla antes de comprar: quita ese ítem de la solicitud`)
  }
  if (line.resolution === "rechazada") {
    throw new Error(`La línea «${line.description}» de la nota de pedido ${line.noteCode} fue rechazada: quita ese ítem de la solicitud`)
  }
  if (line.resolution === "desde_stock") {
    throw new Error(`La línea «${line.description}» de la nota de pedido ${line.noteCode} se resolvió desde el stock de la faena: quita ese ítem de la solicitud`)
  }
  return result
}
