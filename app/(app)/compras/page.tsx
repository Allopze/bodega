import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db }       from "@/db"
import {
  purchaseOrders, purchaseOrderItems,
  worksites, suppliers,
  purchaseRequests,
} from "@/db/schema"
import { and, inArray, count, desc, eq, sql } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { can } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { OcList } from "./oc-list"
import type { OcRow } from "./oc-list"
import { purchaseRequestItems } from "@/db/schema"

export const metadata: Metadata = { title: "Órdenes de compra" }

const ORDERS_PAGE_SIZE = 25

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("purchasing:view") }
  catch { redirect("/dashboard") }
  const sp = await searchParams
  const createdCountRaw = typeof sp.creadas === "string" ? Number(sp.creadas) : 0
  const createdCount = Number.isFinite(createdCountRaw) && createdCountRaw > 1 ? createdCountRaw : 0
  const visibleWsIds = visibleWorksiteIds(session)
  const worksiteScope = isGlobalRole(session)
    ? undefined
    : visibleWsIds.length > 0
      ? inArray(purchaseOrders.worksiteId, visibleWsIds)
      : sql`1 = 0`
  const requestWorksiteScope = isGlobalRole(session)
    ? undefined
    : visibleWsIds.length > 0
      ? inArray(purchaseRequests.worksiteId, visibleWsIds)
      : sql`1 = 0`

  // ── Approved / pending_purchase items (never-miss alert) ────────────────────
  const [pendingRow] = await db
    .select({ total: count() })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(and(
      inArray(purchaseRequestItems.status, ["approved", "pending_purchase"]),
      requestWorksiteScope,
    ))
  const pendingCount = pendingRow?.total ?? 0
  const [totalOrdersRow] = await db
    .select({ total: count() })
    .from(purchaseOrders)
    .where(worksiteScope)
  const pagination = resolvePagination({
    pageParam: sp.page,
    totalItems: totalOrdersRow?.total ?? 0,
    pageSize: ORDERS_PAGE_SIZE,
  })

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
    .where(worksiteScope)
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset)
  const pageHref = (page: number) => buildPaginationHref("/compras", sp, page)

  if (visibleOrders.length === 0 && pendingCount === 0) {
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
        />
        <OcList orders={[]} pendingCount={0} canCreate={can(session, "purchasing:create_order")} createdCount={createdCount} />
        <ServerPagination pagination={pagination} hrefForPage={pageHref} />
      </PageContainer>
    )
  }

  const orderIds    = visibleOrders.map((o) => o.id)
  const wsIds       = [...new Set(visibleOrders.map((o) => o.worksiteId))]
  const supplierIds = [...new Set(visibleOrders.map((o) => o.supplierId))]

  const [wsRows, supplierRows, itemCounts] = await Promise.all([
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
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supplierRows.map((s) => [s.id, s.name]))
  const cntMap = Object.fromEntries(itemCounts.map((c) => [c.purchaseOrderId, c.total]))

  const rows: OcRow[] = visibleOrders.map((o) => ({
    id:           o.id,
    code:         o.code,
    worksiteName: wsMap[o.worksiteId]  ?? o.worksiteId,
    supplierName: supMap[o.supplierId] ?? o.supplierId,
    status:       o.status,
    itemCount:    cntMap[o.id] ?? 0,
    totalAmount:  o.totalAmount,
    issuedAt:     o.issuedAt,
    sentAt:       o.sentAt,
    createdAt:    o.createdAt,
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
      />
      <OcList
        orders={rows}
        pendingCount={pendingCount}
        canCreate={can(session, "purchasing:create_order")}
        createdCount={createdCount}
      />
      <ServerPagination pagination={pagination} hrefForPage={pageHref} />
    </PageContainer>
  )
}
