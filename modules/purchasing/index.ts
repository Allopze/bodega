/**
 * modules/purchasing/index.ts — Barrel público del módulo purchasing
 */

// Manifest (para registry)
export { purchasingModule } from "./manifest"

// Schemas del dominio
export {
  purchaseOrders,
  purchaseOrderItems,
  quotations,
} from "./schema"

// Servicios públicos
export { computeOrderTotals } from "./services/order-totals"

export type {
  CreateOrderItemInput,
  CreateOrderInput,
  CreateOrdersBySupplierInput,
} from "./services/purchasing"
