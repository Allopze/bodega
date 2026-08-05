import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listImportableDefinitions,
  listInspectionAssignees,
  listInspectionPrograms,
  listInspectionTemplates,
  listInspectionWorksites,
} from "@/lib/services/prevention-inspections"
import { InspectionCatalog } from "./inspection-catalog"

export const metadata: Metadata = { title: "Catálogo de inspecciones" }

export default async function CatalogoInspeccionesPage() {
  let session
  try { session = await requirePermission("prevention:inspections:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canManage = session.user.permissions.includes("prevention:inspections:manage")

  const [templates, programs, worksites, assignees] = await Promise.all([
    listInspectionTemplates(access),
    listInspectionPrograms(access),
    canManage ? listInspectionWorksites(access) : Promise.resolve([]),
    canManage ? listInspectionAssignees(access) : Promise.resolve([]),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo de inspecciones"
        description="Plantillas versionadas del catálogo SST y programación por faena y frecuencia."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Inspecciones", href: "/prevencion/inspecciones" },
          { label: "Catálogo" },
        ]} />}
      />
      <InspectionCatalog
        templates={templates.map((row) => ({
          id: row.id,
          code: row.code,
          versionLabel: row.versionLabel,
          name: row.name,
          kind: row.kind,
          status: row.status,
          authorUserId: row.authorUserId,
          version: row.version,
          coverage: row.coverage,
          pdtpActivityNumbers: row.pdtpActivityNumbers,
        }))}
        programs={programs.map((row) => ({
          id: row.program.id,
          templateName: row.templateName,
          worksiteName: row.worksiteName,
          frequency: row.program.frequency,
          nextDueOn: row.program.nextDueOn,
          assigneeName: row.assigneeName,
          isActive: row.program.isActive,
        }))}
        importable={canManage ? listImportableDefinitions() : []}
        approvedTemplates={templates.filter((item) => item.status === "approved").map((item) => ({ id: item.id, name: item.name, versionLabel: item.versionLabel }))}
        worksites={worksites}
        assignees={assignees}
        currentUserId={session.user.id}
        canManage={canManage}
        canApprove={session.user.permissions.includes("prevention:inspections:approve")}
      />
    </PageContainer>
  )
}
