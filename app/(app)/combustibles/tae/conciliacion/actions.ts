"use server"

import { requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { getTaeCopecReconciliation, type TaeCopecFilters } from "@/lib/combustibles/tae-copec-reconciliation"
import { addExportMetadataSheet } from "@/lib/combustibles/xlsx-utils"

const MAX_EXPORT_ROWS = 10_000

export async function exportTaeCopecReconciliationAction(filters: TaeCopecFilters) {
  let session
  try { session = await requirePermission("combustibles:tae_export") }
  catch { return { ok: false as const, message: "Sin permisos para exportar" } }
  const result = await getTaeCopecReconciliation(session, filters)
  const rows = result.rows.slice(0, MAX_EXPORT_ROWS)
  const ExcelJS = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Conciliación por canal")
  sheet.columns = [
    { header: "Mes", key: "month", width: 12 },
    { header: "Faena", key: "worksite", width: 22 },
    { header: "Equipo", key: "equipment", width: 16 },
    { header: "Patente", key: "plate", width: 14 },
    { header: "TAE litros", key: "tae", width: 14 },
    { header: "TAE cargas", key: "taeLoads", width: 12 },
    { header: "TCT Diésel litros", key: "diesel", width: 18 },
    { header: "TCT BlueMax litros", key: "bluemax", width: 20 },
    { header: "TCT registros", key: "tctRecords", width: 14 },
    { header: "Total litros", key: "total", width: 14 },
    { header: "Cobertura", key: "coverage", width: 18 },
    { header: "TCT parcial", key: "tctPartial", width: 14 },
  ]
  const coverageLabels = { both_channels: "Ambos canales", tae_only: "Solo TAE", tct_only: "Solo TCT" }
  for (const row of rows) sheet.addRow({ month: row.month, worksite: row.worksiteName, equipment: row.equipment, plate: row.plate, tae: row.taeLiters, taeLoads: row.taeLoads, diesel: row.tctDieselLiters, bluemax: row.tctBlueMaxLiters, tctRecords: row.tctRecords, total: row.totalLiters, coverage: coverageLabels[row.coverage], tctPartial: row.tctPartial ? "Sí — período fuera del rango excluido del total" : "" })
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }
  for (const key of ["tae", "diesel", "bluemax", "total"]) sheet.getColumn(key).numFmt = "#,##0.000"
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  addExportMetadataSheet(workbook, session, { filters, rowCount: rows.length, from: filters.from, to: filters.to })
  const buffer = await workbook.xlsx.writeBuffer()
  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export",
    entityType: "fuel_reconciliation_export", entityId: nanoid(),
    newState: { rowCount: rows.length, truncated: result.rows.length > MAX_EXPORT_ROWS, filters: filters as Record<string, unknown> },
  })
  return { ok: true as const, data: { base64: Buffer.from(buffer).toString("base64"), filename: `conciliacion_tae_tct_${new Date().toISOString().slice(0, 10)}.xlsx`, truncated: result.rows.length > MAX_EXPORT_ROWS } }
}
