import type { QueueItem } from "./types"

/**
 * Orden entre elementos de la cola que dependen unos de otros. El motor envía
 * por orden de creación, pero un elemento con espera (backoff) puede quedar
 * atrás y dejaría pasar al siguiente: aquí se dice cuándo uno NO debe salir
 * todavía.
 *
 *  - Una actualización de taller sólo llega después de su registro.
 *  - Una operación de OT espera a las anteriores de la misma OT (tomar → ingreso
 *    → fecha → ítems → terminar).
 *  - Un registro enlazado a una OT espera a las operaciones anteriores de esa OT
 *    (el ingreso la deja «en taller», y sólo entonces acepta registros).
 *  - «Terminar» espera a los registros anteriores enlazados a esa OT (el
 *    servidor exige al menos uno vigente).
 *
 * Una dependencia RECHAZADA no bloquea: el servidor contestará con su motivo en
 * vez de dejar al elemento esperando para siempre. «Anterior» es estricto
 * (`createdAt` menor): así dos elementos nunca se esperan entre sí.
 */

/** Sigue vivo: todavía puede llegar al servidor (pendiente, enviándose o esperando que su autor entre de nuevo). */
const alive = (item: QueueItem) => item.status !== "sent" && item.status !== "rejected"

export function waitsForDependency(item: QueueItem, queue: readonly QueueItem[]): boolean {
  if (item.type === "workshop") {
    // `alive`, no «distinto de enviado»: un registro rechazado no bloquea (si no, la novedad
    // de taller quedaría pendiente para siempre), y su rechazo ya descarta esta novedad.
    return queue.some((other) => other.type === "record" && other.id === item.payload.recordId && alive(other))
  }
  if (item.type === "ot") {
    const { workOrderId } = item.payload
    const earlierOps = queue.some((other) => other.type === "ot" && other.id !== item.id && other.payload.workOrderId === workOrderId && alive(other) && other.createdAt < item.createdAt)
    if (earlierOps) return true
    return item.payload.action === "finish"
      && queue.some((other) => other.type === "record" && other.payload.workOrderId === workOrderId && alive(other) && other.createdAt < item.createdAt)
  }
  if (item.type === "record" && item.payload.workOrderId) {
    const { workOrderId } = item.payload
    return queue.some((other) => other.type === "ot" && other.payload.workOrderId === workOrderId && alive(other) && other.createdAt < item.createdAt)
  }
  return false
}
