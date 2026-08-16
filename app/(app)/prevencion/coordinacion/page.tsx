import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listEngagementResponsibles,
  listEngagementWorksites,
  listExternalEngagements,
} from "@/lib/services/prevention-external-engagements"
import { EngagementsWorkbench } from "./engagements-workbench"

export const metadata: Metadata = { title: "Visitas y coordinación" }

/**
 * DS 44 art. 20 — coordinación con quien comparte el centro de trabajo — más
 * fiscalizaciones (DT/SEREMI) y visitas del organismo administrador, cuyas
 * medidas prescritas son obligatorias por el art. 70.
 */
export default async function CoordinacionPage() {
  let session
  try { session = await requirePermission("prevention:engagement:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canManage = can(session, "prevention:engagement:manage")

  const [engagements, worksites, responsibles] = await Promise.all([
    listExternalEngagements(access),
    canManage ? listEngagementWorksites(access) : Promise.resolve([]),
    canManage ? listEngagementResponsibles(access) : Promise.resolve([]),
  ])

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Visitas y coordinación"
        description="Coordinación preventiva con el mandante y otras empresas de la faena, fiscalizaciones y visitas del organismo administrador, con sus medidas prescritas en seguimiento."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención", href: "/prevencion" },
          { label: "Visitas y coordinación" },
        ]} />}
      />
      <EngagementsWorkbench
        engagements={engagements.map((row) => ({
          id: row.engagement.id,
          code: row.engagement.code,
          kind: row.engagement.kind,
          direction: row.engagement.direction,
          counterpartyType: row.engagement.counterpartyType,
          counterpartyName: row.engagement.counterpartyName,
          occurredOn: row.engagement.occurredOn,
          subject: row.engagement.subject,
          officialReference: row.engagement.officialReference,
          infoTypes: row.engagement.infoTypes,
          closedAt: row.engagement.closedAt,
          version: row.engagement.version,
          worksiteId: row.engagement.worksiteId,
          worksiteName: row.worksiteName,
          openMeasures: row.openMeasures,
          totalMeasures: row.totalMeasures,
        }))}
        worksites={worksites}
        responsibles={responsibles}
        canManage={canManage}
      />
    </PageContainer>
  )
}
