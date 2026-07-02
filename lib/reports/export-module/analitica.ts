import type { Session } from "next-auth"
import { getAnalyticsDashboard, normalizeAnalyticsFilters } from "@/lib/services/analytics"
import type { ReportCell, ReportData, ReportSheet, ExportFilters } from "./types"

export async function analiticaResumen(session: Session | null, filters: ExportFilters): Promise<ReportData> {
  if (!session) {
    return {
      filenameBase: "analitica-transversal",
      worksheetName: "Analítica",
      headers: ["Sección", "Indicador", "Detalle", "Monto/Cantidad"],
      rows: [],
    }
  }

  const data = await getAnalyticsDashboard(session, normalizeAnalyticsFilters({
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    worksiteId: filters.worksiteId,
    supplierId: filters.supplierId,
    vehicleId: filters.vehicleId,
  }))

  const rows: ReportCell[][] = [
    ["KPI", "Gasto total", `${data.filters.fromDate} a ${data.filters.toDate}`, data.kpis.totalSpend],
    ["KPI", "Gasto período anterior", `${data.kpis.spendVariationPct ?? "sin base"}% variación`, data.kpis.previousTotalSpend],
    ["KPI", "Órdenes de compra", "Cantidad del período", data.kpis.purchaseOrderCount],
    ["KPI", "Aprobaciones pendientes", "Ítems solicitados pendientes", data.kpis.pendingApprovals],
    ["KPI", "Stock crítico", "Productos bajo mínimo", data.kpis.criticalStockCount],
    ["KPI", "Combustible", `${data.kpis.fuelLoadCount} cargas`, data.kpis.fuelLiters],
    ...data.spendByMonth.map((row) => [
      "Tendencia mensual",
      row.month,
      `Compras: ${row.purchasingAmount} · Combustible: ${row.fuelAmount}`,
      row.totalAmount,
    ]),
    ...data.spendByModule.map((row) => [
      "Gasto por tipo",
      row.module,
      "",
      row.totalAmount,
    ]),
    ...data.topSuppliers.map((row) => [
      "Proveedores",
      row.name,
      `${row.module ?? "Compras"} · ${row.count} eventos`,
      row.totalAmount,
    ]),
    ...data.topWorksites.map((row) => [
      "Faenas",
      row.name,
      "",
      row.totalAmount,
    ]),
    ...data.vehicleCosts.map((row) => [
      "Vehículos",
      row.plate,
      `${row.type} · ${row.totalLiters} L · ${row.loadCount} cargas`,
      row.totalOperationalCost,
    ]),
    ...data.stockRisks.map((row) => [
      "Stock crítico",
      row.productName,
      `${row.worksiteName} · stock ${row.currentQty} / mínimo ${row.minStock}`,
      row.currentQty,
    ]),
    ...data.eppDeliveries.map((row) => [
      "EPP",
      row.productName,
      `${row.workerName} · ${row.worksiteName} · ${row.deliveryCount} entregas`,
      row.totalQty,
    ]),
    ...data.alerts.map((alert) => [
      "Alertas",
      `${alert.module} · ${alert.entityLabel}`,
      `${alert.reason} · Acción: ${alert.action}`,
      alert.severity,
    ]),
    ...data.dataGaps.map((gap) => [
      "Brechas",
      "Trazabilidad",
      gap,
      "",
    ]),
  ]

  const sheets: ReportSheet[] = [
    {
      worksheetName: "KPIs",
      headers: ["Indicador", "Detalle", "Valor"],
      rows: [
        ["Gasto total", `${data.filters.fromDate} a ${data.filters.toDate}`, data.kpis.totalSpend],
        ["Gasto período anterior", `${data.kpis.spendVariationPct ?? "sin base"}% variación`, data.kpis.previousTotalSpend],
        ["Órdenes de compra", "Cantidad del período", data.kpis.purchaseOrderCount],
        ["Aprobaciones pendientes", "Ítems solicitados pendientes", data.kpis.pendingApprovals],
        ["Stock crítico", "Productos bajo mínimo", data.kpis.criticalStockCount],
        ["Litros combustible", `${data.kpis.fuelLoadCount} cargas`, data.kpis.fuelLiters],
        ["Promedio OC", "Monto promedio de OC", data.kpis.averageOrderAmount],
      ],
    },
    {
      worksheetName: "Gasto mensual",
      headers: ["Mes", "Compras", "Combustible", "Total"],
      rows: data.spendByMonth.map((row) => [row.month, row.purchasingAmount, row.fuelAmount, row.totalAmount]),
    },
    {
      worksheetName: "Proveedores",
      headers: ["Proveedor", "Módulo", "Eventos", "Monto"],
      rows: data.topSuppliers.map((row) => [row.name, row.module ?? "Compras", row.count, row.totalAmount]),
    },
    {
      worksheetName: "Faenas",
      headers: ["Faena", "Monto"],
      rows: data.topWorksites.map((row) => [row.name, row.totalAmount]),
    },
    {
      worksheetName: "Vehículos",
      headers: ["Patente", "Tipo", "Combustible", "Servicios/Mantenciones", "Total", "Litros", "Cargas", "Km", "Horómetro"],
      rows: data.vehicleCosts.map((row) => [
        row.plate,
        row.type,
        row.totalFuelAmount,
        row.totalServiceAmount,
        row.totalOperationalCost,
        row.totalLiters,
        row.loadCount,
        row.lastOdometerReading,
        row.lastHourMeterReading,
      ]),
    },
    {
      worksheetName: "Stock",
      headers: ["Producto", "SKU", "Faena", "Stock", "Mínimo"],
      rows: data.stockRisks.map((row) => [row.productName, row.sku, row.worksiteName, row.currentQty, row.minStock]),
    },
    {
      worksheetName: "EPP",
      headers: ["Producto", "Trabajador", "Faena", "Cantidad", "Entregas"],
      rows: data.eppDeliveries.map((row) => [row.productName, row.workerName, row.worksiteName, row.totalQty, row.deliveryCount]),
    },
    {
      worksheetName: "Alertas",
      headers: ["Tipo", "Severidad", "Módulo", "Entidad", "Motivo", "Acción", "Detectada"],
      rows: data.alerts.map((alert) => [
        alert.type,
        alert.severity,
        alert.module,
        alert.entityLabel,
        alert.reason,
        alert.action,
        alert.detectedAt,
      ]),
    },
    {
      worksheetName: "Brechas",
      headers: ["Brecha"],
      rows: data.dataGaps.map((gap) => [gap]),
    },
  ]

  return {
    filenameBase: "analitica-transversal",
    worksheetName: "Analítica",
    headers: ["Sección", "Indicador", "Detalle", "Monto/Cantidad"],
    rows,
    sheets,
  }
}
