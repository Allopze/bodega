import type { ReportData } from "@/lib/reports/export"
import { todayInChile } from "@/lib/utils"

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
    filenameBase: `trazabilidad-${todayInChile()}`,
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
