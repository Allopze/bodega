/**
 * Stock service — barrel.
 *
 * Re-exports from:
 *   - stock-movement.ts    (applyMovement, applyMovementTx, MovementType, ApplyMovementInput)
 *   - stock-export.ts      (getStockExport, getKardexExport, StockExportFilters, KardexExportFilters)
 *
 * applyMovement is the ONLY place stock is mutated.
 * Every ingress and egress goes through this function atomically.
 */

export {
  applyMovement,
  applyMovementTx,
} from "./stock-movement"
export type {
  MovementType,
  ApplyMovementInput,
} from "./stock-movement"

export {
  getStockExport,
  getKardexExport,
} from "./stock-export"
export type {
  StockExportFilters,
  KardexExportFilters,
} from "./stock-export"
