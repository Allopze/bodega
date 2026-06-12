/**
 * modules/requests/services/item-state.ts
 *
 * Forward shim → lib/services/item-state.ts
 * Fase 3: el contenido se mueve aquí y lib/ pasa a re-exportar desde aquí.
 */

export type {
  ItemStatus,
} from "@/lib/services/item-state"

export {
  TERMINAL_STATES,
  ALLOWED_TRANSITIONS,
  canTransition,
  getDeliveryTargetStatus,
  submitItem,
  submitItemTx,
  approveItem,
  rejectItem,
  returnItem,
  addItemToPurchaseOrder,
  addItemToPurchaseOrderTx,
  markItemPendingPurchase,
  postponeItem,
  receiveItem,
  receiveItemTx,
  deliverItem,
  deliverItemTx,
} from "@/lib/services/item-state"
