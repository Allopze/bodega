import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems, worksites, costCenters } from "@/db/schema"
import { desc, count, inArray, eq } from "drizzle-orm"
import { requirePermission, can, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { RequestList } from "./request-list"

export const metadata: Metadata = { title: "Solicitudes de compra" }

export default async function SolicitudesPage() {
  let session
  try { session = await requirePermission("requests:view_own") }
  catch { redirect("/dashboard") }

  const viewAll = can(session, "requests:view_all")

  // Build worksite filter — solicitantes see only their worksites
  const userWorksiteIds = session.user.worksiteIds ?? []

  // Load requests and active worksites in parallel
  const [allRequests, activeWorksites] = await Promise.all([
    db
      .select({
        id:           purchaseRequests.id,
        code:         purchaseRequests.code,
        worksiteId:   purchaseRequests.worksiteId,
        costCenterId: purchaseRequests.costCenterId,
        urgency:      purchaseRequests.urgency,
        status:       purchaseRequests.status,
        submittedAt:  purchaseRequests.submittedAt,
        createdAt:    purchaseRequests.createdAt,
        requesterId:  purchaseRequests.requesterId,
      })
      .from(purchaseRequests)
      .orderBy(desc(purchaseRequests.createdAt)),

    db.select({ id: worksites.id })
      .from(worksites)
      .where(eq(worksites.isActive, true))
  ])

  // Filter worksites scoped to the user
  const scopedWorksites = activeWorksites.filter(
    (w) => canAccessWorksite(session, w.id),
  )
  const hasWorksites = scopedWorksites.length > 0

  // Faena requesters see only their own requests inside assigned worksites.
  const visible = viewAll
    ? allRequests
    : allRequests.filter(
        (r) => r.requesterId === session.user.id && userWorksiteIds.includes(r.worksiteId),
      )

  if (visible.length === 0) {
    return (
      <>
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

      </>
    )
  }

  const requestIds = visible.map((r) => r.id)
  const wsIds      = [...new Set(visible.map((r) => r.worksiteId))]
  const ccIds      = [...new Set(visible.map((r) => r.costCenterId).filter(Boolean))] as string[]

  // Batch load related data
  const [wsRows, ccRows, itemCounts] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(inArray(worksites.id, wsIds)),

    ccIds.length > 0
      ? db.select({ id: costCenters.id, name: costCenters.name })
          .from(costCenters)
          .where(inArray(costCenters.id, ccIds))
      : Promise.resolve([]),

    db.select({ requestId: purchaseRequestItems.requestId, total: count() })
      .from(purchaseRequestItems)
      .where(inArray(purchaseRequestItems.requestId, requestIds))
      .groupBy(purchaseRequestItems.requestId),
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const ccMap  = Object.fromEntries(ccRows.map((c) => [c.id, c.name]))
  const cntMap = Object.fromEntries(itemCounts.map((c) => [c.requestId, c.total]))

  const rows = visible.map((r) => ({
    id:             r.id,
    code:           r.code,
    worksiteName:   wsMap[r.worksiteId] ?? r.worksiteId,
    costCenterName: r.costCenterId ? (ccMap[r.costCenterId] ?? null) : null,
    urgency:        r.urgency,
    status:         r.status,
    itemCount:      cntMap[r.id] ?? 0,
    submittedAt:    r.submittedAt,
    createdAt:      r.createdAt,
  }))

  return (
    <>
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
    </>
  )
}
