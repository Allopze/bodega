import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listInspectionAssignees,
  listInspectionPrograms,
  listInspectionRuns,
  listInspectionTemplates,
  listInspectionWorksites,
} from "@/lib/services/prevention-inspections"
import { InspectionRunList } from "./inspection-run-list"

export const metadata: Metadata = { title: "Inspecciones y auditorías" }

export default async function InspeccionesPage() {
  let session
  try { session = await requirePermission("prevention:inspections:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canExecute = session.user.permissions.includes("prevention:inspections:execute")

  const [runs, programs, templates, worksites, assignees] = await Promise.all([
    listInspectionRuns(access),
    listInspectionPrograms(access),
    canExecute ? listInspectionTemplates(access) : Promise.resolve([]),
    canExecute ? listInspectionWorksites(access) : Promise.resolve([]),
    canExecute ? listInspectionAssignees(access) : Promise.resolve([]),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Inspecciones y auditorías"
        description="Motor transversal de inspecciones, observaciones y auditorías, con hallazgos derivados a CAPA y cierre independiente."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Inspecciones" },
        ]} />}
        actions={
          session.user.permissions.includes("prevention:inspections:export") ? (
            <Button asChild variant="secondary">
              <a href="/api/prevencion/inspecciones/export" download>Exportar Excel</a>
            </Button>
          ) : undefined
        }
      />
      <InspectionRunList
        runs={runs.map((row) => ({
          id: row.run.id,
          code: row.run.code,
          status: row.run.status,
          templateName: row.templateName,
          templateKind: row.templateKind,
          subjectLabel: row.run.subjectLabel,
          worksiteId: row.run.worksiteId,
          worksiteName: row.worksiteName,
          executedAt: row.run.executedAt,
          compliancePercent: row.run.compliancePercent,
          nonConformingCount: row.run.nonConformingCount,
          openFindings: row.openFindings,
          criticalFindings: row.criticalFindings,
        }))}
        overdueProgramCount={programs.filter((row) => row.program.isActive && row.program.nextDueOn < new Date().toISOString().slice(0, 10)).length}
        canExecute={canExecute}
        templates={templates.flatMap((item) => item.status === "approved"
          ? [{ id: item.id, name: item.name, versionLabel: item.versionLabel }]
          : [])}
        worksites={worksites}
        assignees={assignees}
      />
    </PageContainer>
  )
}
