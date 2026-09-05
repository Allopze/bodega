import {
  COMPUTED_STATUS_METAS,
  isComputedStatus,
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

/** Estados en los que ya no hay nada que comprar y la alerta sería ruido. */
const CLOSED_STATUSES = new Set(["rechazado", "cancelado", "borrador", "entregado"])

/**
 * Construye las filas consolidadas **sin** su historial cronológico.
 *
 * El timeline de un ítem cuesta recorrer sus aprobaciones, OCs, recepciones,
 * guías y entregas, y sólo se ve al expandir una fila. Construirlo acá lo
 * armaba para todos los ítems de la faena para después quedarse con 25 en el
 * `slice()` de la paginación: ahora se cuelga al final, sobre la página real,
 * con `attachTimelines`.
 */
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
    gdisByOcItem,
    stockByProduct,
  } = maps

  const consolidatedList: ConsolidatedRow[] = []

  for (const item of rawItemRows) {
    const approvals = approvalsByItem.get(item.itemId) ?? []
    const ocs = ocsByItem.get(item.itemId) ?? []
    const delivs = deliveriesByItem.get(item.itemId) ?? []

    // Las decisiones vienen en orden cronológico: la cantidad autorizada la
    // fija la última, no la primera. Un `modify` seguido de un `approve`
    // simple vuelve a la cantidad pedida, y al revés la recorta.
    const lastDecision = approvals.length > 0 ? approvals[approvals.length - 1] : null
    const modifiedQty = lastDecision?.modifiedQty ?? null
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

    // Las entregas anuladas no entregaron nada: contarlas daba ítems
    // "Entregado" con el material todavía en la faena, y un saldo por entregar
    // que no cuadraba con el stock. Siguen visibles en el historial, marcadas.
    const delivered = delivs.reduce((acc, d) => acc + (d.voidedAt ? 0 : d.quantity), 0)
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

    /**
     * La alerta significa "quedan unidades autorizadas que nadie compró".
     *
     * Antes era `inOc < approved` a secas y se encendía en cualquier ítem
     * servido desde el stock de la faena (que nunca pasa por una OC) y en
     * ítems ya cerrados: filas en ámbar permanente que la gente aprendió a
     * ignorar. `pendingTotal` cubre el primer caso y `CLOSED_STATUSES` el
     * segundo.
     */
    const alert =
      pendingBreakdown.notYetOrdered > 0 &&
      pendingBreakdown.pendingTotal > 0 &&
      !CLOSED_STATUSES.has(computedStatus)

    consolidatedList.push({
      itemId: item.itemId,
      requestId: item.requestId,
      requestCode: item.requestCode,
      requestDate: item.requestDate,
      requesterId: item.requesterId,
      requesterName: item.requesterName,
      deliveryMode: item.deliveryMode,
      urgency: item.urgency,
      requestUrgency: item.requestUrgency,

      productId: item.productId,
      productName,
      productSku: item.productSku,
      categoryId: item.categoryId,
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
      timeline: [],
    })
  }

  return consolidatedList
}

/** Cuelga el historial cronológico sólo en las filas que se van a mostrar. */
export function attachTimelines(rows: ConsolidatedRow[], maps: LinkedMaps): ConsolidatedRow[] {
  const { approvalsByItem, ocsByItem, deliveriesByItem, receiptsByOcItem, gdisByOcItem } = maps

  return rows.map((row) => ({
    ...row,
    timeline: buildItemTimeline({
      item: {
        requestId: row.requestId,
        requestCode: row.requestCode,
        requestDate: row.requestDate,
        requesterName: row.requesterName,
        quantity: row.requested,
        uom: row.uom,
      },
      approvals: approvalsByItem.get(row.itemId) ?? [],
      ocs: ocsByItem.get(row.itemId) ?? [],
      receiptsByOcItem,
      gdisByOcItem,
      deliveries: deliveriesByItem.get(row.itemId) ?? [],
    }),
  }))
}

export function computeFaenaKPIs(rows: ConsolidatedRow[]): ConsolidatedFaenaKPIs {
  const openRequestsSet = new Set<string>()
  let pendingPurchase = 0
  let awaitingSupplier = 0
  let inOffice = 0
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
    if (row.pendingBreakdown.inOffice > 0) inOffice++
    if (row.pendingBreakdown.inFaenaAvailable > 0) inFaena++
    if (row.computedStatus === "parcialmente_entregado") partiallyDelivered++
    if (row.computedStatus === "entregado") fullyDelivered++
  }

  return {
    openRequests: openRequestsSet.size,
    pendingPurchase,
    awaitingSupplier,
    inOffice,
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
    ocsByItem,
  } = filters

  if (filterEstado && isComputedStatus(filterEstado)) {
    filtered = filtered.filter((r) => r.computedStatus === filterEstado)
  }
  if (filterCategoria) {
    // `categoryId` viaja en la fila: buscarlo con un `find` sobre los ítems
    // crudos convertía este filtro en O(n²) sobre toda la faena.
    filtered = filtered.filter((r) => r.categoryId === filterCategoria)
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
