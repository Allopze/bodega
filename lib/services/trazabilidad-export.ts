/**
 * Trazabilidad CSV export.
 *
 * Reuses the same matrix-building queries as the trazabilidad page
 * but returns CSV text instead of rendering JSX.
 */
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems,
  purchaseOrderItems, receiptItems,
  approvalDecisions, products, worksites,
} from "@/db/schema"
import { asc, eq, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { canAccessWorksite } from "@/lib/auth/can"

const APPROVED_STATES = new Set([
  "approved", "pending_purchase", "in_purchase_order", "purchased",
  "partially_received", "received",
])

interface MatrixRow {
  productName:  string
  productSku:   string | null
  worksiteName: string
  requestCode:  string
  requested:    number
  approved:     number | null
  inOc:         number
  received:     number
  status:       string
  alert:        boolean
}

/**
 * Builds the full trazabilidad matrix (same logic as the trazabilidad page).
 */
async function buildMatrix(session: Session): Promise<MatrixRow[]> {
  const [
    allItems, allRequests, allProducts, allWorksites,
    allOcItems, allReceiptItems, allApproveDecisions,
  ] = await Promise.all([
    db.select({
      id:              purchaseRequestItems.id,
      requestId:       purchaseRequestItems.requestId,
      productId:       purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
      quantity:        purchaseRequestItems.quantity,
      unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      status:          purchaseRequestItems.status,
    }).from(purchaseRequestItems).orderBy(asc(purchaseRequestItems.createdAt)),

    db.select({
      id:         purchaseRequests.id,
      code:       purchaseRequests.code,
      worksiteId: purchaseRequests.worksiteId,
    }).from(purchaseRequests),

    db.select({ id: products.id, name: products.name, sku: products.sku }).from(products),

    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),

    db.select({
      id:            purchaseOrderItems.id,
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      requestItemId: purchaseOrderItems.requestItemId,
      quantity:      purchaseOrderItems.quantity,
    }).from(purchaseOrderItems),

    db.select({
      purchaseOrderItemId: receiptItems.purchaseOrderItemId,
      quantityReceived:    receiptItems.quantityReceived,
    }).from(receiptItems),

    db.select({
      requestItemId: approvalDecisions.requestItemId,
      modifiedQty:   approvalDecisions.modifiedQty,
    }).from(approvalDecisions).where(inArray(approvalDecisions.type, ["approve", "modify"])),
  ])

  const requestMap    = Object.fromEntries(allRequests.map((r) => [r.id, r]))
  const productMap    = Object.fromEntries(allProducts.map((p) => [p.id, p]))
  const worksiteMap   = Object.fromEntries(allWorksites.map((w) => [w.id, w.name]))

  const ocByItemId = new Map<string, Array<{ id: string; purchaseOrderId: string; quantity: number }>>()
  for (const oi of allOcItems) {
    if (!oi.requestItemId) continue
    const arr = ocByItemId.get(oi.requestItemId) ?? []
    arr.push({ id: oi.id, purchaseOrderId: oi.purchaseOrderId, quantity: oi.quantity })
    ocByItemId.set(oi.requestItemId, arr)
  }

  const receivedByOcItem = new Map<string, number>()
  for (const ri of allReceiptItems) {
    receivedByOcItem.set(
      ri.purchaseOrderItemId,
      (receivedByOcItem.get(ri.purchaseOrderItemId) ?? 0) + ri.quantityReceived,
    )
  }

  const modifiedQtyByItemId = new Map<string, number | null>()
  for (const d of allApproveDecisions) {
    if (!d.requestItemId) continue
    modifiedQtyByItemId.set(d.requestItemId, d.modifiedQty)
  }

  const rows: MatrixRow[] = []

  for (const item of allItems) {
    const request = requestMap[item.requestId]
    if (!request) continue
    if (!canAccessWorksite(session, request.worksiteId)) continue

    const ocItems = ocByItemId.get(item.id) ?? []
    const inOc     = ocItems.reduce((s, oi) => s + oi.quantity, 0)
    const received = ocItems.reduce((s, oi) => s + (receivedByOcItem.get(oi.id) ?? 0), 0)

    const isApproved = APPROVED_STATES.has(item.status)
    let approved: number | null = null
    if (isApproved) {
      const mod = modifiedQtyByItemId.get(item.id)
      approved = mod !== undefined ? (mod ?? item.quantity) : item.quantity
    }

    const alert = isApproved && approved !== null && inOc < approved

    const product     = item.productId ? productMap[item.productId] : null
    const productName = product?.name ?? item.productNameFree ?? "—"
    const productSku  = product?.sku ?? null

    rows.push({
      productName,
      productSku,
      worksiteName: worksiteMap[request.worksiteId] ?? request.worksiteId,
      requestCode:  request.code,
      requested:    item.quantity,
      approved,
      inOc,
      received,
      status:       item.status,
      alert,
    })
  }

  return rows
}

/**
 * Generates CSV text from the trazabilidad matrix.
 */
function matrixToCsv(rows: MatrixRow[]): string {
  const header = [
    "Producto",
    "SKU",
    "Faena",
    "Solicitud",
    "Solicitado",
    "Aprobado",
    "En OC",
    "Recibido",
    "Estado",
    "Alerta",
  ]

  const lines = [header.map(escapeCsv).join(",")]

  for (const row of rows) {
    lines.push([
      escapeCsv(row.productName),
      escapeCsv(row.productSku ?? ""),
      escapeCsv(row.worksiteName),
      escapeCsv(row.requestCode),
      String(row.requested),
      row.approved !== null ? String(row.approved) : "",
      String(row.inOc),
      String(row.received),
      escapeCsv(row.status),
      row.alert ? "Sí" : "No",
    ].join(","))
  }

  return lines.join("\n")
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * GET handler helper — returns CSV string + filename for the trazabilidad export.
 */
export async function getTrazabilidadCsv(session: Session): Promise<{
  csv: string
  filename: string
}> {
  const rows = await buildMatrix(session)
  return {
    csv: matrixToCsv(rows),
    filename: `trazabilidad-${new Date().toISOString().slice(0, 10)}.csv`,
  }
}
