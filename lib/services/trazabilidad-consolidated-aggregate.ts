import type { LinkedMaps, OcRow } from "./trazabilidad-consolidated-builder"
import {
  COMPUTED_STATUS_METAS,
  type ComputedStatus,
  type ConsolidatedAggregateResult,
  type ConsolidatedOrder,
  type ConsolidatedQuantitySummary,
  type ConsolidatedRequest,
  type ConsolidatedRow,
} from "./trazabilidad-consolidated.types"
import {
  isApplicableComputedStatus,
  leastAdvancedComputedStatus,
} from "./trazabilidad-consolidated-calc"

interface MutableQuantitySummary extends Omit<ConsolidatedQuantitySummary, "approved"> {
  approved: number
  hasApproved: boolean
}

function summarizeRows(rows: ConsolidatedRow[]): ConsolidatedQuantitySummary[] {
  const byUom = new Map<string, MutableQuantitySummary>()

  for (const row of rows) {
    const current = byUom.get(row.uom) ?? {
      uom: row.uom,
      requested: 0,
      approved: 0,
      hasApproved: false,
      inOc: 0,
      receivedOffice: 0,
      receivedFaena: 0,
      delivered: 0,
      pendingTotal: 0,
    }

    current.requested += row.requested
    if (row.approved !== null) {
      current.approved += row.approved
      current.hasApproved = true
    }
    current.inOc += row.inOc
    current.receivedOffice += row.receivedOffice
    current.receivedFaena += row.receivedFaena
    current.delivered += row.delivered
    current.pendingTotal += row.pendingTotal
    byUom.set(row.uom, current)
  }

  return [...byUom.values()].map(({ hasApproved, ...summary }) => ({
    ...summary,
    approved: hasApproved ? summary.approved : null,
  }))
}

function latest(values: Array<string | null>): string {
  return values.reduce<string>((mostRecent, value) => {
    if (!value) return mostRecent
    return value > mostRecent ? value : mostRecent
  }, "")
}

function uniqueOcRows(ocRows: OcRow[]): OcRow[] {
  return [...new Map(ocRows.map((order) => [order.id, order])).values()]
}

function buildOrder(
  ocRows: OcRow[],
  rowsById: Map<string, ConsolidatedRow>,
  orderedQuantityByLine: Map<string, number>,
): ConsolidatedOrder {
  const uniqueRows = uniqueOcRows(ocRows)
  const firstOrder = uniqueRows[0]
  if (!firstOrder) {
    throw new Error("No se puede consolidar una orden sin líneas")
  }

  const ocRowsByLine = new Map<string, OcRow[]>()
  for (const order of uniqueRows) {
    if (!order.requestItemId || !rowsById.has(order.requestItemId)) continue
    const lineOrders = ocRowsByLine.get(order.requestItemId) ?? []
    lineOrders.push(order)
    ocRowsByLine.set(order.requestItemId, lineOrders)
  }

  const lines = [...ocRowsByLine.keys()].flatMap((lineId) => {
    const line = rowsById.get(lineId)
    return line ? [line] : []
  })
  const summaryByUom = new Map<string, MutableQuantitySummary>()

  for (const [lineId, lineOrders] of ocRowsByLine) {
    const line = rowsById.get(lineId)
    if (!line) continue
    const allocated = lineOrders.reduce((total, order) => total + order.quantity, 0)
    const totalOrdered = orderedQuantityByLine.get(lineId) ?? allocated
    const allocationShare = totalOrdered > 0 ? allocated / totalOrdered : 0
    const current = summaryByUom.get(line.uom) ?? {
      uom: line.uom,
      requested: 0,
      approved: 0,
      hasApproved: false,
      inOc: 0,
      receivedOffice: 0,
      receivedFaena: 0,
      delivered: 0,
      pendingTotal: 0,
    }

    current.requested += line.requested * allocationShare
    if (line.approved !== null) {
      current.approved += line.approved * allocationShare
      current.hasApproved = true
    }
    current.inOc += allocated
    current.receivedOffice += lineOrders.reduce(
      (total, order) => total + order.quantityOfficeReceived,
      0,
    )
    current.receivedFaena += lineOrders.reduce(
      (total, order) => total + order.quantityReceived,
      0,
    )
    current.delivered += line.delivered * allocationShare
    current.pendingTotal += line.pendingTotal * allocationShare
    summaryByUom.set(line.uom, current)
  }

  const quantitiesByUom = [...summaryByUom.values()].map(({ hasApproved, ...summary }) => ({
    ...summary,
    approved: hasApproved ? summary.approved : null,
  }))

  return {
    orderId: firstOrder.purchaseOrderId,
    code: firstOrder.orderCode,
    supplierName: firstOrder.supplierName,
    orderStatus: firstOrder.orderStatus,
    requestIds: [...new Set(lines.map((line) => line.requestId))],
    lineIds: lines.map((line) => line.itemId),
    lineCount: lines.length,
    quantitiesByUom,
    lastUpdated: latest(
      uniqueRows.flatMap((order) => [order.createdAt, order.issuedAt, order.sentAt]),
    ),
  }
}

