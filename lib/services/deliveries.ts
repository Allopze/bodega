/**
 * Deliveries service — faena and worker delivery lifecycle.
 */
export type {
  DeliveryAttachmentInput,
  RegisterWorkerStockDeliveryInput,
  WorkerStockDeliveryItemInput,
} from "./deliveries.types"

export { registerWorkerStockDelivery } from "./deliveries-worker-stock"
