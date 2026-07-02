export interface AnalyticsFilters {
  fromDate?: string; toDate?: string; worksiteId?: string
  supplierId?: string; vehicleId?: string; requestType?: string
}

export interface AnalyticsKpis {
  totalSpend: number; previousTotalSpend: number; spendVariationPct: number | null
  purchaseOrderCount: number; pendingApprovals: number; criticalStockCount: number
  fuelLiters: number; fuelLoadCount: number; averageOrderAmount: number
}

export interface SpendByMonthRow {
  month: string; purchasingAmount: number; fuelAmount: number; totalAmount: number
}

export interface SpendByModuleRow {
  module: string; totalAmount: number
}

export interface RankingRow {
  id: string; name: string; module?: string; totalAmount: number; count: number
}

export interface WorksiteSpendRow {
  id: string; name: string; totalAmount: number
}

export interface VehicleCostRow {
  id: string; plate: string; type: string
  totalFuelAmount: number; totalServiceAmount: number; totalOperationalCost: number
  totalLiters: number; loadCount: number; maintenanceCount: number
  lastOdometerReading: number | null; lastHourMeterReading: number | null
}

export interface StockRiskRow {
  productId: string; productName: string; sku: string
  worksiteName: string; currentQty: number; minStock: number
}

export interface RotationRow {
  productId: string; productName: string; sku: string
  totalOut: number; movementCount: number
}

export interface EppDeliveryRow {
  productId: string; productName: string; workerName: string
  worksiteName: string; totalQty: number; deliveryCount: number
}

export type AnalyticsAlertSeverity = "low" | "medium" | "high" | "critical"

export interface AnalyticsAlert {
  type: string; severity: AnalyticsAlertSeverity; module: string
  entityLabel: string; reason: string; action: string; detectedAt: string
}

export interface AnalyticsDashboardData {
  filters: Required<Pick<AnalyticsFilters, "fromDate" | "toDate">> & Omit<AnalyticsFilters, "fromDate" | "toDate">
  kpis: AnalyticsKpis; spendByMonth: SpendByMonthRow[]; spendByModule: SpendByModuleRow[]
  topSuppliers: RankingRow[]; topWorksites: WorksiteSpendRow[]; vehicleCosts: VehicleCostRow[]
  stockRisks: StockRiskRow[]; productRotation: RotationRow[]; eppDeliveries: EppDeliveryRow[]
  recentOrders: Array<{ id: string; code: string; worksiteName: string; supplierName: string; totalAmount: number; createdAt: string }>
  alerts: AnalyticsAlert[]; dataGaps: string[]
}
