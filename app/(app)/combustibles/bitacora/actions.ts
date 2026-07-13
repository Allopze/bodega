"use server"

import { requirePermission } from "@/lib/auth/can"
import { getFuelLogExportRows, getFuelLogRowsBySelection, FUEL_LOG_SOURCE_LABEL, type FuelLogFilters, type FuelLogRow, type FuelLogSource } from "@/lib/combustibles/fuel-log"

async function buildWorkbook(rows: FuelLogRow[]) {
  const ExcelJS = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Bitácora general")
  ws.columns = [
    { header: "Fecha y hora", key: "occurredAt", width: 20 },
    { header: "Fuente", key: "source", width: 16 },
    { header: "Faena", key: "worksiteName", width: 20 },
    { header: "Proveedor", key: "supplierName", width: 18 },
    { header: "Lugar de carga", key: "loadingPointName", width: 20 },
    { header: "Código equipo", key: "equipmentCode", width: 14 },
    { header: "Patente", key: "plate", width: 12 },
    { header: "Tipo de equipo", key: "equipmentTypeName", width: 16 },
    { header: "Conductor", key: "driverName", width: 20 },
    { header: "Supervisor", key: "supervisorName", width: 20 },
    { header: "Producto", key: "productName", width: 16 },
    { header: "Litros", key: "liters", width: 12 },
    { header: "Medidor", key: "meterReading", width: 12 },
    { header: "Tipo medidor", key: "meterLabel", width: 14 },
    { header: "Rendimiento", key: "performanceValue", width: 12 },
    { header: "Unidad rendimiento", key: "performanceUnit", width: 14 },
    { header: "Sello retirado", key: "sealRemoved", width: 14 },
    { header: "Sello instalado", key: "sealInstalled", width: 14 },
    { header: "Evidencias", key: "evidenceCount", width: 12 },
    { header: "Observaciones", key: "notes", width: 30 },
    { header: "Estado", key: "statusLabel", width: 14 },
    { header: "Creado por", key: "createdByName", width: 18 },
    { header: "Modificado por", key: "updatedByName", width: 18 },
    { header: "Creado", key: "createdAt", width: 20 },
    { header: "Modificado", key: "updatedAt", width: 20 },
  ]
  ws.getRow(1).font = { bold: true }
  for (const row of rows) {
    ws.addRow({
      ...row,
      source: FUEL_LOG_SOURCE_LABEL[row.source],
      liters: Number(row.liters),
      meterReading: row.meterReading == null ? null : Number(row.meterReading),
      performanceValue: row.performanceValue == null ? null : Number(row.performanceValue),
    })
  }
  return wb
}

function exportFileName(prefix: string) {
  return `${prefix}_${new Date().toISOString().slice(0, 10)}.xlsx`
}

export async function exportFuelLogAction(filters: FuelLogFilters) {
  let session
  try { session = await requirePermission("combustibles:export") }
  catch { return { ok: false as const, message: "Sin permisos para exportar" } }

  const { rows, truncated } = await getFuelLogExportRows(session, filters)
  const wb = await buildWorkbook(rows)
  const buffer = await wb.xlsx.writeBuffer()
  return {
    ok: true as const,
    data: {
      base64: Buffer.from(buffer).toString("base64"),
      filename: exportFileName("bitacora_combustible"),
      truncated,
    },
  }
}

export async function exportFuelLogSelectionAction(selection: Array<{ source: FuelLogSource; id: string }>) {
  let session
  try { session = await requirePermission("combustibles:export") }
  catch { return { ok: false as const, message: "Sin permisos para exportar" } }
  if (!selection.length) return { ok: false as const, message: "No hay filas seleccionadas" }

  const rows = await getFuelLogRowsBySelection(session, selection)
  const wb = await buildWorkbook(rows)
  const buffer = await wb.xlsx.writeBuffer()
  return {
    ok: true as const,
    data: {
      base64: Buffer.from(buffer).toString("base64"),
      filename: exportFileName("bitacora_seleccion"),
      truncated: false,
    },
  }
}
