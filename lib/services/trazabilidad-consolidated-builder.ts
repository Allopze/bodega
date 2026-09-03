import {
  COMPUTED_STATUS_METAS,
  type ConsolidatedRow,
  type ConsolidatedFaenaKPIs,
} from "./trazabilidad-consolidated.types"
import {
  computeItemStatus,
  computePendingBreakdown,
} from "./trazabilidad-consolidated-calc"
import { buildItemTimeline } from "./trazabilidad-consolidated-timeline"
import type {
  fetchRawItemRows,
  fetchLinkedTraceabilityData,
} from "./trazabilidad-consolidated-queries"

export type RawItemRow = Awaited<ReturnType<typeof fetchRawItemRows>>[number]
export type LinkedData = Awaited<ReturnType<typeof fetchLinkedTraceabilityData>>
export type ApprovalRow = LinkedData["approvalRows"][number]
export type OcRow = LinkedData["ocRows"][number]
export type DeliveryRow = LinkedData["deliveryRows"][number]
export type ReceiptRow = LinkedData["receiptRows"][number]
export type GdiRow = LinkedData["gdiRows"][number]

export interface LinkedMaps {
  approvalsByItem: Map<string, ApprovalRow[]>
  ocsByItem: Map<string, OcRow[]>
  deliveriesByItem: Map<string, DeliveryRow[]>
  receiptsByOcItem: Map<string, ReceiptRow[]>
  gdisByOcItem: Map<string, GdiRow[]>
  stockByProduct: Map<string, number>
}

export function buildConsolidatedRows(
  rawItemRows: RawItemRow[],
  maps: LinkedMaps,
  filterFaenaId: string,
  worksiteName: string,
): ConsolidatedRow[] {
  const {
    approvalsByItem,
    ocsByItem,
    deliveriesByItem,
    receiptsByOcItem,
    gdisByOcItem,
    stockByProduct,
  } = maps

  const consolidatedList: ConsolidatedRow[] = []

  for (const item of rawItemRows) {
    const approvals = approvalsByItem.get(item.itemId) ?? []
    const ocs = ocsByItem.get(item.itemId) ?? []
    const delivs = deliveriesByItem.get(item.itemId) ?? []

    const modifiedQty = approvals[0]?.modifiedQty ?? null
    const isApproved =
      item.status === "approved" ||
      item.status === "pending_purchase" ||
      item.status === "in_purchase_order" ||
      item.status === "purchased" ||
      item.status === "partially_received" ||
      item.status === "received" ||
      approvals.length > 0

    const approved = isApproved ? (modifiedQty ?? item.quantity) : null
    const inOc = ocs.reduce((acc, o) => acc + o.quantity, 0)
    const receivedOffice = ocs.reduce((acc, o) => acc + o.quantityOfficeReceived, 0)
    const receivedFaena = ocs.reduce((acc, o) => acc + o.quantityReceived, 0)

    let dispatched = 0
    for (const oc of ocs) {
      const gdis = gdisByOcItem.get(oc.id) ?? []
      for (const g of gdis) {
        dispatched += g.quantity
      }
    }

    const delivered = delivs.reduce((acc, d) => acc + d.quantity, 0)
    const stockInFaena = item.productId ? stockByProduct.get(item.productId) ?? 0 : null

    const computedStatus = computeItemStatus({
      itemStatus: item.status,
      requestStatus: item.requestStatus,
      requested: item.quantity,
      approved,
      inOc,
      receivedOffice,
      dispatched,
      receivedFaena,
      delivered,
    })

    const statusMeta = COMPUTED_STATUS_METAS[computedStatus]

    const pendingBreakdown = computePendingBreakdown({
      requested: item.quantity,
      approved,
      inOc,
      receivedOffice,
      dispatched,
      receivedFaena,
      delivered,
    })

    const productName = item.productNameCatalog ?? item.productNameFree ?? "—"
    const categoryName = item.categoryName ?? "Sin categoría"
    const supplierNames = [...new Set(ocs.map((o) => o.supplierName))]
    const ocCodes = ocs.map((o) => ({
      id: o.purchaseOrderId,
      code: o.orderCode,
      supplierName: o.supplierName,
      quantity: o.quantity,
    }))

    const timeline = buildItemTimeline({
      item: {
        requestId: item.requestId,
        requestCode: item.requestCode,
        requestDate: item.requestDate,
        requesterName: item.requesterName,
        quantity: item.quantity,
        uom: item.uom,
      },
      approvals,
      ocs,
      receiptsByOcItem,
      gdisByOcItem,
      deliveries: delivs,
    })

    const alert = isApproved && approved !== null && inOc < approved

    consolidatedList.push({
      itemId: item.itemId,
      requestId: item.requestId,
      requestCode: item.requestCode,
      requestDate: item.requestDate,
      requesterId: item.requesterId,
      requesterName: item.requesterName,
      deliveryMode: item.deliveryMode,
      urgency: item.urgency,

      productId: item.productId,
      productName,
      productSku: item.productSku,
      categoryName,
      notes: item.notes,
      uom: item.uom,

      worksiteId: filterFaenaId,
      worksiteName,

      requested: item.quantity,
      approved,
      inOc,
      receivedOffice,
      receivedFaena,
      dispatched,
      stockInFaena,
      delivered,

      pendingTotal: pendingBreakdown.pendingTotal,
      pendingBreakdown,

      computedStatus,
      computedStatusLabel: statusMeta.label,
      computedStatusColor: statusMeta.color,

      supplierNames,
      ocCodes,

      lastUpdated: item.updatedAt,
      alert,
      timeline,
    })
  }

  return consolidatedList
}

