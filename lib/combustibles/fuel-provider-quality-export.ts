export interface FuelProviderQualityExportRow {
  tipo: "pendiente" | "rechazo"
  proveedor: string
  cuenta: string
  identidad: string
  codigo: string
  motivo: string
  producto: string
  patente: string
  fecha: string
  litros: number | null
  monto: number | null
}

/** Construye el libro de calidad sin incluir el payload crudo del proveedor. */
export async function buildFuelProviderQualityWorkbook(rows: FuelProviderQualityExportRow[]) {
  const ExcelJS = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Pendientes y rechazos")
  sheet.columns = [
    { header: "Tipo", key: "tipo", width: 14 },
    { header: "Proveedor", key: "proveedor", width: 14 },
    { header: "Cuenta", key: "cuenta", width: 18 },
    { header: "Identidad", key: "identidad", width: 34 },
    { header: "Código", key: "codigo", width: 24 },
    { header: "Motivo", key: "motivo", width: 48 },
    { header: "Producto origen", key: "producto", width: 24 },
    { header: "Patente origen", key: "patente", width: 18 },
    { header: "Fecha", key: "fecha", width: 22 },
    { header: "Litros", key: "litros", width: 14 },
    { header: "Monto", key: "monto", width: 16 },
  ]
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } }
  for (const row of rows) sheet.addRow(row)
  sheet.getColumn("litros").numFmt = "#,##0.00"
  sheet.getColumn("monto").numFmt = "$#,##0"
  sheet.autoFilter = { from: "A1", to: `K${Math.max(rows.length + 1, 2)}` }
  return workbook
}
