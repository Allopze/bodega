import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { requireAuth, can } from "@/lib/auth/can"
import { countReports, listReports } from "@/lib/services/feedback"
import { canAccessFeedbackIndex, canViewAllFeedback } from "@/lib/services/feedback-access"
import { parseFeedbackListParams } from "@/lib/services/feedback-list-query"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { DEFAULT_PAGE_SIZE } from "@/lib/constants"
import { ReportList } from "./report-list"
import { FeedbackFilters } from "./feedback-filters"

export const metadata: Metadata = { title: "Soporte" }

export default async function SoportePage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
} = {}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!canAccessFeedbackIndex(session)) {
    redirect("/forbidden")
  }

  const canViewAll = canViewAllFeedback(session)
  const canCreate  = can(session, "feedback:create")
  const sp = await searchParams
  const query = parseFeedbackListParams(sp)
  const filters = { mode: canViewAll ? "all" as const : "own" as const, userId: session.user.id, ...query }
  const total = await countReports(filters)
  const pagination = resolvePagination({ pageParam: sp.page, totalItems: total, pageSize: DEFAULT_PAGE_SIZE })

  const reports = await listReports(
    filters,
    pagination.limit,
    pagination.offset,
  )

  return (
    <PageContainer>
      <PageHeader
        title="Soporte"
        description={canViewAll
          ? "Bandeja de atención de tickets: prioriza los que vencen o ya están fuera de SLA."
          : "Reporta bugs, consultas o sugerencias para mejorar la plataforma."}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Soporte" },
          ]} />
        }
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/soporte/nuevo">Nuevo reporte</Link>
            </Button>
          ) : undefined
        }
      />
      <FeedbackFilters current={query} />
      <ReportList reports={reports} canCreate={canCreate} canViewAll={canViewAll} />
      <ServerPagination
        pagination={pagination}
        hrefForPage={(page) => buildPaginationHref("/soporte", sp, page)}
      />
    </PageContainer>
  )
}
