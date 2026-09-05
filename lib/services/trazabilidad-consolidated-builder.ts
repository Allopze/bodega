import {
  COMPUTED_STATUS_METAS,
  TRACEABILITY_CONSOLIDATED_PAGE_SIZE,
  isComputedStatus,
  type ConsolidatedOrder,
  type ConsolidatedRequest,
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
    // TR-04 (auditoría 2026-09-05): una OC en borrador se está armando, no es
    // un compromiso con el proveedor. Sin esta separación el ítem salía
    // "Pedido a proveedor" en cuanto se creaba la orden y el KPI "Esperando
    // proveedor" la contaba, pese a que todavía es editable. `inOc` conserva
    // la columna visible (incluye la preparación) e `inOcActive` sólo cuenta
    // las órdenes emitidas/enviadas, que son las que mueven el estado.
    const inOcActive = ocs
      .filter((o) => o.orderStatus !== "draft")
      .reduce((acc, o) => acc + o.quantity, 0)
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
      inOc: inOcActive,
      receivedOffice,
      dispatched,
      receivedFaena,
      delivered,
    })

    const statusMeta = COMPUTED_STATUS_METAS[computedStatus]

    const pendingBreakdown = computePendingBreakdown({
      requested: item.quantity,
      approved,
      inOc: inOcActive,
      receivedOffice,
      dispatched,
      receivedFaena,
      delivered,
    })

    // TR-03 (auditoría 2026-09-05): los estados cerrados dejaron de tener
    // obligación pendiente. El desglose se calcula con los contadores físicos
    // y no conoce el estado, así que una línea rechazada/cancelada sin entregas
    // seguía aportando su cantidad completa a "Pendientes de compra", a los
    // KPIs y al filtro "Solo pendientes" — para siempre. La historia se
    // conserva intacta en el timeline; sólo se anula la obligación vigente.
    const effectiveBreakdown = CLOSED_STATUSES.has(computedStatus)
      ? { pendingTotal: 0, notYetOrdered: 0, pendingFromSupplier: 0, inOffice: 0, inTransit: 0, inFaenaAvailable: 0 }
      : pendingBreakdown

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
      effectiveBreakdown.notYetOrdered > 0 &&
      effectiveBreakdown.pendingTotal > 0 &&
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

      pendingTotal: effectiveBreakdown.pendingTotal,
      pendingBreakdown: effectiveBreakdown,

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

export interface AggregateFilters {
  filterEstado: string
  filterCategoria: string
  filterProveedor: string
  filterPendientes: boolean
  filterQ: string
  /** Permite resolver el id de proveedor sin añadir atribuciones al DTO de OC. */
  ocsByItem?: Map<string, OcRow[]>
}

/**
 * Filtra solicitudes como unidad, conservando todas sus líneas de evidencia.
 * `matchingLineCount` indica cuántas líneas explican la coincidencia cuando
 * los filtros sólo abarcan parte de la solicitud.
 */
export function applyAggregateFilters(
  requests: ConsolidatedRequest[],
  filters: AggregateFilters,
): ConsolidatedRequest[] {
  const {
    filterEstado,
    filterCategoria,
    filterProveedor,
    filterPendientes,
    filterQ,
    ocsByItem,
  } = filters
  const qLower = filterQ.toLowerCase()

  return requests.flatMap((request) => {
    if (
      filterEstado &&
      isComputedStatus(filterEstado) &&
      request.status !== filterEstado
    ) {
      return []
    }

    const requestMatchesText = qLower !== "" && [
      request.requestCode,
      request.requesterName,
      request.worksiteName,
      request.statusLabel,
    ].some((value) => value.toLowerCase().includes(qLower))

    const matchingLines = request.lines.filter((line) => {
      if (filterCategoria && line.categoryId !== filterCategoria) return false

      if (filterProveedor) {
        const linkedOrders = ocsByItem?.get(line.itemId)
        const matchesSupplier = linkedOrders
          ? linkedOrders.some((order) => order.supplierId === filterProveedor)
          : line.supplierNames.some((supplier) => supplier === filterProveedor)
        if (!matchesSupplier) return false
      }

      if (filterPendientes && line.pendingTotal <= 0) return false

      if (qLower && !requestMatchesText) {
        const matchesLine = [
          line.productName,
          line.productSku,
          line.notes,
          line.categoryName,
          ...line.supplierNames,
          ...line.ocCodes.flatMap((order) => [order.code, order.supplierName]),
        ].some((value) => value?.toLowerCase().includes(qLower))
        if (!matchesLine) return false
      }

      return true
    })

    if (matchingLines.length === 0) return []
    return [{ ...request, matchingLineCount: matchingLines.length }]
  })
}

