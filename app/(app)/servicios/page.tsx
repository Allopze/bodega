import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems, worksites } from "@/db/schema"
import { desc, count, inArray, eq, and, sql } from "drizzle-orm"
import { can, requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { ClipboardText, Clock, Warning } from "@phosphor-icons/react/dist/ssr"
import { ServiceList } from "./request-list"

export const metadata: Metadata = { title: "Solicitudes de servicios" }

export default async function ServiciosPage() {
  let session
  try { session = await requirePermission("servicios:view_own") }
  catch { redirect("/dashboard") }

  const viewAll = can(session, "servicios:view_all")
  const userWorksiteIds = session.user.worksiteIds ?? []

  const filterConditions = and(
    eq(purchaseRequests.requestType, "servicios"),
    viewAll
      ? undefined
      : and(
          eq(purchaseRequests.requesterId, session.user.id),
          userWorksiteIds.length > 0
            ? inArray(purchaseRequests.worksiteId, userWorksiteIds)
            : sql`1 = 0`
        ),
  )

  const [allRequests, activeWorksites] = await Promise.all([
    db.select({
      id:          purchaseRequests.id,
      code:        purchaseRequests.code,
      worksiteId:  purchaseRequests.worksiteId,
      urgency:     purchaseRequests.urgency,
      status:      purchaseRequests.status,
      submittedAt: purchaseRequests.submittedAt,
      createdAt:   purchaseRequests.createdAt,
    })
    .from(purchaseRequests)
    .where(filterConditions)
    .orderBy(desc(purchaseRequests.createdAt)),

    db.select({ id: worksites.id })
      .from(worksites)
      .where(eq(worksites.isActive, true)),
  ])

  const scopedWorksites = activeWorksites.filter((w) => canAccessWorksite(session, w.id))
  const hasWorksites = scopedWorksites.length > 0

  const requestIds = allRequests.map((r) => r.id)
  const wsIds      = [...new Set(allRequests.map((r) => r.worksiteId))]

  const [wsRows, itemCounts] = requestIds.length > 0
    ? await Promise.all([
        db.select({ id: worksites.id, name: worksites.name })
          .from(worksites)
          .where(inArray(worksites.id, wsIds)),

        db.select({ requestId: purchaseRequestItems.requestId, total: count() })
          .from(purchaseRequestItems)
          .where(inArray(purchaseRequestItems.requestId, requestIds))
          .groupBy(purchaseRequestItems.requestId),
      ])
    : [
        [] as { id: string; name: string }[],
        [] as { requestId: string; total: number }[],
      ]

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const cntMap = Object.fromEntries(itemCounts.map((c) => [c.requestId, c.total]))

  const rows = allRequests.map((r) => ({
    id:           r.id,
    code:         r.code,
    worksiteName: wsMap[r.worksiteId] ?? r.worksiteId,
    urgency:      r.urgency,
    status:       r.status,
    itemCount:    cntMap[r.id] ?? 0,
    submittedAt:  r.submittedAt,
    createdAt:    r.createdAt,
  }))

  const pendingReview = rows.filter((r) => ["submitted", "in_review", "partially_approved"].includes(r.status)).length
  const criticalCount = rows.filter((r) => r.urgency === "critical").length
  const summaryStats: SummaryStat[] = [
    { key: "total",    label: "Solicitudes",      value: rows.length,                                     icon: <ClipboardText size={13} /> },
    { key: "review",   label: "Por revisar",      value: pendingReview,                                   icon: <Clock size={13} /> },
    { key: "high",     label: "Urgencia alta",    value: rows.filter((r) => r.urgency === "high").length, icon: <Warning size={13} /> },
    { key: "critical", label: "Urgencia crítica", value: criticalCount,                                   icon: <Warning size={13} weight="fill" />, tone: "signal" },
  ]
  const headerSignals: HeaderSignal[] = [
    { key: "critical", label: "Críticas",    value: criticalCount, tone: "signal" },
    { key: "review",   label: "Por revisar", value: pendingReview },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Solicitudes de servicios"
        description="Solicitudes de servicios externos con cotizaciones de proveedores."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Servicios" },
          ]} />
        }
        headerActions={<HeaderSignals signals={headerSignals} />}
      />
      {rows.length > 0 && <SummaryBar className="mb-4" stats={summaryStats} />}
      <ServiceList
        requests={rows}
        canCreate={can(session, "servicios:create")}
        hasWorksites={hasWorksites}
      />
    </PageContainer>
  )
}
