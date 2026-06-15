import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { and, eq, inArray, sql, type SQLWrapper } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, purchaseOrders,
  products, worksites, suppliers,
} from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"
import { formatDate } from "@/lib/utils"

export type ReportCell = string | number | null | undefined

export interface ExportFilters {
  fromDate?:  string
  toDate?:    string
  worksiteId?: string
  status?:    string
}

export interface ReportData {
  filenameBase: string
  worksheetName: string
  headers: string[]
  rows: ReportCell[][]
  rowLimitApplied?: boolean
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

export async function getReportData(tipo: string, session: Session | null, filters: ExportFilters = {}, maxRows = 10_000): Promise<ReportData> {
  switch (tipo) {
    case "items_sin_oc":
      return itemsSinOc(session, filters, maxRows)
    case "oc_por_estado":
      return ocPorEstado(session, filters, maxRows)
    case "gasto_faena":
    default:
      return gastoPorFaena(session, filters, maxRows)
  }
}

async function gastoPorFaena(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const orderFilter = buildWorksiteFilter(session, purchaseOrders.worksiteId)
  const dateFilter = buildDateFilter(filters, purchaseOrders.createdAt)
  const statusFilter = filters.status ? eq(purchaseOrders.status, filters.status) : undefined
  const wsFilter = filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined

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
    .where(and(orderFilter, dateFilter, statusFilter, wsFilter))
    .limit(limit + 1)

  const rowLimitApplied = orders.length > limit
  const limited = rowLimitApplied ? orders.slice(0, limit) : orders

  const wsIds  = [...new Set(limited.map((o) => o.worksiteId))]
  const supIds = [...new Set(limited.map((o) => o.supplierId))]

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
    rows: limited.map((o) => [
      o.code,
      wsMap[o.worksiteId] ?? o.worksiteId,
      supMap[o.supplierId] ?? o.supplierId,
      o.status,
      o.totalAmount,
      formatDate(o.createdAt),
    ]),
    rowLimitApplied,
  }
}

async function itemsSinOc(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const alertStates = filters.status ? [filters.status] : ["approved", "pending_purchase"]
  const requestFilter = buildWorksiteFilter(session, purchaseRequests.worksiteId)
  const dateFilter = buildDateFilter(filters, purchaseRequests.createdAt)
  const wsFilter = filters.worksiteId ? eq(purchaseRequests.worksiteId, filters.worksiteId) : undefined

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
    .where(and(inArray(purchaseRequestItems.status, alertStates), requestFilter, dateFilter, wsFilter))
    .limit(limit + 1)

  const rowLimitApplied = items.length > limit
  const limited = rowLimitApplied ? items.slice(0, limit) : items

  const headers = ["Producto", "SKU", "Faena", "Solicitud", "Cantidad", "U/M", "Estado", "Fecha creación"]
  if (limited.length === 0) {
    return {
      filenameBase: "items-sin-oc",
      worksheetName: "Items sin OC",
      headers,
      rows: [],
      rowLimitApplied,
    }
  }

  const reqIds = [...new Set(limited.map((i) => i.requestId))]
  const prodIds = [...new Set(limited.map((i) => i.productId).filter(Boolean) as string[])]

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
    rows: limited.map((i) => {
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
    rowLimitApplied,
  }
}

async function ocPorEstado(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const orderFilter = buildWorksiteFilter(session, purchaseOrders.worksiteId)
  const dateFilter = buildDateFilter(filters, purchaseOrders.createdAt)
  const statusFilter = filters.status ? eq(purchaseOrders.status, filters.status) : undefined
  const wsFilter = filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined

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
    .where(and(orderFilter, dateFilter, statusFilter, wsFilter))
    .limit(limit + 1)

  const rowLimitApplied = orders.length > limit
  const limited = rowLimitApplied ? orders.slice(0, limit) : orders

  const wsIds = [...new Set(limited.map((o) => o.worksiteId))]
  const wsRows = wsIds.length
    ? await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))
    : []
  const wsMap = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))

  return {
    filenameBase: "oc-por-estado",
    worksheetName: "OC por estado",
    headers: ["OC", "Estado", "Faena", "Total", "Emitida", "Enviada", "Confirmada"],
    rows: limited.map((o) => [
      o.code,
      o.status,
      wsMap[o.worksiteId] ?? o.worksiteId,
      o.totalAmount,
      o.issuedAt    ? formatDate(o.issuedAt)    : "",
      o.sentAt      ? formatDate(o.sentAt)      : "",
      o.confirmedAt ? formatDate(o.confirmedAt) : "",
    ]),
    rowLimitApplied,
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

function buildDateFilter(filters: ExportFilters, column: SQLWrapper) {
  if (!filters.fromDate && !filters.toDate) return undefined
  const conditions = []
  if (filters.fromDate) conditions.push(sql`${column} >= ${filters.fromDate}`)
  if (filters.toDate) conditions.push(sql`${column} <= ${filters.toDate}T23:59:59`)
  return and(...conditions)
}
