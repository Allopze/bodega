import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { and, count, desc, eq, inArray, sql, type SQLWrapper } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, purchaseOrders, purchaseOrderItems,
  purchaseOrderInvoices, products, worksites, suppliers,
} from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { textSearchSql } from "@/lib/adquisiciones/list-query"
import { REQUEST_STATE_META, OC_STATE_META } from "@/components/states/state-badge"
import { formatDate } from "@/lib/utils"
import { getAnalyticsDashboard, normalizeAnalyticsFilters } from "@/lib/services/analytics"

export type ReportCell = string | number | null | undefined

export interface ExportFilters {
  fromDate?:  string
  toDate?:    string
  worksiteId?: string
  supplierId?: string
  vehicleId?: string
  status?:    string
  /** Free-text query (matched against code). */
  q?:         string
}

const REQUEST_TYPE_LABELS: Record<string, string> = {
  epp: "EPP", otro: "Otro", repuestos: "Repuestos", servicios: "Servicios",
}
const URGENCY_LABELS: Record<string, string> = {
  normal: "Normal", high: "Alta", critical: "Crítica",
}
function requestStatusLabel(s: string): string {
  return REQUEST_STATE_META[s as keyof typeof REQUEST_STATE_META]?.label ?? s
}
function ocStatusLabel(s: string): string {
  return OC_STATE_META[s as keyof typeof OC_STATE_META]?.label ?? s
}

export interface ReportData {
  filenameBase: string
  worksheetName: string
  headers: string[]
  rows: ReportCell[][]
  sheets?: ReportSheet[]
  rowLimitApplied?: boolean
}

export interface ReportSheet {
  worksheetName: string
  headers: string[]
  rows: ReportCell[][]
}

export async function buildXlsxBuffer(report: ReportData): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Chome Solicitudes y Bodega"
  workbook.created = new Date()

  const sheets = report.sheets?.length ? report.sheets : [{
    worksheetName: report.worksheetName,
    headers: report.headers,
    rows: report.rows,
  }]

  for (const sheet of sheets) addWorksheet(workbook, sheet)

  const data = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(data as ArrayBufferLike)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export async function getReportData(tipo: string, session: Session | null, filters: ExportFilters = {}, maxRows = 10_000): Promise<ReportData> {
  switch (tipo) {
    case "analitica_resumen":
      return analiticaResumen(session, filters)
    case "items_sin_oc":
      return itemsSinOc(session, filters, maxRows)
    case "oc_por_estado":
      return ocPorEstado(session, filters, maxRows)
    case "solicitudes":
      return solicitudesList(session, filters, maxRows)
    case "compras":
      return comprasList(session, filters, maxRows)
    case "recepcion":
      return recepcionList(session, filters, maxRows)
    case "gasto_faena":
    default:
      return gastoPorFaena(session, filters, maxRows)
  }
}

