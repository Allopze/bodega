/**
 * lib/services/trazabilidad-consolidated.ts
 *
 * Servicio consolidado de seguimiento de solicitudes y materiales por faena.
 */

import type { Session } from "next-auth"
import {
  isComputedStatus,
  type ConsolidatedFaenaKPIs,
  type ConsolidatedOrder,
  type ConsolidatedRequest,
  type ConsolidatedRow,
  type ConsolidatedTraceabilityResult,
} from "./trazabilidad-consolidated.types"
import {
  fetchTraceabilityAuxiliaryData,
  fetchTraceabilityRequesters,
  fetchRawItemRows,
  fetchLinkedTraceabilityData,
  TRACEABILITY_MAX_ITEM_ROWS,
} from "./trazabilidad-consolidated-queries"
import {
  buildConsolidatedRows,
  applySecondaryFilters,
  applyAggregateFilters,
  computeAggregateKPIs,
  paginateAggregateRequests,
  type LinkedMaps,
} from "./trazabilidad-consolidated-builder"
import { aggregateConsolidatedRows } from "./trazabilidad-consolidated-aggregate"

// Re-exportar tipos y helpers para mantener retrocompatibilidad completa
export * from "./trazabilidad-consolidated.types"
export * from "./trazabilidad-consolidated-calc"
export * from "./trazabilidad-consolidated-timeline"
export * from "./trazabilidad-consolidated-builder"
export {
  aggregateConsolidatedRows,
  computeAggregateStatus,
} from "./trazabilidad-consolidated-aggregate"
export type {
  ConsolidatedRequest,
  ConsolidatedOrder,
  ConsolidatedOrderQuantitySummary,
  ConsolidatedAggregateResult,
} from "./trazabilidad-consolidated.types"
export { TRACEABILITY_MAX_ITEM_ROWS } from "./trazabilidad-consolidated-queries"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Un `?desde=` inválido no es un filtro raro: es una consulta que Postgres
 * rechaza. La fecha se interpola en el `WHERE` como literal de timestamp, así
 * que `?desde=ayer` reventaba la página entera con un 500. Se exige el formato
 * de los inputs `type="date"` y se comprueba que la fecha exista de verdad
 * (`2026-02-31` parsea sin error pero no es un día).
 */
export function normalizeTraceabilityDateParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== "string" || !ISO_DATE.test(raw)) return ""
  const parsed = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return ""
  return parsed.toISOString().slice(0, 10) === raw ? raw : ""
}

function readParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : ""
}

/** Filtros ya normalizados que comparten la pantalla y la exportación. */
export interface ConsolidatedFilterSet {
  estado: string
  categoria: string
  solicitante: string
  proveedor: string
  q: string
  desde: string
  hasta: string
  pendientes: boolean
  /** TR-F1: sólo solicitudes con al menos una OC no-borrador con saldo por recibir. */
  ocPendiente: boolean
}

export function normalizeConsolidatedFilters(
  sp: Record<string, string | string[] | undefined>,
): ConsolidatedFilterSet {
  const rawEstado = readParam(sp.estado)
  return {
    estado: isComputedStatus(rawEstado) ? rawEstado : "",
    categoria: readParam(sp.categoria),
    solicitante: readParam(sp.solicitante),
    proveedor: readParam(sp.proveedor),
    q: readParam(sp.q).trim(),
    desde: normalizeTraceabilityDateParam(sp.desde),
    hasta: normalizeTraceabilityDateParam(sp.hasta),
    pendientes: sp.pendientes === "true" || sp.pendientes === "1",
    ocPendiente: sp.oc_pendiente === "true" || sp.oc_pendiente === "1",
  }
}

export interface CollectedConsolidatedRows {
  /** Filas de evidencia ya filtradas, sin paginar ni historial cronológico. */
  itemRows: ConsolidatedRow[]
  /** Compatibilidad con el export por línea; se elimina al migrarlo en Task 3. */
  rows: ConsolidatedRow[]
  /** Solicitudes filtradas como unidad principal, todavía sin paginar. */
  requests: ConsolidatedRequest[]
  /** OCs únicas dentro del alcance de las solicitudes filtradas. */
  orders: ConsolidatedOrder[]
  maps: LinkedMaps
  truncated: boolean
}

