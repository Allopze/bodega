import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { resolvePagination } from "@/lib/pagination"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getCapaDashboardCounts, listCapaActionsPage, listCapaWorksites } from "@/lib/services/prevention-capa"
import { CapaList } from "./capa-list"

export const metadata: Metadata = { title: "Acciones CAPA" }

type SearchParams = { page?: string; status?: string; source?: string; worksite?: string }

export default async function CapaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("prevention:capa:view") }
  catch { redirect("/forbidden") }
  const scope = resolveWorksiteScope(session)
  const access = { scope, permissions: session.user.permissions }
  const raw = await searchParams
  const pageSize = 50
  const pagination = resolvePagination({ pageParam: raw.page, totalItems: 0, pageSize })

  const status = raw.status && raw.status !== "all" ? raw.status : undefined
  const source = raw.source && raw.source !== "all" ? raw.source : undefined
  const worksite = raw.worksite && raw.worksite !== "all" ? raw.worksite : undefined

  const [{ rows: actions, total }, worksites, counts] = await Promise.all([
    listCapaActionsPage({ ...access, status, sourceType: source, worksiteId: worksite, limit: pageSize, offset: pagination.offset }),
    listCapaWorksites(access),
    getCapaDashboardCounts(access),
  ])

  const resolvedPagination = resolvePagination({ pageParam: raw.page, totalItems: total, pageSize })

  return (
    <PageContainer>
      <PageHeader
        title="Acciones CAPA"
        description="Fuente común de acciones correctivas y preventivas, evidencia, eficacia y cierre."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Acciones CAPA" },
        ]} />}
        actions={
          <Button asChild variant="secondary">
            <Link href="/api/prevencion/capa/export">Exportar XLSX</Link>
          </Button>
        }
      />
      <CapaList actions={actions} worksites={worksites} counts={counts} pagination={resolvedPagination} />
    </PageContainer>
  )
}
