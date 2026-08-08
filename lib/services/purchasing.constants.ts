export const DELETABLE_ORDER_STATUSES = ["draft", "sent"] as const
export type DeletableOrderStatus = typeof DELETABLE_ORDER_STATUSES[number]

export function isOrderDeletable(status: string, deletedAt?: string | null): boolean {
  if (deletedAt) return false
  return (DELETABLE_ORDER_STATUSES as readonly string[]).includes(status)
}
