import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listEppCoverageGaps,
  listEppProductFamiliesForRequirement,
  listEppRequirements,
  listEppTypesForRequirement,
  listRequirementWorksites,
} from "@/lib/services/prevention-epp"
import { EppTabs } from "./epp-tabs"

import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "EPP preventivo" }

export default async function EppPreventivoPage() {
  let session
  try { session = await requirePermission("prevention:epp:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canManage = session.user.permissions.includes("prevention:epp:manage")

  const [gaps, requirements, eppTypes, families, worksites] = await Promise.all([
    listEppCoverageGaps(access),
    listEppRequirements(access),
    listEppTypesForRequirement(access),
    listEppProductFamiliesForRequirement(access),
    canManage ? listRequirementWorksites(access) : Promise.resolve([]),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="EPP preventivo"
        description="Requisitos de EPP obligatorio por cargo o faena, comparados contra las entregas reales de Bodega para detectar cobertura faltante o vencida."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "EPP preventivo" },
        ]} />}
        actions={
          <Button asChild variant="secondary" size="sm">
            <a href="/api/prevencion/epp/export" download>
              Exportar cobertura Excel
            </a>
          </Button>
        }
      />
      <EppTabs
        gaps={gaps}
        requirements={requirements.map((row) => ({
          id: row.requirement.id,
          eppTypeLabel: row.eppTypeLabel,
          scopeType: row.requirement.scopeType,
          scopeValue: row.requirement.scopeValue,
          worksiteName: row.worksiteName,
          enforcement: row.requirement.enforcement,
          reason: row.requirement.reason,
          isActive: row.requirement.isActive,
        }))}
        eppTypes={eppTypes}
        families={families}
        worksites={worksites}
        canManage={canManage}
      />
    </PageContainer>
  )
}
