/**
 * `E2E-001` (auditoría 2026-09-14): avisar al solicitante cuando su saldo se recorta.
 *
 * La cadena de adquisición tiene TRES puntos donde lo pedido deja de avanzar
 * entero, y cada uno lo resolvía bien dentro de su módulo sin decírselo a quien
 * pidió el material:
 *
 *  1. `closeOrderTx` — cierre de OC con recepción parcial: lo recibido se
 *     conserva y el saldo se separa en un ítem hermano que vuelve a
 *     `pending_purchase`. El ítem original queda en `partially_received`.
 *  2. `registerReceipt` — rechazo o daño en recepción: consume el cupo de la
 *     etapa sin sumar stock ni avanzar el ítem. El ítem se queda quieto.
 *  3. `confirmDispatchGuideReceipt` — diferencia al cotejar una guía interna:
 *     se documenta con motivo, pero el ítem llega igual a `received`.
 *
 * Los tres desenlaces significan lo mismo para el solicitante —"lo que pedí no
 * llegó entero"— y ninguno se lo decía: recibía notificación cuando su ítem
 * llegaba a oficina y cuando llegaba completo a faena, nunca cuando el saldo se
 * perdía. Este módulo es el único emisor de ese aviso, para que los tres puntos
 * hablen igual y —sobre todo— para que un mismo recorte no produzca tres avisos.
 *
 * DEDUPLICACIÓN. La llave es `(ítem de solicitud, cantidad faltante)` y NO
 * incluye la causa a propósito: los tres puntos se encadenan sobre el mismo
 * recorte (se rechazan 4 unidades en la recepción y después se cierra la OC con
 * esas mismas 4 sin recibir; o falta mercadería al cotejar la guía y luego se
 * cierra la OC por ese mismo saldo). Sin esta llave el solicitante recibiría el
 * mismo aviso dos o tres veces. Se deduplica en dos capas porque los recortes
 * encadenados pueden ocurrir en la misma transacción (memoria) o en
 * transacciones distintas (índice único parcial `notifications_user_dedupe_unique`).
 *
 * LO QUE ESTE MÓDULO NO DECIDE (queda pendiente de producto, ver `REC-002` y
 * `GDI-001`): qué hacer con el saldo muerto del punto 2 —hoy la única salida es
 * cerrar o anular la OC, y no está declarado si debe re-encolarse a compra como
 * hace el punto 1—, ni si la merma de traslado del punto 3 debe corregir el
 * stock del destino (ya cargado completo al despachar) ni contra qué cuenta.
 * Este módulo cierra la brecha de aviso, no la de política.
 */

