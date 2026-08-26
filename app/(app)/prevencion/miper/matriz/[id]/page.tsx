import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listRiskEntriesPage } from "@/lib/services/prevention-risk-legal"
import { listWorksiteAssignableUsers } from "@/lib/services/prevention-capa"
import { isRiskQuickFilter } from "@/lib/prevention/risk-list-filters"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { resolvePagination } from "@/lib/pagination"
import { MatrixTable } from "./matrix-table"

type SearchParams = {
  page?: string
  classification?: string
  riskFactor?: string
  routine?: string
  responsibleUserId?: string
  controlStatus?: string
  quick?: string
  q?: string
}

export default async function RiskMatrixTablePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/miper")}`) }
  if (!can(session, "prevention:risk:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/miper")}`)
  const { id } = await params
  const raw = await searchParams
  const access = { scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const pageSize = 50
  const pagination = resolvePagination({ pageParam: raw.page, totalItems: 0, pageSize })
  const filters = {
    classification: raw.classification || undefined,
    riskFactor: raw.riskFactor || undefined,
    routine: (raw.routine === "routine" || raw.routine === "non_routine" ? raw.routine : undefined) as "routine" | "non_routine" | undefined,
    responsibleUserId: raw.responsibleUserId || undefined,
    controlStatus: raw.controlStatus || undefined,
    quickFilter: isRiskQuickFilter(raw.quick) ? raw.quick : undefined,
    search: raw.q?.trim() || undefined,
  }
  let page
  try { page = await listRiskEntriesPage({ matrixId: id, ...access, filters, limit: pageSize, offset: pagination.offset }) }
  catch { notFound() }
  const fullPagination = resolvePagination({ pageParam: raw.page, totalItems: page.total, pageSize })
  const assignableUsers = await listWorksiteAssignableUsers({ worksiteId: page.matrix.worksiteId, scope: access.scope })

  return (
    <PageContainer width="full">
      <PageHeader
        title="Vista matriz"
        description={`${page.total} riesgo(s) · Estado de la matriz: ${page.matrix.status}`}
        breadcrumb={<Breadcrumbs items={[{ label: "MIPER", href: "/prevencion/miper" }, { label: "Vista matriz" }]} />}
        actions={<Button variant="secondary" asChild><Link href={`/prevencion/miper/matriz/${id}/comparar`}>Comparar revisiones</Link></Button>}
      />
      <MatrixTable
        matrixStatus={page.matrix.status}
        rows={page.rows}
        total={page.total}
        pagination={fullPagination}
        assignableUsers={assignableUsers}
        canEdit={can(session, "prevention:risk:edit")}
        canGenerateCapa={can(session, "prevention:capa:manage") && can(session, "prevention:risk:edit")}
      />
    </PageContainer>
  )
}
