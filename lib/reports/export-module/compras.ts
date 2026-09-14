import type { Session } from "next-auth"
import { and, count, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderItems, purchaseOrderInvoices, worksites, suppliers } from "@/db/schema"
import { textSearchSql } from "@/lib/adquisiciones/list-query"
import { orderNeedsInvoiceWork } from "@/lib/services/operational-work-queue"
import { formatDate } from "@/lib/utils"
import { ocStatusLabel } from "./labels"
import { buildWorksiteFilter, buildDateFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"
import { invoiceNotVoided } from "@/lib/services/purchasing-module/invoice-scope"

export async function comprasList(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const where = and(
    buildWorksiteFilter(session, purchaseOrders.worksiteId),
    buildDateFilter(filters, purchaseOrders.createdAt),
    filters.status ? eq(purchaseOrders.status, filters.status) : undefined,
    filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined,
    filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined,
    textSearchSql(filters.q ?? "", [purchaseOrders.code]),
    // Mismo criterio que el listado y la cola operacional: exportar mientras el
    // filtro de facturación está activo baja solo el trabajo no resuelto.
    filters.invoicePending
      ? orderNeedsInvoiceWork
      : undefined,
  )

  const rows = await db
    .select({
      id:          purchaseOrders.id,
      code:        purchaseOrders.code,
      worksiteId:  purchaseOrders.worksiteId,
      supplierId:  purchaseOrders.supplierId,
      status:      purchaseOrders.status,
      invoiceReconciliationStatus: purchaseOrders.invoiceReconciliationStatus,
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
    ids.length ? db.select({ purchaseOrderId: purchaseOrderInvoices.purchaseOrderId, total: count() }).from(purchaseOrderInvoices).where(and(inArray(purchaseOrderInvoices.purchaseOrderId, ids), invoiceNotVoided)).groupBy(purchaseOrderInvoices.purchaseOrderId) : [],
  ])
  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supRows.map((s) => [s.id, s.name]))
  const cntMap = Object.fromEntries(itemCounts.map((c) => [c.purchaseOrderId, c.total]))
  const invMap = Object.fromEntries(invoiceCounts.map((c) => [c.purchaseOrderId, c.total]))

  return {
    filenameBase: "ordenes-de-compra",
    worksheetName: "Órdenes de compra",
    headers: ["Código OC", "Faena", "Proveedor", "Ítems", "Total", "Estado", "Facturas", "Conciliación", "Fecha"],
    rows: limited.map((o) => [
      o.code,
      wsMap[o.worksiteId] ?? o.worksiteId,
      supMap[o.supplierId] ?? o.supplierId,
      cntMap[o.id] ?? 0,
      o.totalAmount,
      ocStatusLabel(o.status),
      invMap[o.id] ?? 0,
      o.invoiceReconciliationStatus === "needs_review" ? "Revisión requerida"
        : o.invoiceReconciliationStatus === "partially_invoiced" ? "Facturación parcial"
        : o.invoiceReconciliationStatus === "awaiting_receipt" ? "Recepción pendiente"
        : o.invoiceReconciliationStatus === "accepted_exception" ? "Diferencias aceptadas"
        : o.invoiceReconciliationStatus === "matched" ? "Conciliada"
        : "Sin facturas",
      formatDate(o.createdAt),
    ]),
    rowLimitApplied,
  }
}
