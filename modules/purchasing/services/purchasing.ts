/**
 * modules/purchasing/services/purchasing.ts
 *
 * Forward shim → lib/services/purchasing.ts
 */

export type {
  CreateOrderItemInput,
  CreateOrderInput,
  CreateOrderGroupInput,
  CreateOrdersBySupplierInput,
} from "@/lib/services/purchasing"

export {
  createOrder,
  createOrdersBySupplier,
  issueOrder,
  markOrderSent,
  cancelOrder,
} from "@/lib/services/purchasing"
