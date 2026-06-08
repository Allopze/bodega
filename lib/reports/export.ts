import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { and, eq, inArray, sql, type SQLWrapper } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, purchaseOrders,
  invoiceAttachments, products, worksites, suppliers,
} from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"
import { formatDate } from "@/lib/utils"

export type ReportCell = string | number | null | undefined

export interface ReportData {
  filenameBase: string
  worksheetName: string
  headers: string[]
  rows: ReportCell[][]
}

export function csvRow(values: ReportCell[]): string {
  return values
    .map((v) => {
      const s = v === null || v === undefined ? "" : String(v)
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    })
    .join(",")
}

export function buildCsv(report: Pick<ReportData, "headers" | "rows">): string {
  return [csvRow(report.headers), ...report.rows.map(csvRow)].join("\r\n")
}

export async function buildXlsxBuffer(report: ReportData): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Chome Solicitudes y Bodega"
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet(report.worksheetName)
  worksheet.addRow(report.headers)
  for (const row of report.rows) worksheet.addRow(row.map((cell) => cell ?? ""))

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: "middle" }

  worksheet.columns.forEach((column, index) => {
    const header = report.headers[index] ?? ""
    let width = Math.max(12, header.length + 2)
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      width = Math.max(width, String(cell.value ?? "").length + 2)
    })
    column.width = Math.min(width, 42)
  })
  worksheet.views = [{ state: "frozen", ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: report.headers.length },
  }

  const data = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(data as ArrayBufferLike)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export async function getReportData(tipo: string, session: Session | null): Promise<ReportData> {
  switch (tipo) {
    case "items_sin_oc":
      return itemsSinOc(session)
    case "oc_por_estado":
      return ocPorEstado(session)
    case "facturas_pendientes":
      return facturasPendientes(session)
    case "gasto_faena":
    default:
      return gastoPorFaena(session)
  }
}

async function gastoPorFaena(session: Session | null): Promise<ReportData> {
  const orderFilter = buildWorksiteFilter(session, purchaseOrders.worksiteId)

  const orders = await db
    .select({
      id:          purchaseOrders.id,
      code:        purchaseOrders.code,
      worksiteId:  purchaseOrders.worksiteId,
      totalAmount: purchaseOrders.totalAmount,
      status:      purchaseOrders.status,
      createdAt:   purchaseOrders.createdAt,
      supplierId:  purchaseOrders.supplierId,
    })
    .from(purchaseOrders)
    .where(orderFilter)

  const wsIds  = [...new Set(orders.map((o) => o.worksiteId))]
  const supIds = [...new Set(orders.map((o) => o.supplierId))]

  const [wsRows, supRows] = await Promise.all([
    wsIds.length  ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))  : [],
    supIds.length ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supIds)) : [],
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supRows.map((s) => [s.id, s.name]))

  return {
    filenameBase: "gasto-por-faena",
    worksheetName: "Gasto por faena",
    headers: ["OC", "Faena", "Proveedor", "Estado", "Monto Total", "Fecha"],
    rows: orders.map((o) => [
      o.code,
      wsMap[o.worksiteId] ?? o.worksiteId,
      supMap[o.supplierId] ?? o.supplierId,
      o.status,
      o.totalAmount,
      formatDate(o.createdAt),
    ]),
  }
}

async function itemsSinOc(session: Session | null): Promise<ReportData> {
  const alertStates = ["approved", "pending_purchase"]
  const requestFilter = buildWorksiteFilter(session, purchaseRequests.worksiteId)

  const items = await db
    .select({
      id:              purchaseRequestItems.id,
      requestId:       purchaseRequestItems.requestId,
      productId:       purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
      quantity:        purchaseRequestItems.quantity,
      unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      status:          purchaseRequestItems.status,
      createdAt:       purchaseRequestItems.createdAt,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(and(inArray(purchaseRequestItems.status, alertStates), requestFilter))

  const headers = ["Producto", "SKU", "Faena", "Solicitud", "Cantidad", "U/M", "Estado", "Fecha creación"]
  if (items.length === 0) {
    return {
      filenameBase: "items-sin-oc",
      worksheetName: "Items sin OC",
      headers,
      rows: [],
    }
  }

  const reqIds = [...new Set(items.map((i) => i.requestId))]
  const prodIds = [...new Set(items.map((i) => i.productId).filter(Boolean) as string[])]

  const [reqRows, prodRows] = await Promise.all([
    db.select({ id: purchaseRequests.id, code: purchaseRequests.code, worksiteId: purchaseRequests.worksiteId })
      .from(purchaseRequests).where(inArray(purchaseRequests.id, reqIds)),
    prodIds.length ? db.select({ id: products.id, name: products.name, sku: products.sku }).from(products).where(inArray(products.id, prodIds)) : [],
  ])

  const wsIds = [...new Set(reqRows.map((r) => r.worksiteId))]
  const wsRows = wsIds.length
    ? await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))
    : []

  const reqMap  = Object.fromEntries(reqRows.map((r) => [r.id, r]))
  const prodMap = Object.fromEntries(prodRows.map((p) => [p.id, p]))
  const wsMap   = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))

  return {
    filenameBase: "items-sin-oc",
    worksheetName: "Items sin OC",
    headers,
    rows: items.map((i) => {
      const req     = reqMap[i.requestId]
      const product = i.productId ? prodMap[i.productId] : null
      return [
        product?.name ?? i.productNameFree ?? "",
        product?.sku ?? "",
        req ? (wsMap[req.worksiteId] ?? req.worksiteId) : "",
        req?.code ?? "",
        i.quantity,
        i.unitOfMeasure,
        i.status,
        formatDate(i.createdAt),
      ]
    }),
  }
}