/** Cuenta solicitudes u OCs únicas según la etapa operativa de cada KPI. */
export function computeAggregateKPIs(
  requests: ConsolidatedRequest[],
  orders: ConsolidatedOrder[],
): ConsolidatedFaenaKPIs {
  const uniqueOpenRequests = new Set<string>()
  const pendingPurchase = new Set<string>()
  const inOffice = new Set<string>()
  const inFaena = new Set<string>()
  const partiallyDelivered = new Set<string>()
  const fullyDelivered = new Set<string>()
  const uniqueOrders = new Set<string>()

  for (const request of requests) {
    if (!["entregado", "cancelado", "rechazado"].includes(request.status)) {
      uniqueOpenRequests.add(request.requestId)
    }
    if (request.lines.some((line) => line.pendingBreakdown.notYetOrdered > 0)) {
      pendingPurchase.add(request.requestId)
    }
    if (request.lines.some((line) => line.pendingBreakdown.inOffice > 0)) {
      inOffice.add(request.requestId)
    }
    if (request.lines.some((line) => line.pendingBreakdown.inFaenaAvailable > 0)) {
      inFaena.add(request.requestId)
    }
    if (request.status === "parcialmente_entregado") {
      partiallyDelivered.add(request.requestId)
    }
    if (request.status === "entregado") fullyDelivered.add(request.requestId)
    for (const order of request.orders) uniqueOrders.add(order.orderId)
  }

  const ordersById = new Map<string, ConsolidatedOrder>()
  for (const order of orders) {
    if (uniqueOrders.has(order.orderId)) ordersById.set(order.orderId, order)
  }
  const awaitingSupplier = new Set<string>()
  for (const order of ordersById.values()) {
    // TR-04 (auditoría 2026-09-05): una OC en borrador no es un compromiso con
    // el proveedor; tampoco cuenta como "Esperando proveedor". Sólo las órdenes
    // emitidas/enviadas con saldo por recibir figuran en este KPI.
    if (order.orderStatus === "draft") continue
    if (
      order.quantitiesByUom.some(
        (summary) => Math.max(summary.receivedOffice, summary.receivedFaena) < summary.inOc,
      )
    ) {
      awaitingSupplier.add(order.orderId)
    }
  }

  return {
    openRequests: uniqueOpenRequests.size,
    pendingPurchase: pendingPurchase.size,
    awaitingSupplier: awaitingSupplier.size,
    inOffice: inOffice.size,
    inFaena: inFaena.size,
    partiallyDelivered: partiallyDelivered.size,
    fullyDelivered: fullyDelivered.size,
  }
}

export interface AggregateRequestPage {
  requests: ConsolidatedRequest[]
  rows: ConsolidatedRow[]
  totalFiltered: number
  totalPages: number
  safePage: number
}

/** Pagina solicitudes completas y recién entonces construye sus timelines. */
export function paginateAggregateRequests(
  requests: ConsolidatedRequest[],
  currentPage: number,
  maps: LinkedMaps,
): AggregateRequestPage {
  const totalFiltered = requests.length
  const totalPages = Math.max(
    1,
    Math.ceil(totalFiltered / TRACEABILITY_CONSOLIDATED_PAGE_SIZE),
  )
  const safePage = Math.min(Math.max(1, currentPage), totalPages)
  const offset = (safePage - 1) * TRACEABILITY_CONSOLIDATED_PAGE_SIZE
  const pageRequests = requests
    .slice(offset, offset + TRACEABILITY_CONSOLIDATED_PAGE_SIZE)
    .map((request) => ({
      ...request,
      lines: attachTimelines(request.lines, maps),
    }))

  return {
    requests: pageRequests,
    rows: pageRequests.flatMap((request) => request.lines),
    totalFiltered,
    totalPages,
    safePage,
  }
}
