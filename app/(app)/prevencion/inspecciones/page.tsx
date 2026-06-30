import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { listInspectionTemplates } from "@/lib/services/prevention-inspections"
import { listInspectionRuns, listBehavioralObservations } from "@/lib/services/prevention-inspections"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { InspectionList } from "./inspection-list"

export const metadata: Metadata = { title: "Inspecciones y observaciones" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function InspeccionesPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:inspections:view")) redirect("/forbidden")

  const scope = scopeToIds(resolveWorksiteScope(session))
  const [templates, runs, observations] = await Promise.all([
    listInspectionTemplates(),
    listInspectionRuns(scope),
    listBehavioralObservations(scope),
  ])

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Inspecciones" }]} />
      <PageHeader
        title="Inspecciones"
        description="Inspecciones planificadas y observaciones conductuales"
        actions={<PreventionExportButton href="/api/prevencion/inspecciones/export" label="Exportar inspecciones" />}
      />
      <InspectionList templates={templates} runs={runs} observations={observations} canManage={can(session, "prevention:inspections:manage")} />
    </PageContainer>
  )
}
