import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listInspectionAssignees,
  listInspectionPrograms,
  listInspectionSubjectsByWorksite,
  listInspectionTemplates,
  listInspectionWorksites,
  listRiskEntriesForWorksite,
} from "@/lib/services/prevention-inspections"
import type { InspectionSubjectOption } from "@/lib/prevention/inspection-list-query"
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
  /* INS-04: el sujeto del programa existía en el esquema, en el servicio y en
   * el materializador, y ningún formulario lo escribía — así que TODA
   * inspección nacida del cron llegaba sin saber qué inspeccionar, y el
   * inventario de emergencias nunca recibía su `lastInspectedAt` por la vía
   * programada. Se precarga por faena, igual que los peligros MIPER. */
  let subjectsByWorksite: Record<string, InspectionSubjectOption[]> = {}
  if (canManage) {
    const worksiteIds = worksites.map((worksite) => worksite.id)
    const [risks, subjects] = await Promise.all([
      Promise.all(worksiteIds.map(async (id) => [id, await listRiskEntriesForWorksite(id, access)] as const)),
      // Una consulta por tabla para todas las faenas, no dos por faena (INS-12).
      listInspectionSubjectsByWorksite(worksiteIds, access),
    ])
    for (const [worksiteId, rows] of risks) riskEntriesByWorksite[worksiteId] = rows
    subjectsByWorksite = subjects
  }

  const approvedTemplates = templates
    .filter((item) => item.status === "approved")
    .map((item) => ({ id: item.id, name: item.name, versionLabel: item.versionLabel }))

  return (
    <PageContainer>
      <PageHeader
        title="Programación de inspecciones"
        description="Qué instrumento se ejecuta, en qué faena y con qué frecuencia. El barrido diario crea las inspecciones vencidas; «Crear y abrir inspección» usa el mismo camino."
        actions={canManage && approvedTemplates.length > 0 && worksites.length > 0
          ? <ProgramDialog templates={approvedTemplates} worksites={worksites} assignees={assignees} riskEntriesByWorksite={riskEntriesByWorksite} subjectsByWorksite={subjectsByWorksite} />
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
          subjectResourceId: row.program.subjectResourceId,
          subjectVehicleId: row.program.subjectVehicleId,
          isActive: row.program.isActive,
          // I-04: la plantilla puede haber quedado `superseded` desde que se
          // creó el programa; ese estado decide si el botón operativo aplica.
          templateApproved: row.templateStatus === "approved",
          version: row.program.version,
        }))}
        assignees={assignees}
        subjectsByWorksite={subjectsByWorksite}
        riskEntriesByWorksite={riskEntriesByWorksite}
        canManage={canManage}
        initialView={initialView}
      />
    </PageContainer>
  )
}
