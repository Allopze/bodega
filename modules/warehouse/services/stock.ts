/**
 * modules/warehouse/services/stock.ts
 *
 * Forward shim → lib/services/stock.ts
 */

export type {
  MovementType,
  ApplyMovementInput,
} from "@/lib/services/stock"

export {
  applyMovement,
  applyMovementTx,
} from "@/lib/services/stock"
