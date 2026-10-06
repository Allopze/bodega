/** La CTA sólo aparece cuando el permiso y la etapa habilitan una recepción real. */
export function canRegisterReceiptForOrder(
  deliveryMode: string,
  status: string,
  canOffice: boolean,
  canFaena: boolean,
) {
  if (deliveryMode === "directo_faena") return canFaena

  // Una OC vía oficina sólo habilita faena después de que algo llegó a la
  // oficina. En las etapas parciales pueden coexistir ambas acciones; en las
  // completas queda sólo la que aún tiene saldo operativo.
  if (status === "sent") return canOffice
  if (status === "office_received") return canFaena
  return canOffice || canFaena
}

/**
 * ADQ-11: un solo verbo para lo que se hace con una guía viva desde la bandeja.
 * Antes la misma acción se llamaba "Cotejar" (escritorio), "Cotejar entrega en
 * faena" (móvil y detalle de la OC), "Cotejar en faena" (detalle de la
 * recepción) y "Completar guía": cuatro rótulos para dos acciones. "Cotejar" es
 * jerga de bodega; el trabajador de faena lo que hace es confirmar que llegó.
 *
 * Borrador → la oficina completa el despacho. Despachada/parcial → la faena
 * confirma la llegada.
 */
export const GUIDE_ACTION_COMPLETE_DISPATCH = "Completar despacho"
export const GUIDE_ACTION_CONFIRM_ARRIVAL = "Confirmar llegada a faena"

export function receiptGuideActionLabel(guideStatus: string): string {
  return guideStatus === "draft" ? GUIDE_ACTION_COMPLETE_DISPATCH : GUIDE_ACTION_CONFIRM_ARRIVAL
}
