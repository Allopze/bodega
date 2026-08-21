import type { AnalyticsAlert, StockRiskRow, VehicleCostRow, RankingRow, EppDeliveryRow } from "./types"

export function buildAlerts(input: {
  stockRisks: StockRiskRow[]; vehicleCosts: VehicleCostRow[]
  topSuppliers: RankingRow[]; eppDeliveries: EppDeliveryRow[]
  totalSpend: number; thresholds: { vehicleMonthlyAnomalyAmount: number; supplierConcentrationPct: number; eppRecurringDeliveryCount: number }
  detectedAt: string; noData: boolean; includeMaintenanceCosts?: boolean
}): AnalyticsAlert[] {
  const alerts: AnalyticsAlert[] = []

  for (const row of input.stockRisks.slice(0, 5)) {
    alerts.push({ type: "stock_bajo", severity: "critical", module: "Bodega", entityLabel: row.productName, reason: `${row.worksiteName}: stock ${row.currentQty} bajo mínimo ${row.minStock}.`, action: "Revisar reposición o traslado antes de aprobar nuevas salidas.", detectedAt: input.detectedAt })
  }

  for (const row of input.vehicleCosts.filter((v) => v.totalOperationalCost >= input.thresholds.vehicleMonthlyAnomalyAmount).slice(0, 3)) {
    alerts.push({
      type: "gasto_vehiculo_anomalo",
      severity: "high",
      module: "Vehículos",
      entityLabel: row.plate,
      reason: `${input.includeMaintenanceCosts ? "Costo operacional" : "Gasto de combustible"} ${row.totalOperationalCost} supera el umbral configurado ${input.thresholds.vehicleMonthlyAnomalyAmount}.`,
      action: input.includeMaintenanceCosts
        ? "Revisar combustible, mantenciones e imputaciones asociadas al vehículo."
        : "Revisar cargas y consumo de combustible asociados al vehículo.",
      detectedAt: input.detectedAt,
    })
  }

  for (const row of input.topSuppliers.filter((s) => input.totalSpend > 0 && (s.totalAmount / input.totalSpend) * 100 >= input.thresholds.supplierConcentrationPct).slice(0, 3)) {
    alerts.push({ type: "proveedor_concentrado", severity: "medium", module: "Proveedores", entityLabel: row.name, reason: `Concentra ${Math.round((row.totalAmount / input.totalSpend) * 100)}% del gasto del período.`, action: "Validar dependencia operativa, alternativas y condiciones comerciales.", detectedAt: input.detectedAt })
  }

  for (const row of input.eppDeliveries.filter((d) => d.deliveryCount >= input.thresholds.eppRecurringDeliveryCount).slice(0, 3)) {
    alerts.push({ type: "epp_recurrente", severity: "medium", module: "EPP", entityLabel: row.workerName, reason: `${row.deliveryCount} entregas de ${row.productName} en el período.`, action: "Revisar desgaste, cargo o necesidad de stock permanente por faena.", detectedAt: input.detectedAt })
  }

  if (input.noData) {
    alerts.push({ type: "sin_datos", severity: "low", module: "Analítica", entityLabel: "Período filtrado", reason: "No hay registros suficientes para calcular indicadores transversales con los filtros actuales.", action: "Ampliar el rango de fechas o revisar registros de compras, combustible, stock y entregas.", detectedAt: input.detectedAt })
  }

  return alerts
}