async function ocPorEstado(session: Session | null): Promise<ReportData> {
  const orderFilter = buildWorksiteFilter(session, purchaseOrders.worksiteId)

  const orders = await db
    .select({
      code:        purchaseOrders.code,
      status:      purchaseOrders.status,
      worksiteId:  purchaseOrders.worksiteId,
      totalAmount: purchaseOrders.totalAmount,
      issuedAt:    purchaseOrders.issuedAt,
      sentAt:      purchaseOrders.sentAt,
      confirmedAt: purchaseOrders.confirmedAt,
    })
    .from(purchaseOrders)
    .where(orderFilter)

  const wsIds = [...new Set(orders.map((o) => o.worksiteId))]
  const wsRows = wsIds.length
    ? await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))
    : []
  const wsMap = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))

  return {
    filenameBase: "oc-por-estado",
    worksheetName: "OC por estado",
    headers: ["OC", "Estado", "Faena", "Total", "Emitida", "Enviada", "Confirmada"],
    rows: orders.map((o) => [
      o.code,
      o.status,
      wsMap[o.worksiteId] ?? o.worksiteId,
      o.totalAmount,
      o.issuedAt    ? formatDate(o.issuedAt)    : "",
      o.sentAt      ? formatDate(o.sentAt)      : "",
      o.confirmedAt ? formatDate(o.confirmedAt) : "",
    ]),
  }
}

async function facturasPendientes(session: Session | null): Promise<ReportData> {
  const orderFilter = buildWorksiteFilter(session, purchaseOrders.worksiteId)

  const [orders, invoices] = await Promise.all([
    db
      .select({
        id: purchaseOrders.id,
        code: purchaseOrders.code,
        status: purchaseOrders.status,
        worksiteId: purchaseOrders.worksiteId,
        totalAmount: purchaseOrders.totalAmount,
      })
      .from(purchaseOrders)
      .where(orderFilter),
    db
      .select({
        targetId: invoiceAttachments.targetId,
        targetType: invoiceAttachments.targetType,
        invoiceNumber: invoiceAttachments.invoiceNumber,
        amount: invoiceAttachments.amount,
        status: invoiceAttachments.status,
      })
      .from(invoiceAttachments)
      .where(eq(invoiceAttachments.targetType, "purchase_order")),
  ])

  const orderIds = new Set(orders.map((order) => order.id))
  const orderInvoices = invoices.filter((invoice) => orderIds.has(invoice.targetId))
  const reconciledOrderIds = new Set(
    orderInvoices
      .filter((invoice) => invoice.status === "reconciled")
      .map((invoice) => invoice.targetId),
  )
  const invoicesByOrder = new Map<string, typeof orderInvoices>()
  for (const invoice of orderInvoices) {
    const rows = invoicesByOrder.get(invoice.targetId) ?? []
    rows.push(invoice)
    invoicesByOrder.set(invoice.targetId, rows)
  }

  const wsIds = [...new Set(orders.map((order) => order.worksiteId))]
  const wsRows = wsIds.length
    ? await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))
    : []
  const wsMap = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))

  const rows: ReportCell[][] = []
  for (const order of orders) {
    const pendingInvoices = (invoicesByOrder.get(order.id) ?? []).filter((invoice) => invoice.status !== "reconciled")
    if (pendingInvoices.length > 0) {
      for (const invoice of pendingInvoices) {
        rows.push([
          order.code,
          wsMap[order.worksiteId] ?? order.worksiteId,
          order.status,
          invoice.invoiceNumber,
          invoice.status,
          order.totalAmount,
          invoice.amount,
        ])
      }
      continue
    }

    if (order.status === "received" && !reconciledOrderIds.has(order.id)) {
      rows.push([
        order.code,
        wsMap[order.worksiteId] ?? order.worksiteId,
        order.status,
        "",
        "sin_factura",
        order.totalAmount,
        "",
      ])
    }
  }

  return {
    filenameBase: "facturas-pendientes",
    worksheetName: "Facturas pendientes",
    headers: ["OC", "Faena", "Estado OC", "Factura", "Estado factura", "Monto OC", "Monto factura"],
    rows,
  }
}

/**
 * Builds a Drizzle SQL fragment for a worksite column, matching the
 * same scope rule as canAccessWorksite(). Global roles get undefined
 * (no filter), faena requesters with no worksites get a no-rows
 * predicate, and everyone else gets an `inArray(...)` filter.
 */
function buildWorksiteFilter(
  session: Session | null,
  column: SQLWrapper,
) {
  if (isGlobalRole(session)) return undefined
  const ids = visibleWorksiteIds(session)
  if (ids.length === 0) return sql`1 = 0`
  return inArray(column, ids as never[])
}
