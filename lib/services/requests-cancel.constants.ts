/**
 * Estados del padre en los que todavía se puede cancelar una solicitud.
 *
 * Vive aparte del servicio porque el hook de la UI (`use-request-form.ts`) la
 * necesita en el cliente y no puede importar `cancel-request.ts`, que arrastra
 * `@/db`. Estaba duplicada a mano en los dos lados y las copias divergieron:
 * el hueco de `approved` salió de ahí.
 *
 * `approved` está incluido: una solicitud aprobada sin OC no tenía NINGUNA
 * salida — el botón no se mostraba, la cola de aprobaciones ya no la lista
 * (`lib/approvals-queue.ts` filtra submitted/in_review/partially_approved) y
 * Compras no ofrece descartarla; quedaba flotando en la cola de OC para
 * siempre. Esta lista no es la guarda de seguridad: la que manda es
 * `LOCKED_ITEM_STATUSES` en `cancel-request.ts`, que corta bajo lock si algún
 * ítem ya llegó a OC, recepción o entrega.
 *
 * Fuera a propósito: `in_purchasing` (ya hay OC — se anula la OC, no la
 * solicitud) y los terminales `rejected`/`closed`/`cancelled`.
 */
export const CANCELLABLE_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "partially_approved",
  "approved",
] as const

export function isRequestCancellable(status: string): boolean {
  return (CANCELLABLE_REQUEST_STATUSES as readonly string[]).includes(status)
}
