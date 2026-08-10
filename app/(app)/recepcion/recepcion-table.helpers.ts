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