/**
 * Pipeline consolidado de una faena: consulta → agregación → filtros.
 *
 * Es el único lugar donde vive el cálculo, y de él comen la pantalla y el
 * Excel. Antes la exportación tenía su propio recorrido de consultas (la
 * matriz vieja) y el archivo salía con "Entregado" en 0 y el estado crudo del
 * ítem bajo un encabezado que decía "Estado Consolidado".
 */
export async function collectConsolidatedRows(
  session: Session,
  worksite: { id: string; name: string },
  filters: ConsolidatedFilterSet,
): Promise<CollectedConsolidatedRows> {
  const emptyMaps: LinkedMaps = {
    approvalsByItem: new Map(),
    ocsByItem: new Map(),
    deliveriesByItem: new Map(),
    receiptsByOcItem: new Map(),
    gdisByOcItem: new Map(),
    stockByProduct: new Map(),
  }

  const rawItemRows = await fetchRawItemRows(session, {
    filterFaenaId: worksite.id,
    filterSolicitante: filters.solicitante,
    filterDesde: filters.desde,
    filterHasta: filters.hasta,
  })

  if (rawItemRows.length === 0) {
    return {
      itemRows: [],
      rows: [],
      requests: [],
      orders: [],
      maps: emptyMaps,
      truncated: false,
    }
  }

  const truncated = rawItemRows.length >= TRACEABILITY_MAX_ITEM_ROWS
  const allItemIds = rawItemRows.map((r) => r.itemId)
  const allProductIds = [...new Set(rawItemRows.flatMap((r) => (r.productId ? [r.productId] : [])))]

  const { approvalRows, ocRows, deliveryRows, stockRows, receiptRows, gdiRows } =
    await fetchLinkedTraceabilityData(allItemIds, allProductIds, worksite.id)

  const approvalsByItem = new Map<string, typeof approvalRows>()
  for (const a of approvalRows) {
    if (!a.requestItemId) continue
    const arr = approvalsByItem.get(a.requestItemId) ?? []
    arr.push(a)
    approvalsByItem.set(a.requestItemId, arr)
  }

  const ocsByItem = new Map<string, typeof ocRows>()
  for (const o of ocRows) {
    if (!o.requestItemId) continue
    const arr = ocsByItem.get(o.requestItemId) ?? []
    arr.push(o)
    ocsByItem.set(o.requestItemId, arr)
  }

  const deliveriesByItem = new Map<string, typeof deliveryRows>()
  for (const d of deliveryRows) {
    if (!d.requestItemId) continue
    const arr = deliveriesByItem.get(d.requestItemId) ?? []
    arr.push(d)
    deliveriesByItem.set(d.requestItemId, arr)
  }

  const receiptsByOcItem = new Map<string, typeof receiptRows>()
  for (const r of receiptRows) {
    const arr = receiptsByOcItem.get(r.purchaseOrderItemId) ?? []
    arr.push(r)
    receiptsByOcItem.set(r.purchaseOrderItemId, arr)
  }

  const gdisByOcItem = new Map<string, typeof gdiRows>()
  for (const g of gdiRows) {
    if (!g.purchaseOrderItemId) continue
    const arr = gdisByOcItem.get(g.purchaseOrderItemId) ?? []
    arr.push(g)
    gdisByOcItem.set(g.purchaseOrderItemId, arr)
  }

  const stockByProduct = new Map<string, number>()
  for (const s of stockRows) {
    stockByProduct.set(s.productId, s.quantity)
  }

  const maps: LinkedMaps = {
    approvalsByItem,
    ocsByItem,
    deliveriesByItem,
    receiptsByOcItem,
    gdisByOcItem,
    stockByProduct,
  }

  const consolidatedList = buildConsolidatedRows(rawItemRows, maps, worksite.id, worksite.name)

  // Compatibilidad transitoria del export por línea. El pipeline principal
  // filtra solicitudes completas abajo y Task 3 migrará el archivo al agregado.
  const itemRows = applySecondaryFilters(consolidatedList, {
    filterEstado: filters.estado,
    filterCategoria: filters.categoria,
    filterProveedor: filters.proveedor,
    filterPendientes: filters.pendientes,
    filterQ: filters.q,
    ocsByItem,
  })

  const aggregated = aggregateConsolidatedRows(consolidatedList, maps)
  const requests = applyAggregateFilters(aggregated.requests, {
    filterEstado: filters.estado,
    filterCategoria: filters.categoria,
    filterProveedor: filters.proveedor,
    filterPendientes: filters.pendientes,
    filterOcPendiente: filters.ocPendiente,
    filterQ: filters.q,
    ocsByItem,
  })
  const orders = aggregateConsolidatedRows(
    requests.flatMap((request) => request.lines),
    maps,
  ).orders

  return {
    itemRows,
    rows: itemRows,
    requests,
    orders,
    maps,
    truncated,
  }
}

