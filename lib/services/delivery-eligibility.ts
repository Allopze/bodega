/**
 * Saldo máximo que puede salir de bodega asociado a una solicitud. El stock
 * físico es una guarda independiente: este cálculo sólo representa evidencia
 * de recepción efectiva en la faena para impedir adelantar la trazabilidad.
 */
export function getTraceableDeliveryBalance({
  requestedQuantity,
  receivedAtFaena,
  deliveredQuantity,
}: {
  requestedQuantity: number
  receivedAtFaena: number
  deliveredQuantity: number
}) {
  const requested = Math.max(0, requestedQuantity)
  const received = Math.max(0, Math.min(requested, receivedAtFaena))
  const delivered = Math.max(0, deliveredQuantity)

  return Math.max(0, received - delivered)
}
