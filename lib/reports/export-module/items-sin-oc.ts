import type { Session } from "next-auth"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems, products, worksites } from "@/db/schema"
import { formatDate } from "@/lib/utils"
import { pendingPurchaseWhere } from "@/lib/adquisiciones/pending-purchase"
import { buildWorksiteFilter, buildDateFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"
import { getProductSizesByIds } from "@/lib/services/product-sizes"

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
    // Sin `status` explícito el reporte responde la misma pregunta que la cola
    // de Compras, así que usa su predicado y no un criterio propio: exportaba
    // ítems de solicitudes cerradas y con cobertura activa, o sea más filas que
    // el panel de /reportes que enlaza a esta descarga. Con `status` explícito
    // el usuario pidió otro corte y sólo se mantiene el suyo.
    .where(filters.status
      ? and(inArray(purchaseRequestItems.status, alertStates), requestFilter, dateFilter, wsFilter)
      : pendingPurchaseWhere(requestFilter, dateFilter, wsFilter))
    .limit(limit + 1)

  const rowLimitApplied = items.length > limit
  const limited = rowLimitApplied ? items.slice(0, limit) : items

  const headers = ["Producto", "Talla", "SKU", "Faena", "Solicitud", "Cantidad", "U/M", "Estado", "Fecha creación"]
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

  // Lo que falta comprar se pide por talla: el reporte sin ella no es accionable.
  const sizeById = await getProductSizesByIds(prodIds)

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
        (i.productId ? sizeById.get(i.productId)?.label : null) ?? "",
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