export function computeAggregateStatus(
  rows: ConsolidatedRow[],
): Pick<ConsolidatedRequest, "status" | "statusLabel" | "statusColor" | "statusCounts"> {
  if (rows.length === 0) {
    throw new Error("No se puede calcular el estado de una solicitud sin líneas")
  }

  const statusCounts: Partial<Record<ComputedStatus, number>> = {}
  for (const row of rows) {
    statusCounts[row.computedStatus] = (statusCounts[row.computedStatus] ?? 0) + 1
  }

  const applicableRows = rows.filter((row) => isApplicableComputedStatus(row.computedStatus))
  let status: ComputedStatus

  if (
    applicableRows.length > 0 &&
    applicableRows.every((row) => row.computedStatus === "entregado")
  ) {
    status = "entregado"
  } else {
    const hasDeliveryProgress = applicableRows.some(
      (row) => row.delivered > 0 || row.computedStatus === "entregado",
    )
    const hasPendingBalance = applicableRows.some((row) => row.pendingTotal > 0)

    if (hasDeliveryProgress && hasPendingBalance) {
      status = "parcialmente_entregado"
    } else {
      status = leastAdvancedComputedStatus(rows.map((row) => row.computedStatus))
    }
  }

  const meta = COMPUTED_STATUS_METAS[status]
  return {
    status,
    statusLabel: meta.label,
    statusColor: meta.color,
    statusCounts,
  }
}

export function aggregateConsolidatedRows(
  rows: ConsolidatedRow[],
  maps: LinkedMaps,
): ConsolidatedAggregateResult {
  const rowsById = new Map(rows.map((row) => [row.itemId, row]))
  const requestLines = new Map<string, ConsolidatedRow[]>()
  const orderRows = new Map<string, OcRow[]>()
  const requestOrderRows = new Map<string, Map<string, OcRow[]>>()
  const orderedQuantityByLine = new Map<string, number>()

  for (const row of rows) {
    const lines = requestLines.get(row.requestId) ?? []
    lines.push(row)
    requestLines.set(row.requestId, lines)

    for (const order of uniqueOcRows(maps.ocsByItem.get(row.itemId) ?? [])) {
      const grouped = orderRows.get(order.purchaseOrderId) ?? []
      grouped.push(order)
      orderRows.set(order.purchaseOrderId, grouped)

      const ordersForRequest = requestOrderRows.get(row.requestId) ?? new Map<string, OcRow[]>()
      const requestGroup = ordersForRequest.get(order.purchaseOrderId) ?? []
      requestGroup.push(order)
      ordersForRequest.set(order.purchaseOrderId, requestGroup)
      requestOrderRows.set(row.requestId, ordersForRequest)

      orderedQuantityByLine.set(
        row.itemId,
        (orderedQuantityByLine.get(row.itemId) ?? 0) + order.quantity,
      )
    }
  }

  const orders = [...orderRows.values()].map((group) =>
    buildOrder(group, rowsById, orderedQuantityByLine),
  )

  const requests = [...requestLines.values()].map((lines): ConsolidatedRequest => {
    const firstLine = lines[0]
    if (!firstLine) {
      throw new Error("No se puede consolidar una solicitud sin líneas")
    }

    const requestOrders = [...(requestOrderRows.get(firstLine.requestId)?.values() ?? [])].map(
      (group) => buildOrder(group, rowsById, orderedQuantityByLine),
    )
    const aggregateStatus = computeAggregateStatus(lines)
    const quantitiesByUom = summarizeRows(lines)
    const requestUrgency = selectUrgency(lines.map((line) => line.requestUrgency))

    return {
      requestId: firstLine.requestId,
      requestCode: firstLine.requestCode,
      requestDate: firstLine.requestDate,
      requesterId: firstLine.requesterId,
      requesterName: firstLine.requesterName,
      worksiteId: firstLine.worksiteId,
      worksiteName: firstLine.worksiteName,
      deliveryMode: firstLine.deliveryMode,
      urgency: requestUrgency ?? selectUrgency(lines.map((line) => line.urgency)),
      lineCount: lines.length,
      orderCount: requestOrders.length,
      orders: requestOrders,
      lines,
      quantitiesByUom,
      ...aggregateStatus,
      pendingTotal: quantitiesByUom.length === 1 ? quantitiesByUom[0]?.pendingTotal ?? 0 : null,
      hasPending: quantitiesByUom.some((summary) => summary.pendingTotal > 0),
      alert: lines.some((line) => line.alert),
      lastUpdated: latest(lines.map((line) => line.lastUpdated)),
    }
  })

  return { requests, orders }
}

const URGENCY_PRIORITY: Record<string, number> = {
  normal: 0,
  high: 1,
  critical: 2,
}

function selectUrgency(values: Array<string | null>): string | null {
  return values
    .filter((value): value is string => value !== null)
    .sort((left, right) => {
      const priorityDifference = (URGENCY_PRIORITY[right] ?? -1) - (URGENCY_PRIORITY[left] ?? -1)
      return priorityDifference || left.localeCompare(right)
    })[0] ?? null
}
