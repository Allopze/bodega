/**
 * Exportación Excel de la trazabilidad consolidada.
 *
 * Corre sobre el mismo pipeline que la pantalla (`collectConsolidatedRows`),
 * faena por faena. Antes tenía su propio recorrido de consultas —la matriz
 * vieja— y el archivo salía con "Entregado" en 0, "Pendiente Total" igual a lo
 * solicitado y el estado crudo del ítem (`pending_purchase`) bajo un encabezado
 * que prometía el estado consolidado.
 */
import type { Session } from "next-auth"
import { buildXlsxBuffer } from "@/lib/reports/export"
import {
  buildTrazabilidadConsolidadaReportData,
  type TrazabilidadExportRow,
} from "@/lib/services/trazabilidad-export-format"
import { fetchTraceabilityAuxiliaryData } from "@/lib/services/trazabilidad-consolidated-queries"
import {
  aggregateConsolidatedRows,
  collectConsolidatedRows,
  normalizeConsolidatedFilters,
  type ConsolidatedFilterSet,
  type LinkedMaps,
} from "@/lib/services/trazabilidad-consolidated"
import type {
  ConsolidatedOrder,
  ConsolidatedRequest,
  ConsolidatedRow,
} from "@/lib/services/trazabilidad-consolidated.types"

/** Techo de filas del archivo. Más allá, el libro sería inmanejable. */
export const TRAZABILIDAD_EXPORT_MAX_ROWS = 10_000

export interface TrazabilidadFilters extends Partial<ConsolidatedFilterSet> {
  /** Alias históricos de `desde`/`hasta` que usaba la API antigua. */
  fromDate?: string
  toDate?: string
  worksiteId?: string
}

function toFilterSet(filters: TrazabilidadFilters): ConsolidatedFilterSet {
  return normalizeConsolidatedFilters({
    estado: filters.estado,
    categoria: filters.categoria,
    solicitante: filters.solicitante,
    proveedor: filters.proveedor,
    q: filters.q,
    desde: filters.desde ?? filters.fromDate,
    hasta: filters.hasta ?? filters.toDate,
    pendientes: filters.pendientes ? "true" : "",
  })
}

function toExportRow(row: ConsolidatedRow): TrazabilidadExportRow {
  return {
    worksiteName: row.worksiteName,
    requestCode: row.requestCode,
    requestDate: row.requestDate,
    requesterName: row.requesterName,
    categoryName: row.categoryName,
    productName: row.productName,
    productSku: row.productSku,
    uom: row.uom,
    requested: row.requested,
    approved: row.approved,
    inOc: row.inOc,
    suppliers: row.supplierNames.join(", "),
    ocCodes: row.ocCodes.map((oc) => oc.code).join(", "),
    receivedOffice: row.receivedOffice,
    dispatched: row.dispatched,
    receivedFaena: row.receivedFaena,
    stockInFaena: row.stockInFaena,
    delivered: row.delivered,
    pendingTotal: row.pendingTotal,
    notYetOrdered: row.pendingBreakdown.notYetOrdered,
    pendingFromSupplier: row.pendingBreakdown.pendingFromSupplier,
    inOffice: row.pendingBreakdown.inOffice,
    inTransit: row.pendingBreakdown.inTransit,
    inFaenaAvailable: row.pendingBreakdown.inFaenaAvailable,
    status: row.computedStatusLabel,
    alert: row.alert,
  }
}

/**
 * Filas del export. Sin `worksiteId` recorre todas las faenas visibles.
 *
 * El recorrido es secuencial a propósito: cada faena son varias consultas
 * pesadas y un export es una descarga esporádica, no vale abrirle N ráfagas
 * simultáneas a la base para ganar unos segundos.
 */
export async function buildTrazabilidadRows(
  session: Session,
  filters: TrazabilidadFilters = {},
  maxRows = TRAZABILIDAD_EXPORT_MAX_ROWS,
): Promise<{ rows: TrazabilidadExportRow[]; truncated: boolean }> {
  const { allWorksites } = await fetchTraceabilityAuxiliaryData(session)

  // Intersecta con el alcance: una faena fuera del permiso no devuelve sus
  // filas, devuelve ninguna.
  const targets = filters.worksiteId
    ? allWorksites.filter((w) => w.id === filters.worksiteId)
    : allWorksites

  if (targets.length === 0) return { rows: [], truncated: false }

  const filterSet = toFilterSet(filters)
  const rows: TrazabilidadExportRow[] = []
  let truncated = false

  for (const worksite of targets) {
    if (rows.length >= maxRows) {
      truncated = true
      break
    }

    const collected = await collectConsolidatedRows(session, worksite, filterSet)
    if (collected.truncated) truncated = true

    for (const row of collected.rows) {
      if (rows.length >= maxRows) {
        truncated = true
        break
      }
      rows.push(toExportRow(row))
    }
  }

  return { rows, truncated }
}

