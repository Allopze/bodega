import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getRiskDashboard } from "@/lib/services/prevention-risk-legal"
import { listRiskImportBatches } from "@/lib/services/prevention-risk-import"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { MiperHeaderActions, MiperWorkbench } from "./miper-workbench"

export const metadata: Metadata = { title: "MIPER y controles" }

export default async function MiperPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:view")) redirect("/forbidden")
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const [dashboard, imports] = await Promise.all([getRiskDashboard(access), listRiskImportBatches(access)])
  return (
    <PageContainer width="wide">
      <PageHeader
        title="MIPER y controles"
        description="Versiona peligros, riesgos y controles por proceso, tarea y puesto de trabajo."
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "MIPER" }]} />}
        actions={<MiperHeaderActions worksites={dashboard.worksites} methodologies={dashboard.methodologies} canEdit={can(session, "prevention:risk:edit")} />}
      />
      <MiperWorkbench
        dashboard={dashboard}
        imports={imports}
        currentUserId={session.user.id}
        canEdit={can(session, "prevention:risk:edit")}
        canReview={can(session, "prevention:risk:review")}
        canApprove={can(session, "prevention:risk:approve")}
        canPublish={can(session, "prevention:risk:publish")}
      />
    </PageContainer>
  )
}
