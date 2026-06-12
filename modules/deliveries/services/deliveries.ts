/**
 * modules/deliveries/services/deliveries.ts
 *
 * Forward shim → lib/services/deliveries.ts
 */

export type {
  RegisterWorksiteDeliveryInput,
  DeliveryAttachmentInput,
  RegisterWorkerEppDeliveryInput,
} from "@/lib/services/deliveries"

export {
  registerWorksiteDelivery,
  registerWorkerEppDelivery,
} from "@/lib/services/deliveries"
