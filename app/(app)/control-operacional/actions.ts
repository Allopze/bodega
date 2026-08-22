"use server"

import { requirePermission } from "@/lib/auth/can"
import { getOperationalControlHub, resolveOperationalControlPeriod, type OperationalControlPeriod } from "@/lib/services/operational-control"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"

export async function exportOperationalControlXlsxAction(filters: Partial<OperationalControlPeriod>) {
  let session
  try { session = await requirePermission("flota:view", "/control-operacional") }
  catch { return { ok: false as const, message: "Sin permisos para exportar Control operacional" } }
  try {
    const period = resolveOperationalControlPeriod(filters)
    const data = await getOperationalControlHub(session, period)
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Activos")
    sheet.columns = [
      { header: "Contrato", key: "key", width: 34 },
      { header: "Clase", key: "kind", width: 22 },
      { header: "Código", key: "code", width: 18 },
      { header: "Activo", key: "name", width: 30 },
      { header: "Faena", key: "worksite", width: 24 },
      { header: "Estado", key: "status", width: 18 },
      { header: "Mantenciones", key: "maintenance", width: 16 },
      { header: "Backlog", key: "backlog", width: 12 },
      { header: "Inspecciones", key: "inspections", width: 16 },
      { header: "Downtime (h)", key: "downtime", width: 16 },
      ...(data.permissions.canViewCosts ? [{ header: "Costo mantenciones", key: "cost", width: 20 }] : []),
    ]
    for (const asset of data.assets) sheet.addRow({ key: asset.key, kind: asset.kind === "vehicle" ? "Vehículo / equipo móvil" : "Instrumento de servicio", code: asset.code, name: asset.name, worksite: asset.worksiteName, status: asset.operationalStatus, maintenance: asset.maintenanceCount, backlog: asset.openMaintenanceCount, inspections: asset.inspectionCount, downtime: asset.downtimeHours, ...(data.permissions.canViewCosts ? { cost: asset.maintenanceCost } : {}) })
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }
    if (data.permissions.canViewCosts) sheet.getColumn("cost").numFmt = "$#,##0"
    const indicators = workbook.addWorksheet("Indicadores")
    indicators.addRows([
      ["Período", `${period.from} a ${period.to}`],
      ["Disponibilidad (%)", data.metrics.availabilityPercent],
      ["MTBF (h)", data.metrics.mtbfHours],
      ["MTTR (h)", data.metrics.mttrHours],
      ["Downtime (h)", data.metrics.downtimeHours],
      ["Cumplimiento preventivo (%)", data.metrics.preventiveCompliancePercent],
      ["Backlog OT", data.metrics.backlog],
      ...(data.permissions.canViewCosts ? [["Costo mantenciones", data.metrics.maintenanceCost]] : []),
    ])
    indicators.getColumn(1).width = 32
    indicators.getColumn(2).width = 22
    indicators.getRow(1).font = { bold: true }
    addExportMetadataSheet(workbook, session, { filters: period, rowCount: data.assets.length })
    const bytes = await workbook.xlsx.writeBuffer()
    await recordAudit({ userId: session.user.id, action: "export", entityType: "operational_control_report", entityId: nanoid(), newState: { period, rowCount: data.assets.length, includesCosts: data.permissions.canViewCosts } })
    return { ok: true as const, data: { base64: Buffer.from(bytes).toString("base64"), filename: `control_operacional_${period.from}_${period.to}.xlsx` } }
  } catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : "No se pudo exportar el reporte" } }
}