/**
 * Datos agregados del export por solicitud/OC (Task 3 de la migración).
 */
export interface TrazabilidadConsolidadaExport {
  requests: ConsolidatedRequest[]
  orders: ConsolidatedOrder[]
  lineRows: TrazabilidadExportRow[]
  truncated: boolean
}

/**
 * Recoge y agrega la trazabilidad de cada faena visible, faena por faena.
 *
 * El límite de filas se aplica sobre las solicitudes agregadas (`requests`):
 * una OC compartida entre varias solicitudes se deduplica en la hoja de OCs.
 * `lineRows` conserva el detalle de líneas como evidencia para la exportación
 * legada mientras dura la migración.
 */
export async function buildTrazabilidadConsolidada(
  session: Session,
  filters: TrazabilidadFilters = {},
  maxRows = TRAZABILIDAD_EXPORT_MAX_ROWS,
): Promise<TrazabilidadConsolidadaExport> {
  const { allWorksites } = await fetchTraceabilityAuxiliaryData(session)
  const targets = filters.worksiteId
    ? allWorksites.filter((w) => w.id === filters.worksiteId)
    : allWorksites

  if (targets.length === 0) {
    return { requests: [], orders: [], lineRows: [], truncated: false }
  }

  const filterSet = toFilterSet(filters)
  const requests: ConsolidatedRequest[] = []
  const lineRows: TrazabilidadExportRow[] = []
  // TR-B1 (auditoría 2026-09-05): la hoja de OCs se construía desde
  // `request.orders`, una proyección por solicitud cuyo `rowsById` sólo
  // contiene las líneas de ESA solicitud. El `requestIds` de una OC compartida
  // quedaba truncado a la solicitud en curso y el `Map.set(...)` que la
  // recorría después la sobrescribía con ese conjunto incompleto — la hoja
  // perdía solicitudes vinculadas de forma no determinista. Para deduplicar las
  // OCs con todos sus `requestIds` se acumulan las líneas y los mapas de todas
  // las faenas y se corre un solo agregado global al final.
  const allLines: ConsolidatedRow[] = []
  const allMaps: LinkedMaps = {
    approvalsByItem: new Map(),
    ocsByItem: new Map(),
    deliveriesByItem: new Map(),
    receiptsByOcItem: new Map(),
    gdisByOcItem: new Map(),
    stockByProduct: new Map(),
  }
  let truncated = false

  for (const worksite of targets) {
    if (requests.length >= maxRows) {
      truncated = true
      break
    }
    const collected = await collectConsolidatedRows(session, worksite, filterSet)
    if (collected.truncated) truncated = true

    for (const request of collected.requests) {
      if (requests.length >= maxRows) {
        truncated = true
        break
      }
      requests.push(request)
      for (const line of request.lines) {
        allLines.push(line)
        lineRows.push(toExportRow(line))
      }
    }
    // Concatenamos cada mapa con su destino correspondiente. Los ids de ítem,
    // línea de OC y producto son únicos por faena, así que las claves no
    // colisionan al unir los mapas de distintas faenas.
    for (const [key, value] of collected.maps.approvalsByItem) allMaps.approvalsByItem.set(key, value)
    for (const [key, value] of collected.maps.ocsByItem) allMaps.ocsByItem.set(key, value)
    for (const [key, value] of collected.maps.deliveriesByItem) allMaps.deliveriesByItem.set(key, value)
    for (const [key, value] of collected.maps.receiptsByOcItem) allMaps.receiptsByOcItem.set(key, value)
    for (const [key, value] of collected.maps.gdisByOcItem) allMaps.gdisByOcItem.set(key, value)
    for (const [key, value] of collected.maps.stockByProduct) allMaps.stockByProduct.set(key, value)
  }

  // El agregado global deduplica OCs por purchaseOrderId conservando todos los
  // requestIds de las líneas que las integran, sin importar el orden de faena.
  const globalOrders = aggregateConsolidatedRows(allLines, allMaps).orders

  return { requests, orders: globalOrders, lineRows, truncated }
}

/**
 * GET handler helper: returns Excel bytes + filename for the trazabilidad export.
 */
export async function getTrazabilidadXlsx(
  session: Session,
  filters: TrazabilidadFilters = {},
  maxRows = TRAZABILIDAD_EXPORT_MAX_ROWS,
): Promise<{
  buffer: ArrayBuffer
  filename: string
  truncated: boolean
}> {
  const { requests, orders, truncated } = await buildTrazabilidadConsolidada(session, filters, maxRows)
  const report = buildTrazabilidadConsolidadaReportData({
    requests,
    orders,
    meta: {
      desde: filters.desde ?? filters.fromDate,
      hasta: filters.hasta ?? filters.toDate,
      faena: filters.worksiteId,
      truncado: truncated,
    },
  })
  return {
    buffer: await buildXlsxBuffer(report),
    filename: `${report.filenameBase}.xlsx`,
    truncated,
  }
}
