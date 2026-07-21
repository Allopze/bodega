import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { resolvePagination } from "@/lib/pagination"
import {
  listEmergencyDrills,
  listEmergencyPlansPage,
  listEmergencyWorksites,
} from "@/lib/services/prevention-emergency"
import { EmergencyList } from "./emergency-list"

export const metadata: Metadata = { title: "Emergencias y simulacros" }

type SearchParams = { page?: string }

export default async function EmergenciasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("prevention:emergency:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canManage = session.user.permissions.includes("prevention:emergency:manage")
  const raw = await searchParams
  const pagination = resolvePagination({ pageParam: raw.page, totalItems: 0, pageSize: 50 })

  const [plansPage, drills, worksites] = await Promise.all([
    listEmergencyPlansPage(access, { limit: 50, offset: pagination.offset }),
    listEmergencyDrills(access),
    canManage ? listEmergencyWorksites(access) : Promise.resolve([]),
  ])

  const resolvedPagination = resolvePagination({ pageParam: raw.page, totalItems: plansPage.total, pageSize: 50 })

  return (
    <PageContainer>
      <PageHeader
        title="Emergencias y simulacros"
        description="Planes de emergencia por faena, escenarios, organigrama de respuesta, recursos, contactos y simulacros con resultado derivado a CAPA."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Emergencias" },
        ]} />}
      />
      <EmergencyList
        plans={plansPage.rows.map((row) => ({
          id: row.plan.id,
          code: row.plan.code,
          title: row.plan.title,
          status: row.plan.status,
          worksiteName: row.worksiteName,
          scenarios: row.scenarios,
          roles: row.roles,
          drills: row.drills,
        }))}
        drills={drills.map((row) => ({
          id: row.drill.id,
          planTitle: row.planTitle,
          worksiteName: row.worksiteName,
          scenarioType: row.drill.scenarioType,
          scheduledFor: row.drill.scheduledFor,
          status: row.drill.status,
          outcome: row.drill.outcome,
        }))}
        worksites={worksites}
        canManage={canManage}
        plansPagination={resolvedPagination}
      />
    </PageContainer>
  )
}
