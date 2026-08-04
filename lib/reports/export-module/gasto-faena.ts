import type { Session } from "next-auth"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, worksites, suppliers } from "@/db/schema"
import { formatDate } from "@/lib/utils"
import { buildWorksiteFilter, buildDateFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"
import { ocStatusLabel } from "./labels"

export async function gastoPorFaena(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
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
      ocStatusLabel(o.status),
      o.totalAmount,
      formatDate(o.createdAt),
    ]),
    rowLimitApplied,
  }
}
