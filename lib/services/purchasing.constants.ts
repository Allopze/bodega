export const DELETABLE_ORDER_STATUSES = ["draft", "issued", "sent"] as const
export type DeletableOrderStatus = typeof DELETABLE_ORDER_STATUSES[number]

export function isOrderDeletable(status: string): status is DeletableOrderStatus {
  return (DELETABLE_ORDER_STATUSES as readonly string[]).includes(status)
}
