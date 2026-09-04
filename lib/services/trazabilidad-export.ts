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
import { buildTrazabilidadReportData, type TrazabilidadExportRow } from "@/lib/services/trazabilidad-export-format"
import { fetchTraceabilityAuxiliaryData } from "@/lib/services/trazabilidad-consolidated-queries"
import {
  collectConsolidatedRows,
  normalizeConsolidatedFilters,
  type ConsolidatedFilterSet,
} from "@/lib/services/trazabilidad-consolidated"
import type { ConsolidatedRow } from "@/lib/services/trazabilidad-consolidated.types"

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
  const { rows, truncated } = await buildTrazabilidadRows(session, filters, maxRows)
  const report = buildTrazabilidadReportData(rows)
  return {
    buffer: await buildXlsxBuffer(report),
    filename: `${report.filenameBase}.xlsx`,
    truncated,
  }
}
