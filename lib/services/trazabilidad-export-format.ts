import type { ReportData } from "@/lib/reports/export"
import { todayInChile } from "@/lib/utils"

/**
 * Una fila del Excel consolidado.
 *
 * Los campos eran opcionales cuando el export corría sobre la matriz vieja y
 * no sabía calcular las etapas: la mitad de las 26 columnas salía vacía o en
 * cero pese a tener encabezado. Ahora las produce el mismo pipeline que la
 * pantalla, así que son obligatorios; sólo siguen admitiendo `null` los dos
 * datos que de verdad pueden no existir (una cantidad aprobada que nadie
 * decidió y el stock de un ítem sin producto de catálogo).
 */
export interface TrazabilidadExportRow {
  worksiteName: string
  requestCode: string
  requestDate: string
  requesterName: string
  categoryName: string
  productName: string
  productSku: string | null
  uom: string
  requested: number
  approved: number | null
  inOc: number
  suppliers: string
  ocCodes: string
  receivedOffice: number
  dispatched: number
  receivedFaena: number
  stockInFaena: number | null
  delivered: number
  pendingTotal: number
  notYetOrdered: number
  pendingFromSupplier: number
  inOffice: number
  inTransit: number
  inFaenaAvailable: number
  /** Etiqueta del estado consolidado, la misma que muestra la tabla. */
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
      row.requesterName,
      row.categoryName,
      row.productName,
      row.productSku ?? "",
      row.uom,
      row.requested,
      // Un cero afirma «no hay»; el vacío dice «no se sabe». Un aprobado
      // ausente leído como cero se confundiría con un rechazo.
      row.approved ?? "",
      row.inOc,
      row.suppliers,
      row.ocCodes,
      row.receivedOffice,
      row.dispatched,
      row.receivedFaena,
      row.stockInFaena ?? "",
      row.delivered,
      row.pendingTotal,
      row.notYetOrdered,
      row.pendingFromSupplier,
      row.inOffice,
      row.inTransit,
      row.inFaenaAvailable,
      row.status,
      row.alert ? "Sí" : "No",
    ]),
  }
}