export function computeFaenaKPIs(rows: ConsolidatedRow[]): ConsolidatedFaenaKPIs {
  const openRequestsSet = new Set<string>()
  let pendingPurchase = 0
  let awaitingSupplier = 0
  let inOffice = 0
  let pendingDispatch = 0
  let inFaena = 0
  let partiallyDelivered = 0
  let fullyDelivered = 0

  for (const row of rows) {
    if (
      row.computedStatus !== "entregado" &&
      row.computedStatus !== "cancelado" &&
      row.computedStatus !== "rechazado"
    ) {
      openRequestsSet.add(row.requestId)
    }
    if (row.pendingBreakdown.notYetOrdered > 0) pendingPurchase++
    if (row.pendingBreakdown.pendingFromSupplier > 0) awaitingSupplier++
    if (row.pendingBreakdown.inOffice > 0) {
      inOffice++
      pendingDispatch++
    }
    if (row.pendingBreakdown.inFaenaAvailable > 0) inFaena++
    if (row.computedStatus === "parcialmente_entregado") partiallyDelivered++
    if (row.computedStatus === "entregado") fullyDelivered++
  }

  return {
    openRequests: openRequestsSet.size,
    pendingPurchase,
    awaitingSupplier,
    inOffice,
    pendingDispatch,
    inFaena,
    partiallyDelivered,
    fullyDelivered,
  }
}

export interface SecondaryFilters {
  filterEstado: string
  filterCategoria: string
  filterProveedor: string
  filterPendientes: boolean
  filterQ: string
  rawItemRows: RawItemRow[]
  ocsByItem: Map<string, OcRow[]>
}

export function applySecondaryFilters(
  rows: ConsolidatedRow[],
  filters: SecondaryFilters,
): ConsolidatedRow[] {
  let filtered = rows
  const {
    filterEstado,
    filterCategoria,
    filterProveedor,
    filterPendientes,
    filterQ,
    rawItemRows,
    ocsByItem,
  } = filters

  if (filterEstado) {
    filtered = filtered.filter((r) => r.computedStatus === filterEstado)
  }
  if (filterCategoria) {
    filtered = filtered.filter((r) => {
      const raw = rawItemRows.find((i) => i.itemId === r.itemId)
      return raw?.categoryId === filterCategoria
    })
  }
  if (filterProveedor) {
    filtered = filtered.filter((r) => {
      const ocs = ocsByItem.get(r.itemId) ?? []
      return ocs.some((o) => o.supplierId === filterProveedor)
    })
  }
  if (filterPendientes) {
    filtered = filtered.filter((r) => r.pendingTotal > 0)
  }
  if (filterQ) {
    const qLower = filterQ.toLowerCase()
    filtered = filtered.filter((r) => {
      if (r.requestCode.toLowerCase().includes(qLower)) return true
      if (r.productName.toLowerCase().includes(qLower)) return true
      if (r.productSku && r.productSku.toLowerCase().includes(qLower)) return true
      if (r.notes && r.notes.toLowerCase().includes(qLower)) return true
      if (r.ocCodes.some((oc) => oc.code.toLowerCase().includes(qLower))) return true
      if (r.supplierNames.some((s) => s.toLowerCase().includes(qLower))) return true
      return false
    })
  }

  return filtered
}
