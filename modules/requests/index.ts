/**
 * modules/requests/index.ts — Barrel público del módulo requests
 *
 * REGLA DE FRONTERA: otros módulos solo pueden importar desde @/modules/requests
 * (este archivo). Nunca desde @/modules/requests/actions/..., etc.
 */

// Manifest (para registry)
export { requestsModule } from "./manifest"

// Tipos del dominio
export type { ActionState, RequestFormData, RequestItemFormData } from "./validation"
export type { ItemStatus } from "./services/item-state"

// State machine (purchasing, receiving y deliveries necesitan acceso)
export {
  TERMINAL_STATES,
  ALLOWED_TRANSITIONS,
  canTransition,
  getDeliveryTargetStatus,
  submitItemTx,
  approveItem,
  rejectItem,
  returnItem,
  addItemToPurchaseOrderTx,
  markItemPendingPurchase,
  postponeItem,
  receiveItemTx,
  deliverItemTx,
} from "./services/item-state"

// Schemas del dominio (para joins desde otros módulos)
export {
  purchaseRequests,
  purchaseRequestItems,
  requestItemAttributes,
} from "./schema"
