"use server"

import { safeActionMessage } from "@/lib/action-error"

import { requireAnyPermission } from "@/lib/auth/can"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { getOperationalControlHub, resolveOperationalControlPeriod, type OperationalControlPeriod } from "@/lib/services/operational-control"
import { OPERATIONAL_CONTROL_VIEW_PERMISSIONS } from "@/lib/operational-control/capabilities"
import { buildOperationalAssetExportColumns, buildOperationalAssetExportRow } from "@/lib/operational-control/export-columns"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"

export async function exportOperationalControlXlsxAction(filters: Partial<OperationalControlPeriod>) {
  let session
  try { session = await requireAnyPermission(OPERATIONAL_CONTROL_VIEW_PERMISSIONS, "/control-operacional") }
  catch { return { ok: false as const, message: "Sin permisos para exportar Control operacional" } }
  try {
    const period = resolveOperationalControlPeriod(filters)
    // El Excel lleva activos e indicadores; los conteos de «Requiere atención» son del panel.
    const data = await getOperationalControlHub(session, period, { includeAttention: false })
    const { canViewFleet, canViewMaintenance, canViewInspections, canViewCapa, canViewFuel, canViewCosts } = data.permissions
    const showCost = canViewMaintenance && canViewCosts
    const showFuelCost = canViewFuel && canViewCosts
    // Los instrumentos de servicio no tienen OT ni combustible modelado; no se
    // exportan como activos operacionales para no pintar filas inertes.
    const operationalAssets = data.assets.filter((asset) => asset.kind === "vehicle")
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Activos")
    sheet.columns = buildOperationalAssetExportColumns(canViewMaintenance, canViewInspections, canViewCosts, canViewFuel, canViewCapa, canViewFleet)
    for (const asset of operationalAssets) {
      sheet.addRow(buildOperationalAssetExportRow(asset, canViewMaintenance, canViewInspections, canViewCosts, canViewFuel, canViewCapa, canViewFleet))
    }
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }
    if (showCost) {
      sheet.getColumn("approvedCost").numFmt = "$#,##0"
      sheet.getColumn("committedCost").numFmt = "$#,##0"
    }
    if (showFuelCost) sheet.getColumn("fuelCost").numFmt = "$#,##0"
    if (showCost && showFuelCost) sheet.getColumn("operationalCost").numFmt = "$#,##0"
    if (canViewInspections) sheet.getColumn("inspectionCompliance").numFmt = '0.0"%"'

    const indicatorRows: (string | number | null)[][] = [
      ["Período", `${period.from} a ${period.to}`],
      ["Disponibilidad (%)", data.metrics.availabilityPercent],
      ["Cobertura de estado (%)", data.metrics.stateCoveragePercent],
    ]
    if (canViewFuel) {
      indicatorRows.push(["Litros operacionales", operationalAssets.reduce((sum, asset) => sum + (asset.fuelLiters ?? 0), 0)])
    }
    if (showFuelCost) {
      indicatorRows.push(["Costo combustible facturado", operationalAssets.reduce((sum, asset) => sum + (asset.fuelBilledAmount ?? 0), 0)])
    }
    if (canViewInspections) {
      indicatorRows.push(
        ["Hallazgos abiertos", operationalAssets.reduce((sum, asset) => sum + (asset.openFindings ?? 0), 0)],
        ["Hallazgos críticos", operationalAssets.reduce((sum, asset) => sum + (asset.criticalOpenFindings ?? 0), 0)],
      )
    }
    if (canViewInspections && canViewCapa) {
      indicatorRows.push(["CAPA vencidas", operationalAssets.reduce((sum, asset) => sum + (asset.overdueCapa ?? 0), 0)])
    }
    if (data.degradedSources.length > 0) {
      indicatorRows.push(["Secciones no cargadas", data.degradedSources.join(", ")])
    }
    if (canViewMaintenance) {
      indicatorRows.push(
        ["MTBF (h)", data.metrics.mtbfHours],
        ["MTTR (h)", data.metrics.mttrHours],
        ["Downtime (h)", data.metrics.downtimeHours],
        ["Cumplimiento preventivo (%)", data.metrics.preventiveCompliancePercent],
        ["Adherencia al plan (%)", data.metrics.planAdherencePercent],
        ["Backlog OT", data.metrics.backlog],
        ["OT fuera de SLA", data.metrics.overdueSla],
        ["OT sin responsable", data.metrics.unassignedOpen],
      )
    }
    if (showCost) {
      indicatorRows.push(
        ["Costo aprobado", data.metrics.maintenanceCostApproved],
        ["Costo comprometido", data.metrics.maintenanceCost],
      )
    }
    const indicators = workbook.addWorksheet("Indicadores")
    indicators.addRows(indicatorRows)
    indicators.getColumn(1).width = 32
    indicators.getColumn(2).width = 22
    indicators.getRow(1).font = { bold: true }

    await addExportMetadataSheet(workbook, session, { filters: period, rowCount: operationalAssets.length })
    const base64 = await xlsxToBase64(workbook)
    await recordAudit({ userId: session.user.id, action: "export", entityType: "operational_control_report", entityId: nanoid(), newState: { period, rowCount: operationalAssets.length, includesCosts: showCost, includesFuelCosts: showFuelCost, includesCapa: canViewInspections && canViewCapa } })
    return { ok: true as const, data: { base64, filename: `control_operacional_${period.from}_${period.to}.xlsx` } }
  } catch (error) { return { ok: false as const, message: safeActionMessage(error, "No se pudo exportar el reporte") } }
}
