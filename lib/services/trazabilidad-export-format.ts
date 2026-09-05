import type { ReportData, ReportSheet } from "@/lib/reports/export"
import { todayInChile } from "@/lib/utils"
import type {
  ConsolidatedOrder,
  ConsolidatedRequest,
  ConsolidatedRow,
} from "./trazabilidad-consolidated.types"

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

/* ───────────────────────────────────────────────────────────────────────────
 * Export consolidado por solicitud y orden de compra (Task 3 de la migración
 * 2026-09-05). Los ítems dejan de ser la unidad visible: el Excel resume por
 * solicitud y por OC, y conserva el detalle de líneas como evidencia en una
 * hoja propia. La cantidad por UOM nunca se suma entre unidades distintas.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Una hoja por libro del expediente, más el detalle de líneas como evidencia. */
export interface TrazabilidadConsolidadaReport {
  requests: ConsolidatedRequest[]
  orders: ConsolidatedOrder[]
  /** Fecha de corte y ámbito para que la exportación se entienda sola. */
  meta: { desde?: string; hasta?: string; faena?: string; truncado: boolean }
}

function fmtQty(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value)
}

export function buildTrazabilidadConsolidadaReportData(
  report: TrazabilidadConsolidadaReport,
): ReportData {
  const requestsSheet: ReportSheet = {
    worksheetName: "Solicitudes",
    headers: [
      "Faena",
      "Solicitud",
      "Fecha",
      "Solicitante",
      // El estado agregado de la solicitud; el detalle por ítem queda en su hoja.
      "Estado",
      "Líneas",
      "Órdenes de compra",
      "Cantidad solicitada",
      "Cantidad aprobada",
      "Cantidad en OC",
      "Cantidad recibida",
      "Cantidad entregada",
      "Pendiente total",
      "Alerta",
    ],
    rows: report.requests.map((request) => {
      const byUom = request.quantitiesByUom
      return [
        request.worksiteName,
        request.requestCode,
        request.requestDate ? request.requestDate.slice(0, 10) : "",
        request.requesterName,
        request.statusLabel,
        request.lineCount,
        request.orderCount,
        // Las cantidades se muestran por UOM: sumarlas entre unidades distintas
        // no tiene sentido. Si toda la solicitud usa una sola UOM, un total
        // escalar es legible; si mezcla, se detalla por UOM.
        byUom.length <= 1 ? fmtQty(byUom[0]?.requested) : byUom.map((s) => `${s.requested} ${s.uom}`).join(" / "),
        byUom.length <= 1 ? fmtQty(byUom[0]?.approved) : byUom.map((s) => `${s.approved ?? ""} ${s.uom}`).join(" / "),
        byUom.length <= 1 ? fmtQty(byUom[0]?.inOc) : byUom.map((s) => `${s.inOc} ${s.uom}`).join(" / "),
        byUom.length <= 1 ? fmtQty(byUom[0]?.receivedFaena) : byUom.map((s) => `${s.receivedFaena} ${s.uom}`).join(" / "),
        byUom.length <= 1 ? fmtQty(byUom[0]?.delivered) : byUom.map((s) => `${s.delivered} ${s.uom}`).join(" / "),
        fmtQty(request.pendingTotal),
        request.alert ? "Sí" : "No",
      ]
    }),
  }

  const ordersSheet: ReportSheet = {
    worksheetName: "Órdenes de compra",
    headers: [
      "Código OC",
      "Proveedor",
      "Estado",
      "Solicitudes vinculadas",
      "Cantidad en OC",
      "Recibido oficina",
      "Recibido faena",
    ],
    rows: report.orders.map((order) => ({
      code: order.code,
      supplierName: order.supplierName,
      orderStatus: order.orderStatus,
      requests: order.requestIds.join(", "),
      quantities: order.quantitiesByUom,
    })).map((o) => [
      o.code,
      o.supplierName,
      o.orderStatus === "draft" ? "Borrador" : o.orderStatus,
      o.requests,
      o.quantities.map((s) => `${s.inOc} ${s.uom}`).join(" / "),
      o.quantities.map((s) => `${s.receivedOffice} ${s.uom}`).join(" / "),
      o.quantities.map((s) => `${s.receivedFaena} ${s.uom}`).join(" / "),
    ]),
  }

  const linesSheet: ReportSheet = {
    worksheetName: "Detalle de líneas",
    headers: [
      "Solicitud",
      "Categoría",
      "Producto",
      "SKU",
      "Unidad",
      "Solicitado",
      "Aprobado",
      "En OC",
      "Recibido oficina",
      "Recibido faena",
      "Entregado",
      "Pendiente",
      "Estado",
      "Alerta",
    ],
    rows: report.requests.flatMap((request) =>
      request.lines.map((line) => [
        request.requestCode,
        line.categoryName,
        line.productName,
        line.productSku ?? "",
        line.uom,
        line.requested,
        line.approved ?? "",
        line.inOc,
        line.receivedOffice,
        line.receivedFaena,
        line.delivered,
        line.pendingTotal,
        line.computedStatusLabel,
        line.alert ? "Sí" : "No",
      ]),
    ),
  }

  const sheets: ReportSheet[] = [requestsSheet, ordersSheet, linesSheet]

  // OP-02 (auditoría 2026-09-05): el truncamiento por límite de filas no llegaba
  // al libro —sólo viajaba en la cabecera `X-Row-Limit-Applied`, que el enlace
  // de descarga no leía. Una hoja de advertencia hace evidente, dentro del
  // archivo, que los totales cubren sólo el alcance cargado.
  if (report.meta.truncado) {
    sheets.push({
      worksheetName: "Advertencias",
      headers: ["Advertencia", "Detalle"],
      rows: [[
        "Archivo truncado",
        "El límite de filas de exportación se alcanzó; las cifras de esta copia cubren sólo el alcance cargado (los más recientes). Acota con un rango de fechas o una faena para incluir el resto.",
      ]],
    })
  }

  return {
    filenameBase: `trazabilidad-solicitudes-${todayInChile()}`,
    worksheetName: requestsSheet.worksheetName,
    headers: requestsSheet.headers,
    rows: requestsSheet.rows,
    sheets,
    rowLimitApplied: report.meta.truncado,
  }
}