async function analiticaResumen(session: Session | null, filters: ExportFilters): Promise<ReportData> {
  if (!session) {
    return {
      filenameBase: "analitica-transversal",
      worksheetName: "Analítica",
      headers: ["Sección", "Indicador", "Detalle", "Monto/Cantidad"],
      rows: [],
    }
  }

  const data = await getAnalyticsDashboard(session, normalizeAnalyticsFilters({
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    worksiteId: filters.worksiteId,
    supplierId: filters.supplierId,
    vehicleId: filters.vehicleId,
  }))

  const rows: ReportCell[][] = [
    ["KPI", "Gasto total", `${data.filters.fromDate} a ${data.filters.toDate}`, data.kpis.totalSpend],
    ["KPI", "Gasto período anterior", `${data.kpis.spendVariationPct ?? "sin base"}% variación`, data.kpis.previousTotalSpend],
    ["KPI", "Órdenes de compra", "Cantidad del período", data.kpis.purchaseOrderCount],
    ["KPI", "Aprobaciones pendientes", "Ítems solicitados pendientes", data.kpis.pendingApprovals],
    ["KPI", "Stock crítico", "Productos bajo mínimo", data.kpis.criticalStockCount],
    ["KPI", "Combustible", `${data.kpis.fuelLoadCount} cargas`, data.kpis.fuelLiters],
    ...data.spendByMonth.map((row) => [
      "Tendencia mensual",
      row.month,
      `Compras: ${row.purchasingAmount} · Combustible: ${row.fuelAmount}`,
      row.totalAmount,
    ]),
    ...data.spendByModule.map((row) => [
      "Gasto por tipo",
      row.module,
      "",
      row.totalAmount,
    ]),
    ...data.topSuppliers.map((row) => [
      "Proveedores",
      row.name,
      `${row.module ?? "Compras"} · ${row.count} eventos`,
      row.totalAmount,
    ]),
    ...data.topWorksites.map((row) => [
      "Faenas",
      row.name,
      "",
      row.totalAmount,
    ]),
    ...data.vehicleCosts.map((row) => [
      "Vehículos",
      row.plate,
      `${row.type} · ${row.totalLiters} L · ${row.loadCount} cargas`,
      row.totalOperationalCost,
    ]),
    ...data.stockRisks.map((row) => [
      "Stock crítico",
      row.productName,
      `${row.worksiteName} · stock ${row.currentQty} / mínimo ${row.minStock}`,
      row.currentQty,
    ]),
    ...data.eppDeliveries.map((row) => [
      "EPP",
      row.productName,
      `${row.workerName} · ${row.worksiteName} · ${row.deliveryCount} entregas`,
      row.totalQty,
    ]),
    ...data.alerts.map((alert) => [
      "Alertas",
      `${alert.module} · ${alert.entityLabel}`,
      `${alert.reason} · Acción: ${alert.action}`,
      alert.severity,
    ]),
    ...data.dataGaps.map((gap) => [
      "Brechas",
      "Trazabilidad",
      gap,
      "",
    ]),
  ]

  const sheets: ReportSheet[] = [
    {
      worksheetName: "KPIs",
      headers: ["Indicador", "Detalle", "Valor"],
      rows: [
        ["Gasto total", `${data.filters.fromDate} a ${data.filters.toDate}`, data.kpis.totalSpend],
        ["Gasto período anterior", `${data.kpis.spendVariationPct ?? "sin base"}% variación`, data.kpis.previousTotalSpend],
        ["Órdenes de compra", "Cantidad del período", data.kpis.purchaseOrderCount],
        ["Aprobaciones pendientes", "Ítems solicitados pendientes", data.kpis.pendingApprovals],
        ["Stock crítico", "Productos bajo mínimo", data.kpis.criticalStockCount],
        ["Litros combustible", `${data.kpis.fuelLoadCount} cargas`, data.kpis.fuelLiters],
        ["Promedio OC", "Monto promedio de OC", data.kpis.averageOrderAmount],
      ],
    },
    {
      worksheetName: "Gasto mensual",
      headers: ["Mes", "Compras", "Combustible", "Total"],
      rows: data.spendByMonth.map((row) => [row.month, row.purchasingAmount, row.fuelAmount, row.totalAmount]),
    },
    {
      worksheetName: "Proveedores",
      headers: ["Proveedor", "Módulo", "Eventos", "Monto"],
      rows: data.topSuppliers.map((row) => [row.name, row.module ?? "Compras", row.count, row.totalAmount]),
    },
    {
      worksheetName: "Faenas",
      headers: ["Faena", "Monto"],
      rows: data.topWorksites.map((row) => [row.name, row.totalAmount]),
    },
    {
      worksheetName: "Vehículos",
      headers: ["Patente", "Tipo", "Combustible", "Servicios/Mantenciones", "Repuestos/Servicios", "Total", "Litros", "Cargas", "Km", "Horómetro"],
      rows: data.vehicleCosts.map((row) => [
        row.plate,
        row.type,
        row.totalFuelAmount,
        row.totalServiceAmount,
        row.totalPartsAmount,
        row.totalOperationalCost,
        row.totalLiters,
        row.loadCount,
        row.lastOdometerReading,
        row.lastHourMeterReading,
      ]),
    },
    {
      worksheetName: "Stock",
      headers: ["Producto", "SKU", "Faena", "Stock", "Mínimo"],
      rows: data.stockRisks.map((row) => [row.productName, row.sku, row.worksiteName, row.currentQty, row.minStock]),
    },
    {
      worksheetName: "EPP",
      headers: ["Producto", "Trabajador", "Faena", "Cantidad", "Entregas"],
      rows: data.eppDeliveries.map((row) => [row.productName, row.workerName, row.worksiteName, row.totalQty, row.deliveryCount]),
    },
    {
      worksheetName: "Alertas",
      headers: ["Tipo", "Severidad", "Módulo", "Entidad", "Motivo", "Acción", "Detectada"],
      rows: data.alerts.map((alert) => [
        alert.type,
        alert.severity,
        alert.module,
        alert.entityLabel,
        alert.reason,
        alert.action,
        alert.detectedAt,
      ]),
    },
    {
      worksheetName: "Brechas",
      headers: ["Brecha"],
      rows: data.dataGaps.map((gap) => [gap]),
    },
  ]

  return {
    filenameBase: "analitica-transversal",
    worksheetName: "Analítica",
    headers: ["Sección", "Indicador", "Detalle", "Monto/Cantidad"],
    rows,
    sheets,
  }
}

