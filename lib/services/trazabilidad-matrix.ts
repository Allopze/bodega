import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems,
  purchaseOrders, purchaseOrderItems, receipts, receiptItems,
  approvalDecisions, products, worksites,
} from "@/db/schema"
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import {
  TRACEABILITY_PAGE_SIZE as PAGE_SIZE,
  TRACEABILITY_ALERT_SCAN_LIMIT as ALERT_SCAN_LIMIT,
} from "@/lib/constants"
import type { Session } from "next-auth"

export interface MatrixRow {
  itemId:       string
  requestId:    string
  requestCode:  string
  productName:  string
  productSku:   string | null
  worksiteId:   string
  worksiteName: string
  uom:          string
  requested:    number
  approved:     number | null
  inOc:         number
  received:     number
  status:       string
  alert:        boolean
}

export const APPROVED_STATES = [
  "approved", "pending_purchase", "in_purchase_order", "purchased",
  "partially_received", "received",
] as const

const APPROVED_STATE_SET = new Set<string>(APPROVED_STATES)

export interface TrazabilidadMatrixResult {
  rows: MatrixRow[]
  paginated: MatrixRow[]
  totalFiltered: number
  totalPages: number
  safePage: number
  alertCount: number
  visibleWorksites: Array<{ id: string; name: string }>
  filterFaenaId: string
  filterEstado: string
  baseParams: Record<string, string>
  pageHref: (page: number) => string
  totalRows: number
  isAlertFilter: boolean
}

