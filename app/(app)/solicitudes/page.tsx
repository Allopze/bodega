import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems, worksites, users } from "@/db/schema"
import { desc, count, inArray, eq, and, or, ilike, sql } from "drizzle-orm"
import { requireAuth, can, canAccessWorksite, isGlobalRole } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { parseListParams, periodSql, statusSql, worksiteEqSql } from "@/lib/adquisiciones/list-query"
import { RequestList } from "./request-list"
import { SolicitudesActions } from "./solicitudes-actions"

export const metadata: Metadata = { title: "Solicitudes de compra" }

import { SOLICITUDES_PAGE_SIZE } from "@/lib/constants"

export default async function SolicitudesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "requests:view_own") && !can(session, "requests:view_all")) {
    redirect("/forbidden")
  }

  const sp = await searchParams
  const viewAll = can(session, "requests:view_all")

  // Build worksite filter — solicitantes see only their worksites.
  // Global roles without view_all (p. ej. jefe_mantencion) no tienen faenas
  // asignadas: se filtran solo por requesterId, nunca por worksite (si no, la
  // lista sale vacía). Los roles scoped sí se acotan a sus faenas asignadas.
  const userWorksiteIds = session.user.worksiteIds ?? []

  const filterConditions = viewAll
    ? undefined
    : isGlobalRole(session)
      ? eq(purchaseRequests.requesterId, session.user.id)
      : and(
          eq(purchaseRequests.requesterId, session.user.id),
          userWorksiteIds.length > 0
            ? inArray(purchaseRequests.worksiteId, userWorksiteIds)
            : sql`false`
        )

  // URL-synced search & filters (server-side, so search finds records on any page)
  const listParams = parseListParams(sp)

  // Extended text search: match the request code OR any item's product name
  // (free-text or catalogue). Uses EXISTS to avoid row duplication without JOIN.
  function escapeLikeLocal(v: string) { return v.replace(/[\\%_]/g, (c) => `\\${c}`) }
  const q = listParams.q.trim()
  const likePattern = q ? `%${escapeLikeLocal(q)}%` : null
  const textCondition = likePattern
    ? or(
        ilike(purchaseRequests.code, likePattern),
        sql`EXISTS (
          SELECT 1 FROM purchase_request_items pri
          LEFT JOIN products p ON p.id = pri.product_id
          WHERE pri.request_id = ${purchaseRequests.id}
            AND (
              pri.product_name_free ILIKE ${likePattern}
              OR p.name ILIKE ${likePattern}
            )
        )`,
      )
    : undefined

  const where = and(
    filterConditions,
    textCondition,
    statusSql(purchaseRequests.status, listParams.estados),
    worksiteEqSql(purchaseRequests.worksiteId, listParams.faena),
    periodSql(purchaseRequests.createdAt, listParams.desde, listParams.hasta),
  )

  // Count total matching requests and overall summary metrics.
  // Only draft + critical are tracked: they are the actionable signals
  // (finish/submit a draft; pay attention to critical urgency). Other states
  // (submitted, approved, total) are visible in the table itself and in the
  // pagination, so they don't need a TopBar chip — that would just duplicate
  // the estado filter (screen-density rule A5).
  const [totalRow, metricsRow] = await Promise.all([
    db
      .select({ total: count() })
      .from(purchaseRequests)
      .where(where)
      .then((res) => res[0]),

    db
      .select({
        draft: count(sql`CASE WHEN ${purchaseRequests.status} = 'draft' THEN 1 END`),
        critical: count(sql`CASE WHEN ${purchaseRequests.urgency} = 'critical' THEN 1 END`),
      })
      .from(purchaseRequests)
      .where(filterConditions)
      .then((res) => res[0]),
  ])

  const headerSignals: HeaderSignal[] = [
    { key: "draft",    label: "Borradores",      value: metricsRow?.draft ?? 0,    href: "/solicitudes?estado=draft" },
    { key: "critical", label: "Urgencia crítica", value: metricsRow?.critical ?? 0, href: "/solicitudes?urgencia=critical", tone: "signal" },
  ]

  const exportParams = new URLSearchParams({ tipo: "solicitudes" })
  if (listParams.q) exportParams.set("q", listParams.q)
  // `estados` es un arreglo: siempre truthy, así que el href llevaba `status=`
  // vacío incluso sin filtro de estado.
  if (listParams.estados.length > 0) exportParams.set("status", listParams.estados.join(","))
  if (listParams.faena) exportParams.set("faena", listParams.faena)
  const exportHref = `/api/reportes/export?${exportParams.toString()}`

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
      .where(where)
      .orderBy(desc(purchaseRequests.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),

    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(eq(worksites.isActive, true))
  ])

  // Filter worksites scoped to the user
  const scopedWorksites = activeWorksites.filter(
    (w) => canAccessWorksite(session, w.id),
  )
  const hasWorksites = scopedWorksites.length > 0
  const worksiteOptions = scopedWorksites.map((w) => ({ value: w.id, label: w.name }))

  const pageHref = (page: number) => buildPaginationHref("/solicitudes", sp, page)

  if (pageRequests.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          newShortcutHref="/solicitudes/nueva"
          title="Solicitudes de compra"
          description="Historial de solicitudes de compra por faena."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Inicio", href: "/dashboard" },
              { label: "Solicitudes" },
            ]} />
          }
          headerActions={<HeaderSignals signals={headerSignals} />}
          actions={<SolicitudesActions canCreate={can(session, "requests:create")} hasWorksites={hasWorksites} exportHref={exportHref} />}
        />
        <RequestList requests={[]} currentUserId={session.user.id} canDeleteAny={can(session, "requests:delete")} worksiteOptions={worksiteOptions} />
        <ServerPagination pagination={pagination} hrefForPage={pageHref} />
      </PageContainer>
    )
  }

  const requestIds = pageRequests.map((r) => r.id)
  const wsIds      = [...new Set(pageRequests.map((r) => r.worksiteId))]
  const requesterIds = [...new Set(pageRequests.map((r) => r.requesterId))]

  // Batch load related data — only for the current page
  const [wsRows, requesterRows, itemCounts] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(inArray(worksites.id, wsIds)),

    db.select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, requesterIds)),

    db.select({ requestId: purchaseRequestItems.requestId, total: count() })
      .from(purchaseRequestItems)
      .where(inArray(purchaseRequestItems.requestId, requestIds))
      .groupBy(purchaseRequestItems.requestId),
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const userMap = Object.fromEntries(requesterRows.map((u) => [u.id, u.name ?? u.email ?? u.id]))
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
    requesterId:    r.requesterId,
    requesterName:  userMap[r.requesterId] ?? r.requesterId,
  }))

  const canDeleteAny = can(session, "requests:delete")

  return (
    <PageContainer>
      <PageHeader
        title="Solicitudes de compra"
        description="Historial de solicitudes de compra por faena."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Solicitudes" },
          ]} />
        }
        headerActions={<HeaderSignals signals={headerSignals} />}
        actions={<SolicitudesActions canCreate={can(session, "requests:create")} hasWorksites={hasWorksites} exportHref={exportHref} />}
      />
      <RequestList
        requests={rows}
        currentUserId={session.user.id}
        canDeleteAny={canDeleteAny}
        worksiteOptions={worksiteOptions}
      />
      <ServerPagination pagination={pagination} hrefForPage={pageHref} />
    </PageContainer>
  )
}
