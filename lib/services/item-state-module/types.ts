/** All valid states for a purchase request item */
export type ItemStatus =
  | "draft"
  | "requested"
  | "approved"
  | "rejected"
  | "returned"
  | "postponed"
  | "pending_purchase"
  | "in_purchase_order"
  | "purchased"
  | "partially_received"
  | "received"
  | "partially_delivered"
  | "delivered"

/** Valid terminal states (no further transitions expected) */
export const TERMINAL_STATES: ItemStatus[] = [
  "rejected",
  "delivered",
]

/** State transition map — which transitions are allowed from each state */
export const ALLOWED_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  draft:              ["requested"],
  requested:          ["approved", "rejected", "returned"],
  approved:           ["rejected", "pending_purchase"],
  rejected:           [],
  returned:           ["requested"],
  postponed:          ["pending_purchase"],
  pending_purchase:   ["in_purchase_order", "postponed"],
  in_purchase_order:  ["purchased", "pending_purchase"],
  purchased:          ["partially_received", "received"],
  partially_received: ["received"],
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