function addWorksheet(workbook: ExcelJS.Workbook, sheet: ReportSheet) {
  const worksheet = workbook.addWorksheet(sheet.worksheetName)
  worksheet.addRow(sheet.headers)
  for (const row of sheet.rows) worksheet.addRow(row.map((cell) => cell ?? ""))

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: "middle" }

  worksheet.columns.forEach((column, index) => {
    const header = sheet.headers[index] ?? ""
    let width = Math.max(12, header.length + 2)
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      width = Math.max(width, String(cell.value ?? "").length + 2)
    })
    column.width = Math.min(width, 42)
  })
  worksheet.views = [{ state: "frozen", ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.headers.length },
  }
}

/* ── List exports (mirror the on-screen Adquisiciones lists) ────────────────── */

const RECEIVABLE_OC_STATUSES = ["sent", "partially_office_received", "office_received", "partially_received"]

/** Solicitudes list export — same columns/filters as /solicitudes. */
async function solicitudesList(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const where = and(
    buildWorksiteFilter(session, purchaseRequests.worksiteId),
    buildDateFilter(filters, purchaseRequests.createdAt),
    filters.status ? eq(purchaseRequests.status, filters.status) : undefined,
    filters.worksiteId ? eq(purchaseRequests.worksiteId, filters.worksiteId) : undefined,
    textSearchSql(filters.q ?? "", [purchaseRequests.code]),
  )

  const rows = await db
    .select({
      id:          purchaseRequests.id,
      code:        purchaseRequests.code,
      requestType: purchaseRequests.requestType,
      worksiteId:  purchaseRequests.worksiteId,
      urgency:     purchaseRequests.urgency,
      status:      purchaseRequests.status,
      submittedAt: purchaseRequests.submittedAt,
      createdAt:   purchaseRequests.createdAt,
    })
    .from(purchaseRequests)
    .where(where)
    .orderBy(desc(purchaseRequests.createdAt))
    .limit(limit + 1)

  const rowLimitApplied = rows.length > limit
  const limited = rowLimitApplied ? rows.slice(0, limit) : rows

  const ids   = limited.map((r) => r.id)
  const wsIds = [...new Set(limited.map((r) => r.worksiteId))]
  const [wsRows, itemCounts] = await Promise.all([
    wsIds.length ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds)) : [],
    ids.length ? db.select({ requestId: purchaseRequestItems.requestId, total: count() }).from(purchaseRequestItems).where(inArray(purchaseRequestItems.requestId, ids)).groupBy(purchaseRequestItems.requestId) : [],
  ])
  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const cntMap = Object.fromEntries(itemCounts.map((c) => [c.requestId, c.total]))

  return {
    filenameBase: "solicitudes",
    worksheetName: "Solicitudes",
    headers: ["Código", "Tipo", "Faena", "Urgencia", "Ítems", "Estado", "Fecha"],
    rows: limited.map((r) => [
      r.code,
      REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType,
      wsMap[r.worksiteId] ?? r.worksiteId,
      URGENCY_LABELS[r.urgency ?? ""] ?? r.urgency ?? "",
      cntMap[r.id] ?? 0,
      requestStatusLabel(r.status),
      formatDate(r.submittedAt ?? r.createdAt),
    ]),
    rowLimitApplied,
  }
}

