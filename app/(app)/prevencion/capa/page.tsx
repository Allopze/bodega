import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getCapaDashboardCounts, listCapaActions, listCapaWorksites } from "@/lib/services/prevention-capa"
import { CapaList } from "./capa-list"

export const metadata: Metadata = { title: "Acciones CAPA" }

export default async function CapaPage() {
  let session
  try { session = await requirePermission("prevention:capa:view") }
  catch { redirect("/forbidden") }
  const scope = resolveWorksiteScope(session)
  const access = { scope, permissions: session.user.permissions }
  const [actions, worksites, counts] = await Promise.all([
    listCapaActions(access),
    listCapaWorksites(access),
    getCapaDashboardCounts(access),
  ])

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
      <CapaList actions={actions} worksites={worksites} counts={counts} />
    </PageContainer>
  )
}
