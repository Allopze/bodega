import type { Metadata } from "next"
import { redirect }       from "next/navigation"
import { db }             from "@/db"
import {
  purchaseRequests, purchaseRequestItems, requestItemAttributes,
  worksites, users as usersTable, products, suppliers,
} from "@/db/schema"
import { eq, and, inArray, asc, sql, count } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { ApprovalPanel } from "./approval-panel"
import type { ApprovalItem, ApprovalRequest } from "./approval-panel"

export const metadata: Metadata = { title: "Aprobaciones" }

import { APPROVAL_REQUESTS_PAGE_SIZE } from "@/lib/constants"

export default async function AprobacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("approvals:approve") }
  catch { redirect("/dashboard") }
  const sp = await searchParams
  const selectedRequestId = typeof sp.solicitud === "string" ? sp.solicitud : ""
  const visibleWsIds = visibleWorksiteIds(session)
  const worksiteScope = isGlobalRole(session)
    ? undefined
    : visibleWsIds.length > 0
      ? inArray(purchaseRequests.worksiteId, visibleWsIds)
      : sql`1 = 0`
  const requestFilter = and(
    inArray(purchaseRequests.status, ["submitted", "in_review", "partially_approved"]),
    // Repuestos are approved via their own quotation flow, not this per-item queue
    sql`${purchaseRequests.requestType} != 'repuestos'`,
    worksiteScope,
    selectedRequestId ? eq(purchaseRequests.id, selectedRequestId) : undefined,
    sql`exists (
      select 1
      from purchase_request_items pending_items
      where pending_items.request_id = ${purchaseRequests.id}
        and pending_items.status = 'requested'
    )`,
  )

  const [totalRequestsRow] = await db
    .select({ total: count() })
    .from(purchaseRequests)
    .where(requestFilter)
  const pagination = resolvePagination({
    pageParam: sp.page,
    totalItems: totalRequestsRow?.total ?? 0,
    pageSize: APPROVAL_REQUESTS_PAGE_SIZE,
  })
  const pageHref = (page: number) => buildPaginationHref("/aprobaciones", sp, page)

  // Load only submitted/in-review requests in the approver's worksite scope.
  const visible = await db
    .select({
      id:           purchaseRequests.id,
      code:         purchaseRequests.code,
      worksiteId:   purchaseRequests.worksiteId,
      urgency:      purchaseRequests.urgency,
      requestType:  purchaseRequests.requestType,
      status:       purchaseRequests.status,
      requesterId:  purchaseRequests.requesterId,
      submittedAt:  purchaseRequests.submittedAt,
    })
    .from(purchaseRequests)
    .where(requestFilter)
    .orderBy(asc(purchaseRequests.submittedAt))
    .limit(pagination.limit)
    .offset(pagination.offset)

  if (visible.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Aprobaciones"
          description="Revisión y aprobación de ítems solicitados por faena."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Aprobaciones" },
            ]} />
          }
        />
        <ApprovalPanel requests={[]} />
        <ServerPagination pagination={pagination} hrefForPage={pageHref} />
      </PageContainer>
    )
  }

  const requestIds   = visible.map((r) => r.id)
  const wsIds        = [...new Set(visible.map((r) => r.worksiteId))]
  const requesterIds = [...new Set(visible.map((r) => r.requesterId))]

  // Load pending items first so we can load their attributes in one shot
  const pendingItems = await db
    .select({
      id:                  purchaseRequestItems.id,
      requestId:           purchaseRequestItems.requestId,
      productId:           purchaseRequestItems.productId,
      productNameFree:     purchaseRequestItems.productNameFree,
      quantity:            purchaseRequestItems.quantity,
      unitOfMeasure:       purchaseRequestItems.unitOfMeasure,
      urgency:             purchaseRequestItems.urgency,
      requiredDate:        purchaseRequestItems.requiredDate,
      notes:               purchaseRequestItems.notes,
      status:              purchaseRequestItems.status,
      sortOrder:           purchaseRequestItems.sortOrder,
      suggestedSupplierId: purchaseRequestItems.suggestedSupplierId,
      supplierHint:        purchaseRequestItems.supplierHint,
    })
    .from(purchaseRequestItems)
    .where(
      and(
        inArray(purchaseRequestItems.requestId, requestIds),
        eq(purchaseRequestItems.status, "requested"),
      ),
    )
    .orderBy(asc(purchaseRequestItems.sortOrder))

  const pendingItemIds = pendingItems.map((i) => i.id)
  const productIds = [...new Set(pendingItems.map((i) => i.productId).filter(Boolean))] as string[]
  const supplierIds = [...new Set(pendingItems.map((i) => i.suggestedSupplierId).filter(Boolean))] as string[]

  // Batch load everything else in parallel
  const [allAttrs, wsRows, requesterRows, productRows, supplierRows] = await Promise.all([
    pendingItemIds.length > 0
      ? db
          .select({
            requestItemId: requestItemAttributes.requestItemId,
            attributeName: requestItemAttributes.attributeName,
            value:         requestItemAttributes.value,
          })
          .from(requestItemAttributes)
          .where(inArray(requestItemAttributes.requestItemId, pendingItemIds))
      : Promise.resolve([]),

    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(inArray(worksites.id, wsIds)),

    requesterIds.length > 0
      ? db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.id, requesterIds))
      : Promise.resolve([]),

    productIds.length > 0
      ? db
          .select({ id: products.id, sku: products.sku, name: products.name })
          .from(products)
          .where(inArray(products.id, productIds))
      : Promise.resolve([]),

    supplierIds.length > 0
      ? db
          .select({ id: suppliers.id, name: suppliers.name })
          .from(suppliers)
          .where(inArray(suppliers.id, supplierIds))
      : Promise.resolve([]),
  ])

  // Build lookup maps
  const wsMap       = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const userMap     = Object.fromEntries(requesterRows.map((u) => [u.id, u.name]))
  const productMap  = Object.fromEntries(productRows.map((p) => [p.id, p]))
  const supplierMap = Object.fromEntries(supplierRows.map((s) => [s.id, s.name]))
  const attrsMap: Record<string, { attributeName: string; value: string }[]> = {}
  for (const a of allAttrs) {
    ;(attrsMap[a.requestItemId] ??= []).push({ attributeName: a.attributeName, value: a.value })
  }

  // Group items by request
  const itemsByRequest: Record<string, typeof pendingItems> = {}
  for (const item of pendingItems) {
    ;(itemsByRequest[item.requestId] ??= []).push(item)
  }

  // Build typed request rows — only requests with at least one pending item
  const rows: ApprovalRequest[] = visible
    .filter((r) => (itemsByRequest[r.id]?.length ?? 0) > 0)
    .map((r): ApprovalRequest => {
      const items = itemsByRequest[r.id] ?? []
      const mappedItems: ApprovalItem[] = items.map((item): ApprovalItem => {
        const product = item.productId ? productMap[item.productId] : null
        return {
          id:                    item.id,
          productName:           product?.name ?? item.productNameFree ?? "(sin nombre)",
          productSku:            product?.sku ?? null,
          quantity:              item.quantity,
          unitOfMeasure:         item.unitOfMeasure,
          urgency:               item.urgency ?? "normal",
          requiredDate:          item.requiredDate,
          notes:                 item.notes,
          status:                item.status,
          attributes:            attrsMap[item.id] ?? [],
          suggestedSupplierName: item.suggestedSupplierId ? supplierMap[item.suggestedSupplierId] : null,
          supplierHint:          item.supplierHint,
        }
      })
      return {
        id:             r.id,
        code:           r.code,
        requestType:    r.requestType,
        worksiteName:   wsMap[r.worksiteId]   ?? r.worksiteId,
        requesterName:  userMap[r.requesterId] ?? r.requesterId,
        requestUrgency: r.urgency,
        submittedAt:    r.submittedAt,
        pendingItems:   mappedItems,
        pendingCount:   mappedItems.length,
      }
    })

  const displayedRows = rows
  const totalPending = displayedRows.reduce((n, r) => n + r.pendingCount, 0)

  return (
    <PageContainer>
      <PageHeader
        title="Aprobaciones"
        description={
          displayedRows.length > 0
            ? `${totalPending} ítem${totalPending !== 1 ? "s" : ""} pendiente${totalPending !== 1 ? "s" : ""} de revisión`
            : "Revisión y aprobación de ítems solicitados por faena."
        }
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard",    href: "/dashboard" },
            { label: "Aprobaciones" },
          ]} />
        }
      />
      <ApprovalPanel requests={displayedRows} />
      <ServerPagination pagination={pagination} hrefForPage={pageHref} />
    </PageContainer>
  )
}