/** Compras (OC) list export — same columns/filters as /compras. */
async function comprasList(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const where = and(
    buildWorksiteFilter(session, purchaseOrders.worksiteId),
    buildDateFilter(filters, purchaseOrders.createdAt),
    filters.status ? eq(purchaseOrders.status, filters.status) : undefined,
    filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined,
    filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined,
    textSearchSql(filters.q ?? "", [purchaseOrders.code]),
  )

  const rows = await db
    .select({
      id:          purchaseOrders.id,
      code:        purchaseOrders.code,
      worksiteId:  purchaseOrders.worksiteId,
      supplierId:  purchaseOrders.supplierId,
      status:      purchaseOrders.status,
      totalAmount: purchaseOrders.totalAmount,
      createdAt:   purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(limit + 1)

  const rowLimitApplied = rows.length > limit
  const limited = rowLimitApplied ? rows.slice(0, limit) : rows

  const ids    = limited.map((o) => o.id)
  const wsIds  = [...new Set(limited.map((o) => o.worksiteId))]
  const supIds = [...new Set(limited.map((o) => o.supplierId))]
  const [wsRows, supRows, itemCounts, invoiceCounts] = await Promise.all([
    wsIds.length  ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds)) : [],
    supIds.length ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supIds)) : [],
    ids.length ? db.select({ purchaseOrderId: purchaseOrderItems.purchaseOrderId, total: count() }).from(purchaseOrderItems).where(inArray(purchaseOrderItems.purchaseOrderId, ids)).groupBy(purchaseOrderItems.purchaseOrderId) : [],
    ids.length ? db.select({ purchaseOrderId: purchaseOrderInvoices.purchaseOrderId, total: count() }).from(purchaseOrderInvoices).where(inArray(purchaseOrderInvoices.purchaseOrderId, ids)).groupBy(purchaseOrderInvoices.purchaseOrderId) : [],
  ])
  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supRows.map((s) => [s.id, s.name]))
  const cntMap = Object.fromEntries(itemCounts.map((c) => [c.purchaseOrderId, c.total]))
  const invMap = Object.fromEntries(invoiceCounts.map((c) => [c.purchaseOrderId, c.total]))

  return {
    filenameBase: "ordenes-de-compra",
    worksheetName: "Órdenes de compra",
    headers: ["Código OC", "Faena", "Proveedor", "Ítems", "Total", "Estado", "Facturas", "Fecha"],
    rows: limited.map((o) => [
      o.code,
      wsMap[o.worksiteId] ?? o.worksiteId,
      supMap[o.supplierId] ?? o.supplierId,
      cntMap[o.id] ?? 0,
      o.totalAmount,
      ocStatusLabel(o.status),
      invMap[o.id] ?? 0,
      formatDate(o.createdAt),
    ]),
    rowLimitApplied,
  }
}

/** Recepción list export — OCs in receivable states, same filters as /recepcion. */
async function recepcionList(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const where = and(
    inArray(purchaseOrders.status, RECEIVABLE_OC_STATUSES),
    buildWorksiteFilter(session, purchaseOrders.worksiteId),
    filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined,
    filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined,
    textSearchSql(filters.q ?? "", [purchaseOrders.code]),
  )

  const rows = await db
    .select({
      code:       purchaseOrders.code,
      worksiteId: purchaseOrders.worksiteId,
      supplierId: purchaseOrders.supplierId,
      status:     purchaseOrders.status,
      sentAt:     purchaseOrders.sentAt,
    })
    .from(purchaseOrders)
    .where(where)
    .orderBy(desc(purchaseOrders.sentAt))
    .limit(limit + 1)

  const rowLimitApplied = rows.length > limit
  const limited = rowLimitApplied ? rows.slice(0, limit) : rows

  const wsIds  = [...new Set(limited.map((o) => o.worksiteId))]
  const supIds = [...new Set(limited.map((o) => o.supplierId))]
  const [wsRows, supRows] = await Promise.all([
    wsIds.length  ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds)) : [],
    supIds.length ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supIds)) : [],
  ])
  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supRows.map((s) => [s.id, s.name]))

  return {
    filenameBase: "recepcion",
    worksheetName: "Recepción",
    headers: ["Código OC", "Faena", "Proveedor", "Estado", "Enviada"],
    rows: limited.map((o) => [
      o.code,
      wsMap[o.worksiteId] ?? o.worksiteId,
      supMap[o.supplierId] ?? o.supplierId,
      ocStatusLabel(o.status),
      o.sentAt ? formatDate(o.sentAt) : "",
    ]),
    rowLimitApplied,
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
  if (ids.length === 0) return sql`false`
  return inArray(column, ids as never[])
}

function buildDateFilter(filters: ExportFilters, column: SQLWrapper) {
  if (!filters.fromDate && !filters.toDate) return undefined
  const conditions = []
  if (filters.fromDate) conditions.push(sql`${column} >= ${filters.fromDate}`)
  if (filters.toDate) conditions.push(sql`${column} <= ${filters.toDate}T23:59:59`)
  return and(...conditions)
}
