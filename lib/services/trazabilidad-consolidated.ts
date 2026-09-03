/**
 * lib/services/trazabilidad-consolidated.ts
 *
 * Servicio consolidado de seguimiento de solicitudes y materiales por faena.
 */

import type { Session } from "next-auth"
import {
  TRACEABILITY_CONSOLIDATED_PAGE_SIZE,
  type ConsolidatedFaenaKPIs,
  type ConsolidatedTraceabilityResult,
} from "./trazabilidad-consolidated.types"
import {
  fetchTraceabilityAuxiliaryData,
  fetchRawItemRows,
  fetchLinkedTraceabilityData,
} from "./trazabilidad-consolidated-queries"
import {
  buildConsolidatedRows,
  computeFaenaKPIs,
  applySecondaryFilters,
} from "./trazabilidad-consolidated-builder"

// Re-exportar tipos y helpers para mantener retrocompatibilidad completa
export * from "./trazabilidad-consolidated.types"
export * from "./trazabilidad-consolidated-calc"
export * from "./trazabilidad-consolidated-timeline"
export * from "./trazabilidad-consolidated-builder"

export async function getConsolidatedTraceability(
  searchParams: Record<string, string | string[] | undefined>,
  session: Session,
): Promise<ConsolidatedTraceabilityResult> {
  const sp = searchParams

  // 1. Resolver faenas visibles
  const { allWorksites, categoriesList, suppliersList } = await fetchTraceabilityAuxiliaryData(session, "")

  const defaultFaenaId =
    session.user.primaryWorksiteId && allWorksites.some((w) => w.id === session.user.primaryWorksiteId)
      ? session.user.primaryWorksiteId
      : allWorksites[0]?.id ?? ""

  const filterFaenaId =
    typeof sp.faena === "string" && sp.faena
      ? allWorksites.some((w) => w.id === sp.faena)
        ? sp.faena
        : defaultFaenaId
      : defaultFaenaId

  const activeWorksite = allWorksites.find((w) => w.id === filterFaenaId) ?? null

  const filterEstado = typeof sp.estado === "string" ? sp.estado : ""
  const filterCategoria = typeof sp.categoria === "string" ? sp.categoria : ""
  const filterSolicitante = typeof sp.solicitante === "string" ? sp.solicitante : ""
  const filterProveedor = typeof sp.proveedor === "string" ? sp.proveedor : ""
  const filterQ = typeof sp.q === "string" ? sp.q.trim() : ""
  const filterDesde = typeof sp.desde === "string" ? sp.desde : ""
  const filterHasta = typeof sp.hasta === "string" ? sp.hasta : ""
  const filterPendientes = sp.pendientes === "true" || sp.pendientes === "1"
  const currentPage = Math.max(1, typeof sp.page === "string" ? parseInt(sp.page, 10) || 1 : 1)

  const emptyKpis: ConsolidatedFaenaKPIs = {
    openRequests: 0,
    pendingPurchase: 0,
    awaitingSupplier: 0,
    inOffice: 0,
    pendingDispatch: 0,
    inFaena: 0,
    partiallyDelivered: 0,
    fullyDelivered: 0,
  }

  const currentFilters = {
    faena: filterFaenaId,
    estado: filterEstado,
    categoria: filterCategoria,
    solicitante: filterSolicitante,
    proveedor: filterProveedor,
    q: filterQ,
    desde: filterDesde,
    hasta: filterHasta,
    pendientes: filterPendientes,
  }

  if (!filterFaenaId) {
    return {
      rows: [],
      totalFiltered: 0,
      totalPages: 1,
      safePage: 1,
      activeWorksite: null,
      visibleWorksites: allWorksites,
      categories: categoriesList,
      requesters: [],
      suppliers: suppliersList,
      kpis: emptyKpis,
      filters: { ...currentFilters, faena: "" },
    }
  }

  const { requestersList } = await fetchTraceabilityAuxiliaryData(session, filterFaenaId)

  // 2. Traer ítems de solicitudes de esta faena
  const rawItemRows = await fetchRawItemRows(session, {
    filterFaenaId,
    filterSolicitante,
    filterDesde,
    filterHasta,
  })

  if (rawItemRows.length === 0) {
    return {
      rows: [],
      totalFiltered: 0,
      totalPages: 1,
      safePage: 1,
      activeWorksite,
      visibleWorksites: allWorksites,
      categories: categoriesList,
      requesters: requestersList,
      suppliers: suppliersList,
      kpis: emptyKpis,
      filters: currentFilters,
    }
  }

  const allItemIds = rawItemRows.map((r) => r.itemId)
  const allProductIds = [...new Set(rawItemRows.flatMap((r) => (r.productId ? [r.productId] : [])))]

  // 3. Cargar en paralelo todos los datos vinculados
  const { approvalRows, ocRows, deliveryRows, stockRows, receiptRows, gdiRows } =
    await fetchLinkedTraceabilityData(allItemIds, allProductIds, filterFaenaId)

  // 4. Mapas en memoria
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

  // 5. Construcción y cálculo consolidado
  const consolidatedList = buildConsolidatedRows(
    rawItemRows,
    {
      approvalsByItem,
      ocsByItem,
      deliveriesByItem,
      receiptsByOcItem,
      gdisByOcItem,
      stockByProduct,
    },
    filterFaenaId,
    activeWorksite?.name ?? "Faena",
  )

  // 6. KPIs de faena
  const kpis = computeFaenaKPIs(consolidatedList)

  // 7. Filtros secundarios en memoria
  const filteredList = applySecondaryFilters(consolidatedList, {
    filterEstado,
    filterCategoria,
    filterProveedor,
    filterPendientes,
    filterQ,
    rawItemRows,
    ocsByItem,
  })

  const totalFiltered = filteredList.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / TRACEABILITY_CONSOLIDATED_PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const offset = (safePage - 1) * TRACEABILITY_CONSOLIDATED_PAGE_SIZE
  const paginatedRows = filteredList.slice(offset, offset + TRACEABILITY_CONSOLIDATED_PAGE_SIZE)

  return {
    rows: paginatedRows,
    totalFiltered,
    totalPages,
    safePage,
    activeWorksite,
    visibleWorksites: allWorksites,
    categories: categoriesList,
    requesters: requestersList,
    suppliers: suppliersList,
    kpis,
    filters: currentFilters,
  }
}
