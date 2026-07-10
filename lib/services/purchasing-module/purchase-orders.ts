/**
 * Purchase orders — barrel.
 * Re-exports from the following sub-modules:
 *   - purchase-orders-create    (createOrder, createOrdersBySupplier + types)
 *   - purchase-orders-status    (issueOrder, markOrderSent, cancelOrder, confirmOrder)
 *   - purchase-orders-delete    (deleteOrder)
 *   - purchase-orders-edit      (updateSentOrderItems + types)
 */

export {
  createOrder,
  createOrdersBySupplier,
} from "./purchase-orders-create"
export type {
  CreateOrderItemInput,
  CreateOrderInput,
  CreateOrderGroupInput,
  CreateOrdersBySupplierInput,
} from "./purchase-orders-create"

export {
  issueOrder,
  markOrderSent,
  cancelOrder,
  confirmOrder,
} from "./purchase-orders-status"

export {
  deleteOrder,
} from "./purchase-orders-delete"

export {
  DELETABLE_ORDER_STATUSES,
  isOrderDeletable,
  EDITABLE_ITEM_ORDER_STATUSES,
  isOrderItemsEditable,
} from "@/lib/services/purchasing.constants"
export type { DeletableOrderStatus, EditableItemOrderStatus } from "@/lib/services/purchasing.constants"

export {
  updateSentOrderItems,
} from "./purchase-orders-edit"
export type {
  EditableOrderItemInput,
} from "./purchase-orders-edit"
