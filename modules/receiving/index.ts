/**
 * modules/receiving/index.ts — Barrel público del módulo receiving
 */

// Manifest (para registry)
export { receivingModule } from "./manifest"

// Schemas del dominio
export { receipts, receiptItems } from "./schema"

// Servicios públicos
export type { ReceiptItemInput, RegisterReceiptInput } from "./services/receiving"
export { registerReceipt } from "./services/receiving"
