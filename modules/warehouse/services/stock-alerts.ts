/**
 * modules/warehouse/services/stock-alerts.ts
 *
 * Forward shim → lib/services/stock-alerts.ts
 */

export type {
  StockAlert,
} from "@/lib/services/stock-alerts"

export {
  getStockAlerts,
  getCriticalStockAlertCount,
} from "@/lib/services/stock-alerts"
