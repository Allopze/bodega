import type { Session } from "next-auth"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems, products, worksites } from "@/db/schema"
import { formatDate } from "@/lib/utils"
import { buildWorksiteFilter, buildDateFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"

export async function itemsSinOc(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
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
