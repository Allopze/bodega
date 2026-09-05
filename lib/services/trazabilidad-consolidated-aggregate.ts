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

const NON_APPLICABLE_STATUSES = new Set<ComputedStatus>(["rechazado", "cancelado", "borrador"])

/** De menor a mayor avance, siguiendo las etapas de `computeItemStatus`. */
const BLOCKING_STATUS_ORDER: ComputedStatus[] = [
  "solicitado",
  "aprobado",
  "pedido_proveedor",
  "parcialmente_recibido_oficina",
  "en_oficina",
  "parcialmente_enviado_faena",
  "enviado_faena",
  "parcialmente_recibido_faena",
  "en_faena",
  "parcialmente_entregado",
  "entregado",
  "rechazado",
  "cancelado",
  "borrador",
]

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

function buildOrder(ocRows: OcRow[], rowsById: Map<string, ConsolidatedRow>): ConsolidatedOrder {
  const uniqueRows = uniqueOcRows(ocRows)
  const firstOrder = uniqueRows[0]
  if (!firstOrder) {
    throw new Error("No se puede consolidar una orden sin líneas")
  }

  const lines = [
    ...new Map(
      uniqueRows.flatMap((order) => {
        if (!order.requestItemId) return []
        const line = rowsById.get(order.requestItemId)
        return line ? [[line.itemId, line] as const] : []
      }),
    ).values(),
  ]
  const quantitiesByUom = summarizeRows(lines)
  const summaryByUom = new Map(quantitiesByUom.map((summary) => [summary.uom, summary]))

  for (const summary of quantitiesByUom) {
    summary.inOc = 0
    summary.receivedOffice = 0
    summary.receivedFaena = 0
  }
  for (const order of uniqueRows) {
    if (!order.requestItemId) continue
    const line = rowsById.get(order.requestItemId)
    if (!line) continue
    const summary = summaryByUom.get(line.uom)
    if (!summary) continue
    summary.inOc += order.quantity
    summary.receivedOffice += order.quantityOfficeReceived
    summary.receivedFaena += order.quantityReceived
  }

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
  const statusCounts: Partial<Record<ComputedStatus, number>> = {}
  for (const row of rows) {
    statusCounts[row.computedStatus] = (statusCounts[row.computedStatus] ?? 0) + 1
  }

  const applicableRows = rows.filter((row) => !NON_APPLICABLE_STATUSES.has(row.computedStatus))
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
      status =
        BLOCKING_STATUS_ORDER.find((candidate) => statusCounts[candidate]) ?? "solicitado"
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

  for (const row of rows) {
    const lines = requestLines.get(row.requestId) ?? []
    lines.push(row)
    requestLines.set(row.requestId, lines)

    for (const order of maps.ocsByItem.get(row.itemId) ?? []) {
      const grouped = orderRows.get(order.purchaseOrderId) ?? []
      grouped.push(order)
      orderRows.set(order.purchaseOrderId, grouped)
    }
  }

  const orders = [...orderRows.values()].map((group) => buildOrder(group, rowsById))
  const orderOcRowsById = new Map(orderRows)

  const requests = [...requestLines.values()].map((lines): ConsolidatedRequest => {
    const firstLine = lines[0]
    if (!firstLine) {
      throw new Error("No se puede consolidar una solicitud sin líneas")
    }

    const lineIds = new Set(lines.map((line) => line.itemId))
    const requestOrders = orders.flatMap((order) => {
      const attributableRows = (orderOcRowsById.get(order.orderId) ?? []).filter(
        (ocRow) => ocRow.requestItemId !== null && lineIds.has(ocRow.requestItemId),
      )
      return attributableRows.length > 0 ? [buildOrder(attributableRows, rowsById)] : []
    })
    const aggregateStatus = computeAggregateStatus(lines)

    return {
      requestId: firstLine.requestId,
      requestCode: firstLine.requestCode,
      requestDate: firstLine.requestDate,
      requesterId: firstLine.requesterId,
      requesterName: firstLine.requesterName,
      worksiteId: firstLine.worksiteId,
      worksiteName: firstLine.worksiteName,
      deliveryMode: firstLine.deliveryMode,
      urgency: lines.find((line) => line.urgency !== null)?.urgency ?? null,
      lineCount: lines.length,
      orderCount: requestOrders.length,
      orders: requestOrders,
      lines,
      quantitiesByUom: summarizeRows(lines),
      ...aggregateStatus,
      pendingTotal: lines.reduce((total, line) => total + line.pendingTotal, 0),
      alert: lines.some((line) => line.alert),
      lastUpdated: latest(lines.map((line) => line.lastUpdated)),
    }
  })

  return { requests, orders }
}
