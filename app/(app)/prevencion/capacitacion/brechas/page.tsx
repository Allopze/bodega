import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listCompetencyGaps } from "@/lib/services/prevention-training"
import { CompetencyGapList } from "./competency-gap-list"

export const metadata: Metadata = { title: "Brechas de competencia" }

export default async function BrechasPage() {
  let session
  try { session = await requirePermission("prevention:training:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const gaps = await listCompetencyGaps(access)

  return (
    <PageContainer>
      <PageHeader
        title="Brechas de competencia"
        description="Personas exigidas por un requisito vigente que hoy no tienen la habilitación al día."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Capacitación", href: "/prevencion/capacitacion" },
          { label: "Brechas" },
        ]} />}
      />
      <CompetencyGapList
        gaps={gaps}
        canEscalate={session.user.permissions.includes("prevention:training:manage")}
      />
    </PageContainer>
  )
}
