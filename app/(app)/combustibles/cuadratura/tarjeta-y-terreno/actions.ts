"use server"

import { requirePermission } from "@/lib/auth/can"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { getTaeCopecReconciliation, type TaeCopecFilters } from "@/lib/combustibles/tae-copec-reconciliation"
import { addExportMetadataSheet } from "@/lib/combustibles/xlsx-utils"
import { todayInChile } from "@/lib/utils"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

const MAX_EXPORT_ROWS = 10_000

/** Exporta la cobertura tarjeta-terreno (una fila por equipo y mes) con los mismos filtros de la pantalla. */
export async function exportTaeCopecReconciliationAction(filters: TaeCopecFilters) {
  let session
  try { session = await requirePermission("combustibles:tae_export", FUEL_PATHS.cuadratura) }
  catch { return { ok: false as const, message: "Sin permisos para exportar" } }
  const result = await getTaeCopecReconciliation(session, filters)
  const rows = result.rows.slice(0, MAX_EXPORT_ROWS)
  const ExcelJS = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Tarjeta y terreno")
  sheet.columns = [
    { header: "Mes", key: "month", width: 12 },
    { header: "Faena", key: "worksite", width: 22 },
    { header: "Equipo", key: "equipment", width: 16 },
    { header: "Patente", key: "plate", width: 14 },
    { header: "Terreno litros", key: "tae", width: 14 },
    { header: "Terreno cargas", key: "taeLoads", width: 14 },
    { header: "Tarjeta diésel litros", key: "diesel", width: 20 },
    { header: "Tarjeta BlueMax litros", key: "bluemax", width: 22 },
    { header: "Registros de la tarjeta", key: "tctRecords", width: 20 },
    { header: "Total litros", key: "total", width: 14 },
    { header: "Aparece en", key: "coverage", width: 18 },
    { header: "Tarjeta parcial", key: "tctPartial", width: 16 },
  ]
  const coverageLabels = { both_channels: "Ambos", tae_only: "Sólo terreno", tct_only: "Sólo tarjeta" }
  for (const row of rows) sheet.addRow({ month: row.month, worksite: row.worksiteName, equipment: row.equipment, plate: row.plate, tae: row.taeLiters, taeLoads: row.taeLoads, diesel: row.tctDieselLiters, bluemax: row.tctBlueMaxLiters, tctRecords: row.tctRecords, total: row.totalLiters, coverage: coverageLabels[row.coverage], tctPartial: row.tctPartial ? "Sí — hay un registro de la tarjeta que se extiende más allá del rango y no entra en el total" : "" })
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }
  for (const key of ["tae", "diesel", "bluemax", "total"]) sheet.getColumn(key).numFmt = "#,##0.000"
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  await addExportMetadataSheet(workbook, session, { filters, rowCount: rows.length, from: filters.from, to: filters.to })
  const base64 = await xlsxToBase64(workbook)
  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export",
    entityType: "fuel_reconciliation_export", entityId: nanoid(),
    newState: { rowCount: rows.length, truncated: result.rows.length > MAX_EXPORT_ROWS, filters: filters as Record<string, unknown> },
  })
  return { ok: true as const, data: { base64, filename: `tarjeta_y_terreno_${todayInChile()}.xlsx`, truncated: result.rows.length > MAX_EXPORT_ROWS } }
}
