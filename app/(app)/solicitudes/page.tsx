import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems, worksites } from "@/db/schema"
import { desc, count, inArray, eq, and, sql } from "drizzle-orm"
import { requirePermission, can, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { RequestList } from "./request-list"

export const metadata: Metadata = { title: "Solicitudes de compra" }

import { SOLICITUDES_PAGE_SIZE } from "@/lib/constants"

export default async function SolicitudesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("requests:view_own") }
  catch { redirect("/dashboard") }

  const sp = await searchParams
  const viewAll = can(session, "requests:view_all")

  // Build worksite filter — solicitantes see only their worksites
  const userWorksiteIds = session.user.worksiteIds ?? []

  const filterConditions = viewAll
    ? undefined
    : and(
        eq(purchaseRequests.requesterId, session.user.id),
        userWorksiteIds.length > 0
          ? inArray(purchaseRequests.worksiteId, userWorksiteIds)
          : sql`1 = 0`
      )

  // Count total matching requests for pagination
  const [totalRow] = await db
    .select({ total: count() })
    .from(purchaseRequests)
    .where(filterConditions)

  const pagination = resolvePagination({
    pageParam: sp.page,
    totalItems: totalRow?.total ?? 0,
    pageSize: SOLICITUDES_PAGE_SIZE,
  })

  // Load paginated requests and active worksites in parallel
  const [pageRequests, activeWorksites] = await Promise.all([
    db
      .select({
        id:           purchaseRequests.id,
        code:         purchaseRequests.code,
        worksiteId:   purchaseRequests.worksiteId,
        urgency:      purchaseRequests.urgency,
        requestType:  purchaseRequests.requestType,
        status:       purchaseRequests.status,
        submittedAt:  purchaseRequests.submittedAt,
        createdAt:    purchaseRequests.createdAt,
        requesterId:  purchaseRequests.requesterId,
      })
      .from(purchaseRequests)
      .where(filterConditions)
      .orderBy(desc(purchaseRequests.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),

    db.select({ id: worksites.id })
      .from(worksites)
      .where(eq(worksites.isActive, true))
  ])

  // Filter worksites scoped to the user
  const scopedWorksites = activeWorksites.filter(
    (w) => canAccessWorksite(session, w.id),
  )
  const hasWorksites = scopedWorksites.length > 0

  const pageHref = (page: number) => buildPaginationHref("/solicitudes", sp, page)

  if (pageRequests.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Solicitudes de compra"
          description="Historial de solicitudes de compra por faena."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Solicitudes" },
            ]} />
          }
        />
        <RequestList requests={[]} canCreate={can(session, "requests:create")} hasWorksites={hasWorksites} />
        <ServerPagination pagination={pagination} hrefForPage={pageHref} />
      </PageContainer>
    )
  }

  const requestIds = pageRequests.map((r) => r.id)
  const wsIds      = [...new Set(pageRequests.map((r) => r.worksiteId))]

  // Batch load related data — only for the current page
  const [wsRows, itemCounts] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(inArray(worksites.id, wsIds)),

    db.select({ requestId: purchaseRequestItems.requestId, total: count() })
      .from(purchaseRequestItems)
      .where(inArray(purchaseRequestItems.requestId, requestIds))
      .groupBy(purchaseRequestItems.requestId),
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const cntMap = Object.fromEntries(itemCounts.map((c) => [c.requestId, c.total]))

  const rows = pageRequests.map((r) => ({
    id:             r.id,
    code:           r.code,
    requestType:    r.requestType,
    worksiteName:   wsMap[r.worksiteId] ?? r.worksiteId,
    urgency:        r.urgency,
    status:         r.status,
    itemCount:      cntMap[r.id] ?? 0,
    submittedAt:    r.submittedAt,
    createdAt:      r.createdAt,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Solicitudes de compra"
        description="Historial de solicitudes de compra por faena."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Solicitudes" },
          ]} />
        }
      />
      <RequestList requests={rows} canCreate={can(session, "requests:create")} hasWorksites={hasWorksites} />
      <ServerPagination pagination={pagination} hrefForPage={pageHref} />
    </PageContainer>
  )
}