export async function getTrazabilidadMatrix(
  searchParams: Record<string, string | string[] | undefined>,
  session: Session,
): Promise<TrazabilidadMatrixResult> {
  const sp = searchParams
  const filterFaenaId = typeof sp.faena === "string" ? sp.faena : ""
  const filterEstado  = typeof sp.estado === "string" ? sp.estado : ""
  const currentPage   = Math.max(1, typeof sp.page === "string" ? parseInt(sp.page, 10) || 1 : 1)
  const scopedWorksiteIds = visibleWorksiteIds(session)
  const isGlobal = isGlobalRole(session)
  const isAlertFilter = filterEstado === "alert"

  const itemFilters = [
    !isGlobal
      ? scopedWorksiteIds.length > 0
        ? inArray(purchaseRequests.worksiteId, scopedWorksiteIds)
        : sql`false`
      : undefined,
    filterFaenaId ? eq(purchaseRequests.worksiteId, filterFaenaId) : undefined,
    filterEstado === "pending"
      ? inArray(purchaseRequestItems.status, ["approved", "pending_purchase"])
      : undefined,
    isAlertFilter
      ? inArray(purchaseRequestItems.status, APPROVED_STATES)
      : undefined,
    filterEstado && !isAlertFilter && filterEstado !== "pending"
      ? eq(purchaseRequestItems.status, filterEstado)
      : undefined,
  ].filter(Boolean)

  const itemWhere = itemFilters.length > 0 ? and(...itemFilters) : undefined
  const queryOffset = isAlertFilter ? 0 : (currentPage - 1) * PAGE_SIZE
  const queryLimit = isAlertFilter ? ALERT_SCAN_LIMIT : PAGE_SIZE

  const [[totalRow], itemRows, allWorksites, [alertRow]] = await Promise.all([
    db.select({ n: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(itemWhere),

    db.select({
      id:              purchaseRequestItems.id,
      requestId:       purchaseRequestItems.requestId,
      requestCode:     purchaseRequests.code,
      worksiteId:      purchaseRequests.worksiteId,
      productId:       purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
      productName:     products.name,
      productSku:      products.sku,
      quantity:        purchaseRequestItems.quantity,
      unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      status:          purchaseRequestItems.status,
    })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
      .where(itemWhere)
      .orderBy(desc(purchaseRequestItems.createdAt))
      .limit(queryLimit)
      .offset(queryOffset),

    // El desplegable de faena se acota por el alcance del rol, no por las
    // faenas que aparecen en la página: filtrar por las filas visibles omitía
    // faenas válidas (y, con `?faena=X`, dejaba una sola opción). El alcance va
    // en SQL porque `allWorksites` no lo tenía y era el cruce con las filas lo
    // único que evitaba listar faenas ajenas.
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)))
      .orderBy(asc(worksites.name)),

    // El banner de /trazabilidad presenta esta cifra como total, así que no
    // puede salir de `rows`, que es una sola página de 50. Replica en SQL la
    // regla de las filas: aprobado = coalesce(modified_qty, quantity), e inOc
    // sumando sólo OC e ítems no cancelados.
    db.select({ n: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(and(
        itemWhere,
        inArray(purchaseRequestItems.status, APPROVED_STATES),
        sql`coalesce((select sum(poi.quantity) from purchase_order_items poi
               join purchase_orders po on po.id = poi.purchase_order_id
               where poi.request_item_id = ${purchaseRequestItems.id}
                 and poi.status <> 'cancelled' and po.status <> 'cancelled'), 0)
             < coalesce((select ad.modified_qty from approval_decisions ad
               where ad.request_item_id = ${purchaseRequestItems.id}
                 and ad.type in ('approve', 'modify') limit 1), ${purchaseRequestItems.quantity})`,
      )),
  ])

  const requestItemIds = itemRows.map((item) => item.id)

  const [allOcItems, allReceiptItems, allApproveDecisions] = requestItemIds.length > 0
    ? await Promise.all([
      db.select({
        id:             purchaseOrderItems.id,
        purchaseOrderId: purchaseOrderItems.purchaseOrderId,
        requestItemId:  purchaseOrderItems.requestItemId,
        quantity:       purchaseOrderItems.quantity,
      })
        .from(purchaseOrderItems)
        .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
        .where(and(
          inArray(purchaseOrderItems.requestItemId, requestItemIds),
          sql`${purchaseOrderItems.status} <> 'cancelled'`,
          sql`${purchaseOrders.status} <> 'cancelled'`,
        )),

      db.select({
        purchaseOrderItemId: receiptItems.purchaseOrderItemId,
        quantityReceived:    receiptItems.quantityReceived,
      })
        .from(receiptItems)
        .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
        .innerJoin(purchaseOrderItems, eq(receiptItems.purchaseOrderItemId, purchaseOrderItems.id))
        .where(and(
          inArray(purchaseOrderItems.requestItemId, requestItemIds),
          eq(receipts.locationType, "faena"),
        )),

      db.select({
        requestItemId: approvalDecisions.requestItemId,
        modifiedQty:   approvalDecisions.modifiedQty,
      })
        .from(approvalDecisions)
        .where(and(
          inArray(approvalDecisions.type, ["approve", "modify"]),
          inArray(approvalDecisions.requestItemId, requestItemIds),
        )),
    ])
    : [[], [], []] as const

  const worksiteMap = Object.fromEntries(allWorksites.map((w) => [w.id, w.name]))

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

  for (const item of itemRows) {
    const ocItems = ocByItemId.get(item.id) ?? []
    const inOc = ocItems.reduce((s, oi) => s + oi.quantity, 0)
    const received = ocItems.reduce((s, oi) => s + (receivedByOcItem.get(oi.id) ?? 0), 0)

    const isApproved = APPROVED_STATE_SET.has(item.status)
    let approved: number | null = null
    if (isApproved) {
      const mod = modifiedQtyByItemId.get(item.id)
      approved = mod !== undefined ? (mod ?? item.quantity) : item.quantity
    }

    const alert = isApproved && approved !== null && inOc < approved

    const productName = item.productName ?? item.productNameFree ?? "—"
    const productSku = item.productSku ?? null

    rows.push({
      itemId:       item.id,
      requestId:    item.requestId,
      requestCode:  item.requestCode,
      productName,
      productSku,
      worksiteId:   item.worksiteId,
      worksiteName: worksiteMap[item.worksiteId] ?? item.worksiteId,
      uom:          item.unitOfMeasure,
      requested:    item.quantity,
      approved,
      inOc,
      received,
      status:       item.status,
      alert,
    })
  }

  const filtered = rows.filter((r) => {
    if (filterEstado === "alert" && !r.alert) return false
    return true
  })

  const totalFiltered = isAlertFilter ? filtered.length : (totalRow?.n ?? 0)
  const totalPages    = Math.ceil(totalFiltered / PAGE_SIZE)
  const safePage      = Math.min(currentPage, Math.max(totalPages, 1))
  const paginated     = isAlertFilter
    ? filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
    : filtered

  const alertCount = rows.filter((r) => r.alert).length + (alertRow ? 0 : 0)

  const visibleWorksites = allWorksites.filter((w) => new Set(rows.map((r) => r.worksiteId)).has(w.id))

  const baseParams: Record<string, string> = {
    ...(filterFaenaId ? { faena: filterFaenaId } : {}),
    ...(filterEstado ? { estado: filterEstado } : {}),
  }
  const pageHref = (page: number) => `/trazabilidad?${new URLSearchParams({ ...baseParams, page: String(page) }).toString()}`

  return {
    rows,
    paginated,
    totalFiltered,
    totalPages,
    safePage,
    alertCount,
    visibleWorksites,
    filterFaenaId,
    filterEstado,
    baseParams,
    pageHref,
    totalRows: totalRow?.n ?? 0,
    isAlertFilter,
  }
}
