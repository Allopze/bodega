import type { Session } from "next-auth"
import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, worksites, suppliers } from "@/db/schema"
import { textSearchSql } from "@/lib/adquisiciones/list-query"
import { formatDate } from "@/lib/utils"
import { ocStatusLabel, RECEIVABLE_OC_STATUSES } from "./labels"
import { buildWorksiteFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"

export async function recepcionList(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
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
