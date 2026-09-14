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

export type ReceiptGuideSignal = { label: string; variant: "warning" | "info" | "danger" }

/**
 * REC-005 (auditoría 2026-09-14): las tres señales de la guía de despacho
 * vivían escritas a mano dentro de `renderRow`, así que la tarjeta móvil —que
 * existe justamente porque la recepción se hace en faena (comentario A-1)—
 * pintaba sólo el `gapMap` y perdía los tres estados. Quien recibía en terreno
 * no veía la "Diferencia en faena" que sí veía quien miraba el escritorio, aun
 * cuando el rótulo del botón ya había cambiado a "Cotejar entrega en faena".
 *
 * Ahora es una sola función y las dos vistas la llaman: la única forma de que
 * no vuelvan a divergir.
 *
 * No se inventa política: el mapa `estado → variante` es exactamente el que ya
 * usaba el escritorio —borrador → `warning` (falta despachar), despachada →
 * `info` (en curso, nada que hacer todavía), parcialmente recibida → `danger`
 * (hay una diferencia ya detectada)—. Devuelve `null` cuando no hay guía viva;
 * ahí cada vista sigue pintando su propio recuento de `gapMap`, que conserva
 * rótulos distintos por el ancho disponible (columna `w-32` vs. tarjeta).
 */
export function receiptGuideSignal(activeGuideStatus: string | undefined): ReceiptGuideSignal | null {
  if (activeGuideStatus === "draft") return { label: "Pendiente de despacho", variant: "warning" }
  if (activeGuideStatus === "dispatched") return { label: "En traslado", variant: "info" }
  if (activeGuideStatus === "partially_received") return { label: "Diferencia en faena", variant: "danger" }
  return null
}
