/**
 * modules/receiving/services/receiving.ts
 *
 * Forward shim → lib/services/receiving.ts
 */

export type {
  ReceiptItemInput,
  RegisterReceiptInput,
} from "@/lib/services/receiving"

export {
  registerReceipt,
} from "@/lib/services/receiving"
