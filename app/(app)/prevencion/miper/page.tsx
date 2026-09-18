import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { resolvePagination } from "@/lib/pagination"
import { getRiskDashboard } from "@/lib/services/prevention-risk-legal"
import { listRiskImportBatchesPage } from "@/lib/services/prevention-risk-import"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { todayInChile } from "@/lib/utils"
import { MiperHeaderActions, MiperWorkbench } from "./miper-workbench"
import { PdtpScheduledActivityPanelServer } from "@/components/prevention/pdtp-scheduled-activity-panel-server"

export const metadata: Metadata = { title: "MIPER y controles" }

type SearchParams = { page?: string }

export default async function MiperPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:view")) redirect("/forbidden")
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const raw = await searchParams
  const pageSize = 50
  const pagination = resolvePagination({ pageParam: raw.page, totalItems: 0, pageSize })
  const [dashboard, { rows: imports, total: importsTotal }] = await Promise.all([
    getRiskDashboard(access),
    listRiskImportBatchesPage(access, { limit: pageSize, offset: pagination.offset }),
  ])
  const importsPagination = resolvePagination({ pageParam: raw.page, totalItems: importsTotal, pageSize })
  // Se resuelve acá, en el servidor, y baja como prop: el workbench es cliente y
  // si calculara la fecha por su cuenta el HTML servido y el hidratado podrían
  // diferir. `todayInChile` además la fija a America/Santiago, así que tampoco
  // depende de la zona del navegador. Contrato cubierto por miper-ui-contract.
  const today = todayInChile()
  const permissions = {
    canEdit: can(session, "prevention:risk:edit"),
    canReview: can(session, "prevention:risk:review"),
    canApprove: can(session, "prevention:risk:approve"),
    canPublish: can(session, "prevention:risk:publish"),
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="MIPER y controles"
        description="Versiona peligros, riesgos y controles por proceso, tarea y puesto de trabajo."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "MIPER" }]} />}
        actions={<MiperHeaderActions worksites={dashboard.worksites} methodologies={dashboard.methodologies} matrices={dashboard.matrices} committeeMeetings={dashboard.committeeMeetings} canEdit={permissions.canEdit} />}
      />
      <MiperWorkbench
        dashboard={dashboard}
        imports={imports}
        importsTotal={importsTotal}
        importsPagination={importsPagination}
        currentUserId={session.user.id}
        permissions={permissions}
        today={today}
      />
      <PdtpScheduledActivityPanelServer connectorKey="miper" />
    </PageContainer>
  )
}
