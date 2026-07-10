export const DELETABLE_ORDER_STATUSES = ["draft", "issued", "sent"] as const
export type DeletableOrderStatus = typeof DELETABLE_ORDER_STATUSES[number]

export function isOrderDeletable(status: string): status is DeletableOrderStatus {
  return (DELETABLE_ORDER_STATUSES as readonly string[]).includes(status)
}

export const EDITABLE_ITEM_ORDER_STATUSES = ["sent", "supplier_confirmed"] as const
export type EditableItemOrderStatus = typeof EDITABLE_ITEM_ORDER_STATUSES[number]

/**
 * An OC's items can only be corrected while nothing has been received yet.
 * The status check alone is close to sufficient — registerReceipt() rolls the
 * order status forward off "sent"/"supplier_confirmed" the moment any item
 * gets a nonzero quantityOfficeReceived/quantityReceived — but totalReceived
 * is checked explicitly too, matching the "sin recepción" requirement literally.
 */
export function isOrderItemsEditable(status: string, totalReceived: number): boolean {
  return (EDITABLE_ITEM_ORDER_STATUSES as readonly string[]).includes(status) && totalReceived === 0
}
