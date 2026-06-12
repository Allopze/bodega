/**
 * modules/warehouse/index.ts — Barrel público del módulo warehouse
 */

// Manifest (para registry)
export { warehouseModule } from "./manifest"

// Schemas del dominio
export { worksiteStock, inventoryMovements } from "./schema"

// Servicios públicos
export type { MovementType, ApplyMovementInput } from "./services/stock"
export { applyMovement, applyMovementTx } from "./services/stock"

export type { StockAlert } from "./services/stock-alerts"
export { getStockAlerts, getCriticalStockAlertCount } from "./services/stock-alerts"
