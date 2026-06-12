/**
 * modules/deliveries/index.ts — Barrel público del módulo deliveries
 */

// Manifest (para registry)
export { deliveriesModule } from "./manifest"

// Schemas del dominio
export { deliveries, deliveryItems } from "./schema"

// Servicios públicos
export type {
  RegisterWorksiteDeliveryInput,
  RegisterWorkerEppDeliveryInput,
} from "./services/deliveries"

export {
  registerWorksiteDelivery,
  registerWorkerEppDelivery,
} from "./services/deliveries"
