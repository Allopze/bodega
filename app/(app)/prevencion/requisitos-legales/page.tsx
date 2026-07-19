import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getLegalDashboard } from "@/lib/services/prevention-risk-legal"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { LegalRequirementsHeaderActions, LegalRequirementsWorkbench } from "./legal-requirements-workbench"

export const metadata: Metadata = { title: "Requisitos legales" }

export default async function LegalRequirementsPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:legal:view")) redirect("/forbidden")
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const dashboard = await getLegalDashboard(access)
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Requisitos legales"
        description="Control de vigencia, aplicabilidad, evidencia y cumplimiento por faena."
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "Requisitos legales" }]} />}
        actions={<LegalRequirementsHeaderActions canAssess={can(session, "prevention:legal:assess")} canExport={can(session, "prevention:legal:export")} />}
      />
      <LegalRequirementsWorkbench
        dashboard={dashboard}
        worksites={dashboard.worksites}
        processes={dashboard.processes}
        canAssess={can(session, "prevention:legal:assess")}
        canApprove={can(session, "prevention:legal:approve_applicability")}
        canExport={can(session, "prevention:legal:export")}
      />
    </PageContainer>
  )
}
