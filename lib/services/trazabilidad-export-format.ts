import type { ReportData } from "@/lib/reports/export"
import { todayInChile } from "@/lib/utils"

export interface TrazabilidadExportRow {
  productName: string
  productSku: string | null
  worksiteName: string
  requestCode: string
  requestDate?: string
  requesterName?: string
  categoryName?: string
  uom?: string
  requested: number
  approved: number | null
  inOc: number
  suppliers?: string
  ocCodes?: string
  receivedOffice?: number
  dispatched?: number
  receivedFaena?: number
  stockInFaena?: number | null
  delivered?: number
  pendingTotal?: number
  notYetOrdered?: number
  pendingFromSupplier?: number
  inOffice?: number
  inTransit?: number
  inFaenaAvailable?: number
  received: number
  status: string
  alert: boolean
}

export function buildTrazabilidadReportData(rows: TrazabilidadExportRow[]): ReportData {
  return {
    filenameBase: `seguimiento-trazabilidad-${todayInChile()}`,
    worksheetName: "Trazabilidad por Faena",
    headers: [
      "Faena",
      "Solicitud",
      "Fecha",
      "Solicitante",
      "Categoría",
      "Producto",
      "SKU",
      "Unidad",
      "Solicitado",
      "Aprobado",
      "En OC",
      "Proveedores",
      "Órdenes de Compra",
      "Recibido Oficina",
      "Despachado a Faena",
      "Recibido Faena",
      "Stock en Faena",
      "Entregado",
      "Pendiente Total",
      "Pend. Compra",
      "Pend. Proveedor",
      "En Oficina",
      "En Camino",
      "En Faena por Entregar",
      "Estado Consolidado",
      "Alerta",
    ],
    rows: rows.map((row) => [
      row.worksiteName,
      row.requestCode,
      row.requestDate ? row.requestDate.slice(0, 10) : "",
      row.requesterName ?? "",
      row.categoryName ?? "",
      row.productName,
      row.productSku ?? "",
      row.uom ?? "unidad",
      row.requested,
      row.approved ?? "",
      row.inOc,
      row.suppliers ?? "",
      row.ocCodes ?? "",
      row.receivedOffice ?? 0,
      row.dispatched ?? 0,
      row.receivedFaena ?? row.received,
      row.stockInFaena !== null && row.stockInFaena !== undefined ? row.stockInFaena : "",
      row.delivered ?? 0,
      row.pendingTotal ?? Math.max(0, row.requested - (row.delivered ?? 0)),
      row.notYetOrdered ?? "",
      row.pendingFromSupplier ?? "",
      row.inOffice ?? "",
      row.inTransit ?? "",
      row.inFaenaAvailable ?? "",
      row.status,
      row.alert ? "Sí" : "No",
    ]),
  }
}
