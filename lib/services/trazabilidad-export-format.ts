import type { ReportData } from "@/lib/reports/export"

export interface TrazabilidadExportRow {
  productName: string
  productSku: string | null
  worksiteName: string
  requestCode: string
  requested: number
  approved: number | null
  inOc: number
  received: number
  status: string
  alert: boolean
}

export function buildTrazabilidadReportData(rows: TrazabilidadExportRow[]): ReportData {
  return {
    filenameBase: `trazabilidad-${new Date().toISOString().slice(0, 10)}`,
    worksheetName: "Trazabilidad",
    headers: [
      "Producto",
      "SKU",
      "Faena",
      "Solicitud",
      "Solicitado",
      "Aprobado",
      "En OC",
      "Recibido",
      "Estado",
      "Alerta",
    ],
    rows: rows.map((row) => [
      row.productName,
      row.productSku ?? "",
      row.worksiteName,
      row.requestCode,
      row.requested,
      row.approved ?? "",
      row.inOc,
      row.received,
      row.status,
      row.alert ? "Sí" : "No",
    ]),
  }
}
