import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { preventionCampaignAttendance, preventionCampaigns, workers, worksites } from "@/db/schema"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { PageContainer } from "@/components/ui/page-container"
import { CampanasClient, type CampaignWithStats } from "./campanas-client"

export const metadata: Metadata = {
  title: "Campañas Preventivas | SGSST",
  description: "Registro de difusión y campañas preventivas de seguridad (R9)",
}

export default async function CampanasPage() {
  const session = await requireAuth()
  if (!can(session, "prevention:pdtp:view")) {
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
  let campaignRows: CampaignWithStats[] = []
  if (worksiteIds.length > 0) {
    const rawCampaigns = await db
      .select({
        campaign: preventionCampaigns,
        worksiteName: worksites.name,
        attendanceCount: sql<number>`count(${preventionCampaignAttendance.id})::int`,
      })
      .from(preventionCampaigns)
      .leftJoin(worksites, eq(preventionCampaigns.worksiteId, worksites.id))
      .leftJoin(
        preventionCampaignAttendance,
        eq(preventionCampaigns.id, preventionCampaignAttendance.campaignId),
      )
      .where(inArray(preventionCampaigns.worksiteId, worksiteIds))
      .groupBy(preventionCampaigns.id, worksites.name)
      .orderBy(desc(preventionCampaigns.createdAt))

    campaignRows = rawCampaigns.map((row) => ({
      ...row.campaign,
      worksiteName: row.worksiteName ?? "Faena no encontrada",
      attendanceCount: row.attendanceCount,
    }))
  }

  const rawWorkers =
    worksiteIds.length > 0
      ? await db
          .select({
            id: workers.id,
            firstName: workers.firstName,
            lastName: workers.lastName,
            rut: workers.rut,
            worksiteId: workers.worksiteId,
          })
          .from(workers)
          .where(and(inArray(workers.worksiteId, worksiteIds), eq(workers.isActive, true)))
          .orderBy(asc(workers.firstName), asc(workers.lastName))
      : []

  const workerRows = rawWorkers.map((w) => ({
    id: w.id,
    name: `${w.firstName} ${w.lastName}`.trim(),
    rut: w.rut ?? "Sin RUT",
    worksiteId: w.worksiteId,
  }))

  const canManage = can(session, "prevention:pdtp:program:manage")

  return (
    <PageContainer width="wide">
      <CampanasClient
        initialCampaigns={campaignRows}
        worksites={worksiteRows}
        workers={workerRows}
        canManage={canManage}
      />
    </PageContainer>
  )
}
