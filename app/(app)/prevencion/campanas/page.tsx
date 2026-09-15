import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { preventionCampaigns, worksites } from "@/db/schema"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { PageContainer } from "@/components/ui/page-container"
import { CampanasClient, type CampaignRow } from "./campanas-client"
import { listCatalogActivities } from "@/lib/services/pdtp/catalog-activities"
import { listPdtpAccreditationBindings } from "@/lib/services/pdtp/accreditation-bindings"

export const metadata: Metadata = {
  title: "Campañas Preventivas | SGSST",
  description: "Registro de difusión y campañas preventivas de seguridad (R9)",
}

export default async function CampanasPage() {
  const session = await requireAuth()
  if (!can(session, "prevention:campaign:view")) {
    redirect("/prevencion")
  }

  const scope = resolveWorksiteScope(session)

  // Consultar faenas permitidas
  const worksiteCondition =
    scope.mode === "all"
      ? eq(worksites.isActive, true)
      : scope.mode === "some" && scope.ids.length > 0
        ? and(eq(worksites.isActive, true), inArray(worksites.id, scope.ids))
        : sql`false`

  const worksiteRows = await db
    .select({ id: worksites.id, name: worksites.name, code: worksites.code })
    .from(worksites)
    .where(worksiteCondition)
    .orderBy(asc(worksites.name))

  const worksiteIds = worksiteRows.map((w) => w.id)

  // Consultar campañas en el scope
  let campaignRows: CampaignRow[] = []
  if (worksiteIds.length > 0) {
    const rawCampaigns = await db
      .select({
        campaign: preventionCampaigns,
        worksiteName: worksites.name,
      })
      .from(preventionCampaigns)
      .leftJoin(worksites, eq(preventionCampaigns.worksiteId, worksites.id))
      .where(inArray(preventionCampaigns.worksiteId, worksiteIds))
      .orderBy(desc(preventionCampaigns.createdAt))

    campaignRows = rawCampaigns.map((row) => ({
      ...row.campaign,
      worksiteName: row.worksiteName ?? "Faena no encontrada",
    }))
  }

  const canManage = can(session, "prevention:campaign:manage")
  const [catalogActivities, bindings] = await Promise.all([
    listCatalogActivities(),
    listPdtpAccreditationBindings({ sourceType: "campana", sourceIds: campaignRows.map((campaign) => campaign.id) }),
  ])

  return (
    <PageContainer width="wide">
      <CampanasClient
        initialCampaigns={campaignRows}
        worksites={worksiteRows}
        canManage={canManage}
        catalogActivities={catalogActivities.map((activity) => ({
          id: activity.id, code: activity.code, title: activity.title, description: activity.description,
          status: activity.status as "draft" | "active" | "retired",
        }))}
        catalogBindings={Object.fromEntries(campaignRows.map((campaign) => [campaign.id, bindings.filter((binding) => binding.sourceId === campaign.id && binding.eventType === "close" && binding.isActive).map((binding) => binding.catalogActivityId)]))}
      />
    </PageContainer>
  )
}