import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { products, purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { notifyAfterCommit, notifyManyUser } from "./notifications"
import type { CreateNotificationInput } from "./notification-create"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Cuál de los tres puntos de recorte produjo el faltante. */
export type ShortfallCause =
  /** Punto 1 — cierre de OC con recepción parcial. */
  | "oc_cerrada_parcial"
  /** Punto 2 — rechazo o daño al recepcionar. */
  | "recepcion_rechazo"
  /** Punto 3 — diferencia al cotejar la guía de despacho interna. */
  | "cotejo_guia"

export interface RequesterShortfall {
  requestItemId: string
  /** Cantidad que dejó de avanzar por esta vía. Se ignora si no es positiva. */
  missingQuantity: number
  cause: ShortfallCause
  /** Código visible del documento que produjo el recorte (OC, recepción o GDI). */
  documentCode?: string | null
}

/**
 * Notificación ya resuelta (destinatario y texto) pero todavía NO emitida.
 *
 * Se construye DENTRO de la transacción —es ahí donde se puede leer el
 * solicitante— y se emite DESPUÉS del commit: un ROLLBACK posterior no debe
 * dejar avisado a nadie de un recorte que no ocurrió (misma razón que documenta
 * `notifyAfterCommit`).
 */
export interface PendingRequesterNotification {
  userIds: string[]
  input: Omit<CreateNotificationInput, "userId">
}

/** Formato humano: 4 y no "4", 2.5 y no "2.500000001". */
function formatQuantity(quantity: number): string {
  return String(Number(quantity.toFixed(3)))
}

function buildBody(
  cause: ShortfallCause,
  args: { requestCode: string; itemName: string; missing: string; unit: string; documentCode: string | null },
): string {
  const falta = `${args.missing} ${args.unit} de "${args.itemName}" (solicitud ${args.requestCode})`
  switch (cause) {
    case "oc_cerrada_parcial":
      return `Se cerró la orden de compra ${args.documentCode ?? "asociada"} con una recepción parcial: faltan ${falta}. El saldo volvió a la cola de compra como un ítem nuevo.`
    case "recepcion_rechazo":
      return `En la recepción ${args.documentCode ?? "registrada"} se rechazaron o llegaron dañadas ${falta}. Ese saldo no ingresó a stock y sigue pendiente de resolución.`
    case "cotejo_guia":
      return `Al cotejar la guía de despacho ${args.documentCode ?? "interna"} faltaron ${falta} respecto de lo despachado desde oficina.`
  }
}

/**
 * Resuelve los avisos al solicitante de una tanda de recortes.
 *
 * Devuelve las notificaciones listas para emitir; no las emite. El caller las
 * suelta con `flushRequesterShortfallNotifications` una vez que la transacción
 * de negocio commiteó.
 */
export async function collectRequesterShortfallNoticesTx(
  tx: Tx,
  shortfalls: RequesterShortfall[],
): Promise<PendingRequesterNotification[]> {
  const relevant = shortfalls.filter((s) => s.requestItemId && s.missingQuantity > 1e-9)
  if (relevant.length === 0) return []

  const rows = await tx
    .select({
      itemId: purchaseRequestItems.id,
      unitOfMeasure: purchaseRequestItems.unitOfMeasure,
      productNameFree: purchaseRequestItems.productNameFree,
      productName: products.name,
      requestId: purchaseRequests.id,
      requestCode: purchaseRequests.code,
      requesterId: purchaseRequests.requesterId,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
    .where(inArray(purchaseRequestItems.id, [...new Set(relevant.map((s) => s.requestItemId))]))

  const byItemId = new Map(rows.map((row) => [row.itemId, row]))
  const notices: PendingRequesterNotification[] = []
  const seenDedupeKeys = new Set<string>()

  for (const shortfall of relevant) {
    const row = byItemId.get(shortfall.requestItemId)
    if (!row?.requesterId) continue

    const missing = formatQuantity(shortfall.missingQuantity)
    // La llave omite la causa a propósito (ver cabecera): un mismo recorte
    // recorrido por dos puntos distintos debe producir UN aviso.
    const dedupeKey = `saldo-recortado:${row.itemId}:${missing}`
    if (seenDedupeKeys.has(dedupeKey)) continue
    seenDedupeKeys.add(dedupeKey)

    notices.push({
      userIds: [row.requesterId],
      input: {
        type: "request_item_shortfall",
        title: "Tu pedido no llegó completo",
        body: buildBody(shortfall.cause, {
          requestCode: row.requestCode,
          itemName: row.productName ?? row.productNameFree ?? "ítem solicitado",
          missing,
          unit: row.unitOfMeasure,
          documentCode: shortfall.documentCode ?? null,
        }),
        entityType: "purchase_request",
        entityId: row.requestId,
        entityHref: `/solicitudes/${row.requestId}`,
        dedupeKey,
      },
    })
  }

  return notices
}

/**
 * Emite los avisos después del commit. Fire-and-forget: `notifyManyUser` traga y
 * loguea cualquier error, así que un aviso caído nunca tumba la operación de
 * negocio que ya commiteó.
 */
export function flushRequesterShortfallNotifications(notices: PendingRequesterNotification[]): void {
  // Segunda capa de deduplicación: una misma operación puede juntar avisos de
  // dos puntos distintos (p. ej. una recepción con rechazo que además cierra la
  // OC), y cada uno se resolvió en su propia llamada a `collect...`, así que el
  // Set local de esa llamada no los ve. Como los thunks salen en microtasks
  // concurrentes, la deduplicación por índice único llegaría tarde: dos INSERT
  // con la misma llave pueden cruzarse y uno moriría con error en el log.
  const emitted = new Set<string>()
  for (const notice of notices) {
    for (const userId of notice.userIds) {
      const key = notice.input.dedupeKey ? `${userId}|${notice.input.dedupeKey}` : null
      if (key) {
        if (emitted.has(key)) continue
        emitted.add(key)
      }
      notifyAfterCommit(() => notifyManyUser([userId], notice.input))
    }
  }
}
