import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db }       from "@/db"
import {
  purchaseOrders, purchaseOrderItems, purchaseOrderInvoices,
  worksites, suppliers, products,
  purchaseRequests,
} from "@/db/schema"
import { and, or, ilike, inArray, count, desc, eq, sql } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { can } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { parseListParams, statusSql, eqFilter, worksiteEqSql } from "@/lib/adquisiciones/list-query"
import { ComprasActions } from "./compras-actions"
import { OcList } from "./oc-list"
import type { OcRow } from "./oc-list"
import { purchaseRequestItems } from "@/db/schema"

export const metadata: Metadata = { title: "Órdenes de compra" }

import { ORDERS_PAGE_SIZE } from "@/lib/constants"

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("purchasing:view") }
  catch { redirect("/forbidden") }
  const sp = await searchParams
  const createdCountRaw = typeof sp.creadas === "string" ? Number(sp.creadas) : 0
  const createdCount = Number.isFinite(createdCountRaw) && createdCountRaw > 1 ? createdCountRaw : 0
  const visibleWsIds = visibleWorksiteIds(session)
  const worksiteScope = isGlobalRole(session)
    ? undefined
    : visibleWsIds.length > 0
      ? inArray(purchaseOrders.worksiteId, visibleWsIds)
      : sql`false`
  const requestWorksiteScope = isGlobalRole(session)
    ? undefined
    : visibleWsIds.length > 0
      ? inArray(purchaseRequests.worksiteId, visibleWsIds)
      : sql`false`

  // ── Approved / pending_purchase items (never-miss alert) ────────────────────
  const [[pendingRow], [postponedRow]] = await Promise.all([
    db
    .select({ total: count() })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(and(
      inArray(purchaseRequestItems.status, ["approved", "pending_purchase"]),
      requestWorksiteScope,
    )),
    db
      .select({ total: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(and(
        eq(purchaseRequestItems.status, "postponed"),
        requestWorksiteScope,
      )),
  ])
  const pendingCount = pendingRow?.total ?? 0
  const postponedCount = postponedRow?.total ?? 0

  // URL-synced search & filters (server-side, so search finds records on any page)
  const listParams = parseListParams(sp)

  // Extended text search: match OC code OR supplier name via EXISTS subquery.
  function escapeLikeLocal(v: string) { return v.replace(/[\\%_]/g, (c) => `\\${c}`) }
  const q = listParams.q.trim()
  const likePattern = q ? `%${escapeLikeLocal(q)}%` : null
  const textCondition = likePattern
    ? or(
        ilike(purchaseOrders.code, likePattern),
        sql`EXISTS (SELECT 1 FROM suppliers s WHERE s.id = ${purchaseOrders.supplierId} AND s.name ILIKE ${likePattern})`,
      )
    : undefined

  const ordersWhere = and(
    worksiteScope,
    textCondition,
    statusSql(purchaseOrders.status, listParams.estados),
    worksiteEqSql(purchaseOrders.worksiteId, listParams.faena),
    eqFilter(purchaseOrders.supplierId, listParams.proveedor),
  )

  const [totalOrdersRow] = await db
    .select({ total: count() })
    .from(purchaseOrders)
    .where(ordersWhere)
  const pagination = resolvePagination({
    pageParam: sp.page,
    totalItems: totalOrdersRow?.total ?? 0,
    pageSize: ORDERS_PAGE_SIZE,
  })

  // Worksite options for the faena filter (scoped + active)
  const worksiteOptionRows = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(isGlobalRole(session)
      ? eq(worksites.isActive, true)
      : visibleWsIds.length > 0
        ? and(eq(worksites.isActive, true), inArray(worksites.id, visibleWsIds))
        : sql`false`)
  const worksiteOptions = worksiteOptionRows.map((w) => ({ value: w.id, label: w.name }))

  // Supplier options for the proveedor filter (active suppliers)
  const supplierOptionRows = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(suppliers.name)
  const supplierOptions = supplierOptionRows.map((s) => ({ value: s.id, label: s.name }))

  // ── Purchase orders ──────────────────────────────────────────────────────────
  const visibleOrders = await db
    .select({
      id:          purchaseOrders.id,
      code:        purchaseOrders.code,
      worksiteId:  purchaseOrders.worksiteId,
      supplierId:  purchaseOrders.supplierId,
      status:      purchaseOrders.status,
      totalAmount: purchaseOrders.totalAmount,
      issuedAt:    purchaseOrders.issuedAt,
      sentAt:      purchaseOrders.sentAt,
      createdAt:   purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .where(ordersWhere)
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset)
  const pageHref = (page: number) => buildPaginationHref("/compras", sp, page)

  const canCreateOrder = can(session, "purchasing:create_order")
  const canDeleteOrder = can(session, "purchasing:delete_order")
  const headerSignals: HeaderSignal[] = [
    { key: "no-oc", label: "Sin OC", value: pendingCount, href: canCreateOrder ? "/compras/nueva" : undefined, tone: "signal" },
    { key: "postponed", label: "Postergados", value: postponedCount, tone: "signal" },
  ]

  if (visibleOrders.length === 0 && pendingCount === 0 && postponedCount === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Órdenes de compra"
          description="Órdenes de compra y bandeja de ítems aprobados."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Órdenes de compra" },
            ]} />
          }
          headerActions={<HeaderSignals signals={headerSignals} />}
          actions={<ComprasActions canCreate={canCreateOrder} />}
        />
        <OcList orders={[]} pendingCount={0} postponedItems={[]} canCreate={canCreateOrder} canDelete={canDeleteOrder} createdCount={createdCount} worksiteOptions={worksiteOptions} supplierOptions={supplierOptions} />

        <ServerPagination pagination={pagination} hrefForPage={pageHref} />
      </PageContainer>
    )
  }

  const orderIds    = visibleOrders.map((o) => o.id)
  const wsIds       = [...new Set(visibleOrders.map((o) => o.worksiteId))]
  const supplierIds = [...new Set(visibleOrders.map((o) => o.supplierId))]

  const [wsRows, supplierRows, itemCounts, invoiceCounts, postponedRows] = await Promise.all([
    wsIds.length > 0
      ? db
          .select({ id: worksites.id, name: worksites.name })
          .from(worksites)
          .where(inArray(worksites.id, wsIds))
      : Promise.resolve([]),

    supplierIds.length > 0
      ? db
          .select({ id: suppliers.id, name: suppliers.name })
          .from(suppliers)
          .where(inArray(suppliers.id, supplierIds))
      : Promise.resolve([]),

    orderIds.length > 0
      ? db
          .select({ purchaseOrderId: purchaseOrderItems.purchaseOrderId, total: count() })
          .from(purchaseOrderItems)
          .where(inArray(purchaseOrderItems.purchaseOrderId, orderIds))
          .groupBy(purchaseOrderItems.purchaseOrderId)
      : Promise.resolve([]),

    orderIds.length > 0
      ? db
          .select({ purchaseOrderId: purchaseOrderInvoices.purchaseOrderId, total: count() })
          .from(purchaseOrderInvoices)
          .where(inArray(purchaseOrderInvoices.purchaseOrderId, orderIds))
          .groupBy(purchaseOrderInvoices.purchaseOrderId)
      : Promise.resolve([]),

    postponedCount > 0
      ? db
          .select({
            id: purchaseRequestItems.id,
            requestId: purchaseRequestItems.requestId,
            requestCode: purchaseRequests.code,
            worksiteId: purchaseRequests.worksiteId,
            worksiteName: worksites.name,
            productNameFree: purchaseRequestItems.productNameFree,
            productName: products.name,
            productSku: products.sku,
            quantity: purchaseRequestItems.quantity,
            unitOfMeasure: purchaseRequestItems.unitOfMeasure,
            urgency: purchaseRequestItems.urgency,
            notes: purchaseRequestItems.notes,
          })
          .from(purchaseRequestItems)
          .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
          .innerJoin(worksites, eq(purchaseRequests.worksiteId, worksites.id))
          .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
          .where(and(eq(purchaseRequestItems.status, "postponed"), requestWorksiteScope))
          .orderBy(desc(purchaseRequestItems.updatedAt))
          .limit(10)
      : Promise.resolve([]),
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supplierRows.map((s) => [s.id, s.name]))
  const cntMap = Object.fromEntries(itemCounts.map((c) => [c.purchaseOrderId, c.total]))
  const invMap = Object.fromEntries(invoiceCounts.map((c) => [c.purchaseOrderId, c.total]))

  const rows: OcRow[] = visibleOrders.map((o) => ({
    id:           o.id,
    code:         o.code,
    worksiteName: wsMap[o.worksiteId]  ?? o.worksiteId,
    supplierName: supMap[o.supplierId] ?? o.supplierId,
    status:       o.status,
    itemCount:    cntMap[o.id] ?? 0,
    totalAmount:  o.totalAmount,
    invoiceCount: invMap[o.id] ?? 0,
    issuedAt:     o.issuedAt,
    sentAt:       o.sentAt,
    createdAt:    o.createdAt,
  }))

  const postponedItems = postponedRows.map((item) => ({
    id: item.id,
    requestId: item.requestId,
    requestCode: item.requestCode,
    worksiteId: item.worksiteId,
    worksiteName: item.worksiteName,
    productName: item.productName ?? item.productNameFree ?? "(sin nombre)",
    productSku: item.productSku,
    quantity: item.quantity,
    unitOfMeasure: item.unitOfMeasure,
    urgency: item.urgency ?? "normal",
    notes: item.notes,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Órdenes de compra"
        description="Órdenes de compra y bandeja de ítems aprobados."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Órdenes de compra" },
          ]} />
        }
        headerActions={<HeaderSignals signals={headerSignals} />}
        actions={<ComprasActions canCreate={canCreateOrder} />}
      />
      <OcList
        orders={rows}
        pendingCount={pendingCount}
        postponedItems={postponedItems}
        canCreate={canCreateOrder}
        canDelete={canDeleteOrder}
        createdCount={createdCount}
        worksiteOptions={worksiteOptions}
        supplierOptions={supplierOptions}
      />
      <ServerPagination pagination={pagination} hrefForPage={pageHref} />
    </PageContainer>
  )
}
