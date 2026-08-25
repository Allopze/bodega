import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listInspectionAssignees,
  listInspectionPrograms,
  listInspectionTemplates,
  listInspectionWorksites,
  listRiskEntriesForWorksite,
} from "@/lib/services/prevention-inspections"
import { InspectionProgramsPanel, ProgramDialog } from "../inspection-catalog"

export const metadata: Metadata = { title: "Programación de inspecciones" }

/** Cuándo se pregunta: el calendario del que nacen las inspecciones planificadas. */
export default async function ProgramacionInspeccionPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("prevention:inspections:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canManage = session.user.permissions.includes("prevention:inspections:manage")
  const rawView = (await searchParams).vista
  const initialView = (Array.isArray(rawView) ? rawView[0] : rawView) === "vencidas" ? "overdue" as const : "all" as const

  const [programs, templates, worksites, assignees] = await Promise.all([
    listInspectionPrograms(access),
    listInspectionTemplates(access),
    canManage ? listInspectionWorksites(access) : Promise.resolve([]),
    canManage ? listInspectionAssignees(access) : Promise.resolve([]),
  ])

  // A-09: el diálogo pedía escribir el ID del peligro MIPER a mano. Se precarga
  // por faena porque el picker debe cambiar al cambiar la faena seleccionada, y
  // son pocas faenas por usuario.
  const riskEntriesByWorksite: Record<string, { id: string; hazardCode: string; hazard: string }[]> = {}
  if (canManage) {
    const entries = await Promise.all(
      worksites.map(async (worksite) => [worksite.id, await listRiskEntriesForWorksite(worksite.id, access)] as const),
    )
    for (const [worksiteId, rows] of entries) riskEntriesByWorksite[worksiteId] = rows
  }

  const approvedTemplates = templates
    .filter((item) => item.status === "approved")
    .map((item) => ({ id: item.id, name: item.name, versionLabel: item.versionLabel }))

  return (
    <PageContainer>
      <PageHeader
        title="Programación de inspecciones"
        description="Qué instrumento se ejecuta, en qué faena y con qué frecuencia. El barrido diario crea las inspecciones vencidas; «Ejecutar ahora» usa el mismo camino."
        actions={canManage && approvedTemplates.length > 0 && worksites.length > 0
          ? <ProgramDialog templates={approvedTemplates} worksites={worksites} assignees={assignees} riskEntriesByWorksite={riskEntriesByWorksite} />
          : undefined}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Inspecciones", href: "/prevencion/inspecciones" },
          { label: "Programación" },
        ]} />}
      />
      <InspectionProgramsPanel
        programs={programs.map((row) => ({
          id: row.program.id,
          templateId: row.program.templateId,
          worksiteId: row.program.worksiteId,
          templateName: row.templateName,
          worksiteName: row.worksiteName,
          frequency: row.program.frequency,
          intervalDays: row.program.intervalDays,
          nextDueOn: row.program.nextDueOn,
          assignedToUserId: row.program.assignedToUserId,
          assigneeName: row.assigneeName,
          riskEntryId: row.program.riskEntryId,
          riskLabel: row.riskHazard
            ? `${row.riskHazardCode ? `${row.riskHazardCode} · ` : ""}${row.riskHazard}`
            : null,
          subjectType: row.program.subjectType,
          isActive: row.program.isActive,
          version: row.program.version,
        }))}
        assignees={assignees}
        canManage={canManage}
        initialView={initialView}
      />
    </PageContainer>
  )
}
