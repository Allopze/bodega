import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listIperMatrices } from "@/lib/services/prevention-iper"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { IperList } from "./iper-list"

export const metadata: Metadata = { title: "Matriz IPER/MIPER" }

export default async function IperPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:iper:view")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []

  const [matrices, worksites] = await Promise.all([
    listIperMatrices(worksiteIds),
    listScopedWorksites(worksiteIds),
  ])

  const canManage = can(session, "prevention:iper:manage")

  return (
    <PageContainer>
      <PageHeader
        title="Matriz IPER/MIPER"
        description="Identificación de peligros y evaluación de riesgos por faena, proceso y tarea."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "IPER/MIPER" },
          ]} />
        }
        actions={
          canManage ? <PreventionExportButton href="/api/prevencion/iper/export" label="Exportar IPER" /> : undefined
        }
      />
      <IperList matrices={matrices} worksites={worksites} canManage={canManage} />
    </PageContainer>
  )
}