import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getInspectionRun } from "@/lib/services/prevention-inspections"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { InspectionDetail } from "./inspection-detail"

export const metadata: Metadata = { title: "Inspección" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function InspectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:inspections:view")) redirect("/forbidden")

  const { id } = await params
  const data = await getInspectionRun(id, scopeToIds(resolveWorksiteScope(session)))
  if (!data) notFound()

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Inspecciones", href: "/prevencion/inspecciones" }, { label: data.run.id }]} />
      <PageHeader title={`Inspección ${data.run.id}`} description={`Faena: ${data.run.worksiteId} · Estado: ${data.run.status}`} />
      <InspectionDetail
        data={data}
        canManage={can(session, "prevention:inspections:manage")}
        canClose={can(session, "prevention:inspections:close")}
      />
    </PageContainer>
  )
}
