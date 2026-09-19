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
    const data = await getOperationalControlHub(session, period)
    const { canViewMaintenance, canViewInspections, canViewCosts } = data.permissions
    const showCost = canViewMaintenance && canViewCosts
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Activos")
    sheet.columns = buildOperationalAssetExportColumns(canViewMaintenance, canViewInspections, canViewCosts)
    for (const asset of data.assets) {
      sheet.addRow(buildOperationalAssetExportRow(asset, canViewMaintenance, canViewInspections, canViewCosts))
    }
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }
    if (showCost) sheet.getColumn("cost").numFmt = "$#,##0"

    const indicatorRows: (string | number | null)[][] = [
      ["Período", `${period.from} a ${period.to}`],
      ["Disponibilidad (%)", data.metrics.availabilityPercent],
    ]
    if (canViewMaintenance) {
      indicatorRows.push(
        ["MTBF (h)", data.metrics.mtbfHours],
        ["MTTR (h)", data.metrics.mttrHours],
        ["Downtime (h)", data.metrics.downtimeHours],
        ["Cumplimiento preventivo (%)", data.metrics.preventiveCompliancePercent],
        ["Backlog OT", data.metrics.backlog],
      )
    }
    if (showCost) {
      indicatorRows.push(["Costo mantenciones", data.metrics.maintenanceCost])
    }
    const indicators = workbook.addWorksheet("Indicadores")
    indicators.addRows(indicatorRows)
    indicators.getColumn(1).width = 32
    indicators.getColumn(2).width = 22
    indicators.getRow(1).font = { bold: true }

    addExportMetadataSheet(workbook, session, { filters: period, rowCount: data.assets.length })
    const base64 = await xlsxToBase64(workbook)
    await recordAudit({ userId: session.user.id, action: "export", entityType: "operational_control_report", entityId: nanoid(), newState: { period, rowCount: data.assets.length, includesCosts: showCost } })
    return { ok: true as const, data: { base64, filename: `control_operacional_${period.from}_${period.to}.xlsx` } }
  } catch (error) { return { ok: false as const, message: safeActionMessage(error, "No se pudo exportar el reporte") } }
}