export async function getConsolidatedTraceability(
  searchParams: Record<string, string | string[] | undefined>,
  session: Session,
): Promise<ConsolidatedTraceabilityResult> {
  const sp = searchParams

  // 1. Resolver faenas visibles
  const { allWorksites, categoriesList, suppliersList } = await fetchTraceabilityAuxiliaryData(session)

  const defaultFaenaId =
    session.user.primaryWorksiteId && allWorksites.some((w) => w.id === session.user.primaryWorksiteId)
      ? session.user.primaryWorksiteId
      : allWorksites[0]?.id ?? ""

  const requestedFaena = readParam(sp.faena)
  const filterFaenaId = requestedFaena && allWorksites.some((w) => w.id === requestedFaena)
    ? requestedFaena
    : defaultFaenaId

  const activeWorksite = allWorksites.find((w) => w.id === filterFaenaId) ?? null
  const filters = normalizeConsolidatedFilters(sp)
  const currentPage = Math.max(1, Number.parseInt(readParam(sp.page), 10) || 1)

  const emptyKpis: ConsolidatedFaenaKPIs = {
    openRequests: 0,
    pendingPurchase: 0,
    awaitingSupplier: 0,
    inOffice: 0,
    inFaena: 0,
    partiallyDelivered: 0,
    fullyDelivered: 0,
  }

  const currentFilters = { faena: filterFaenaId, ...filters }

  if (!activeWorksite) {
    return {
      requests: [],
      rows: [],
      totalFiltered: 0,
      totalPages: 1,
      safePage: 1,
      truncated: false,
      activeWorksite: null,
      visibleWorksites: allWorksites,
      categories: categoriesList,
      requesters: [],
      suppliers: suppliersList,
      kpis: emptyKpis,
      filters: { ...currentFilters, faena: "" },
    }
  }

  // 2. Solicitantes de la faena activa + pipeline consolidado
  const [requestersList, collected] = await Promise.all([
    fetchTraceabilityRequesters(activeWorksite.id),
    collectConsolidatedRows(session, activeWorksite, filters),
  ])

  /**
   * 3. KPIs sobre lo filtrado, no sobre la faena completa.
   *
   * Calcularlos antes de los filtros dejaba la pantalla contradiciéndose:
   * "Sin resultados para los filtros seleccionados" encima de siete tarjetas
   * con números. Los KPIs son el resumen de lo que se está mirando.
   */
  const kpis = computeAggregateKPIs(collected.requests, collected.orders)
  const page = paginateAggregateRequests(collected.requests, currentPage, collected.maps)

  // TR-O1 (plan 2026-09-05): el resultado de página exponía `orders` globales
  // que ningún consumidor lee — cada `ConsolidatedRequest` ya trae sus propias
  // OCs (`request.orders`). Se retira del contrato para no dejar código muerto.
  return {
    requests: page.requests,
    rows: page.rows,
    totalFiltered: page.totalFiltered,
    totalPages: page.totalPages,
    safePage: page.safePage,
    truncated: collected.truncated,
    activeWorksite,
    visibleWorksites: allWorksites,
    categories: categoriesList,
    requesters: requestersList,
    suppliers: suppliersList,
    kpis,
    filters: currentFilters,
  }
}
