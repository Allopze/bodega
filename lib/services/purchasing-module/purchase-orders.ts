/**
 * Purchase orders — barrel.
 * Re-exports from the following sub-modules:
 *   - purchase-orders-create    (createOrder, createOrdersBySupplier + types)
 *   - purchase-orders-status    (issueAndSendOrder, cancelOrder)
 *   - purchase-orders-delete    (deleteOrder)
 *
 * ARQ-1/F5-3: purchase-orders-edit (updateSentOrderItems) se eliminó — sin UI
 * ni caso de negocio confirmado. Si hace falta editar una OC enviada, se
 * construye a propósito más adelante.
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
  issueAndSendOrder,
  cancelOrder,
} from "./purchase-orders-status"

export { recordOrderItemCost } from "./purchase-orders-item-cost"
export type {
  RecordOrderItemCostInput,
  RecordOrderItemCostResult,
} from "./purchase-orders-item-cost"

export {
  deleteOrder,
} from "./purchase-orders-delete"

export {
  DELETABLE_ORDER_STATUSES,
  isOrderDeletable,
} from "@/lib/services/purchasing.constants"
export type { DeletableOrderStatus } from "@/lib/services/purchasing.constants"
