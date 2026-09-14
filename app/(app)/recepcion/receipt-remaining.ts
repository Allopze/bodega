/**
 * Cuánto queda por disponer en cada etapa.
 *
 * `REC-002` (auditoría 2026-09-14). El formulario restaba **sólo lo recibido**;
 * el servidor descuenta la disposición completa de la etapa —recibido más
 * rechazado más dañado— contra la capacidad de la línea. Con una OC de 10 en la
 * que la oficina registró 6 recibidas y 4 rechazadas, la línea aparecía
 * pendiente con 4, el input venía precargado en 4, la validación del cliente no
 * marcaba nada, y el envío fallaba con «quedan 0 y estás registrando 4».
 *
 * El camino feliz del formulario —aceptar la cantidad sugerida— era imposible
 * de completar en cuanto había un rechazo parcial, con un mensaje que
 * contradecía los números en pantalla. Ésta es la fórmula del servidor, escrita
 * una vez para las dos orillas.
 */

import type { ReceiptOcItem, ReceiptStage } from "./receipt-form.types"

export type DeliveryMode = "via_oficina" | "directo_faena"

/**
 * El techo de la etapa: lo pedido en oficina y en despacho directo; en faena vía
 * oficina, sólo lo que **llegó** a oficina —lo rechazado allí nunca viajó—.
 */
export function dispositionCapacity(item: ReceiptOcItem, stage: ReceiptStage, deliveryMode: DeliveryMode): number {
  if (stage === "office") return item.quantity
  if (deliveryMode === "directo_faena") return item.quantity
  return item.quantityOfficeReceived
}

/**
 * Lo ya dispuesto en la etapa: recibido + rechazado + dañado.
 *
 * Nunca puede ser menos que lo recibido en esa etapa, y por eso se toma el
 * mayor de los dos: si una pantalla olvidara pasar la disposición, el saldo
 * degrada a la fórmula antigua —conservadora de más— en vez de ofrecer otra vez
 * lo que ya se recibió, que sería el error grave en la dirección contraria.
 */
export function alreadyDisposed(item: ReceiptOcItem, stage: ReceiptStage): number {
  return stage === "office"
    ? Math.max(item.quantityOfficeDisposed, item.quantityOfficeReceived)
    : Math.max(item.quantityFaenaDisposed, item.quantityReceived)
}

/** Lo que la pantalla puede ofrecer, que es exactamente lo que el servidor acepta. */
export function remainingForStage(item: ReceiptOcItem, stage: ReceiptStage, deliveryMode: DeliveryMode): number {
  return Math.max(0, dispositionCapacity(item, stage, deliveryMode) - alreadyDisposed(item, stage))
}

/** ¿Queda algo por disponer en esta etapa, en alguna línea? */
export function stageHasPending(items: ReceiptOcItem[], stage: ReceiptStage, deliveryMode: DeliveryMode): boolean {
  return items.some((item) => remainingForStage(item, stage, deliveryMode) > 0)
}
