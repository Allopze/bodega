/** All valid states for a purchase request item */
export type ItemStatus =
  | "draft"
  | "requested"
  | "approved"
  | "rejected"
  | "pending_purchase"
  | "in_purchase_order"
  | "purchased"
  | "partially_received"
  | "received"
  | "partially_delivered"
  | "delivered"

/**
 * State transition map — which transitions are allowed from each state (flujo hacia adelante).
 *
 * Excepción de rollback (B-2): al anular/eliminar una OC, `cancelOrder`/`deleteOrder`
 * revierten los ítems `in_purchase_order`/`purchased` → `pending_purchase` mediante SQL
 * directo con guarda `WHERE status IN (...)`. Es un rollback intencional que no pasa por
 * `canTransition`; por eso `purchased` no lista `pending_purchase` aquí. Ese rollback y el
 * split de compra parcial (que clona el estado del ítem hermano) son hoy los únicos
 * productores de `pending_purchase`.
 *
 * Estados retirados (2026-08-07, simplificación del flujo): `postponed` ya no existe
 * (los ítems postergados migraron a `pending_purchase`). `returned` tampoco: ya
 * estaba muerto para repuestos/servicios desde el 2026-07-29 (excluidos de la
 * cola de aprobación por-ítem, ver lib/approvals-queue.ts) y con `returnItem`
 * eliminado hoy también dejó de producirse para EPP/otro — ningún tipo puede
 * alcanzarlo ya. `draft` sigue vivo, pero solo lo producen repuestos/servicios
 * (flujo por cotización); EPP/otro nacen directamente `requested`.
 */
export const ALLOWED_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  draft:              ["requested"],
  requested:          ["approved", "rejected"],
  approved:           ["rejected", "pending_purchase"],
  rejected:           [],
  pending_purchase:   ["in_purchase_order"],
  in_purchase_order:  ["purchased", "pending_purchase"],
  purchased:          ["partially_received", "received"],
  partially_received: ["received", "partially_delivered", "delivered"],
  received:           ["partially_delivered", "delivered"],
  partially_delivered:["delivered"],
  delivered:          [],
}

/** Check if a state transition is valid */
export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

export function getDeliveryTargetStatus(itemQuantity: number, totalDelivered?: number): ItemStatus {
  return totalDelivered !== undefined && totalDelivered < itemQuantity
    ? "partially_delivered"
    : "delivered"
}
