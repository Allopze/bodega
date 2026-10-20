import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listInspectionAssignees,
  listInspectionPrograms,
  listInspectionSubjectsByWorksite,
  listInspectionTemplates,
  listInspectionWorksites,
} from "@/lib/services/prevention-inspections"
// Directo del submódulo: el barril de `prevention-inspections` lo mantiene la
// sesión principal y esta función es nueva.
import { listRiskEntriesByWorksite } from "@/lib/services/prevention-inspections/programs"
import type { InspectionSubjectOption } from "@/lib/prevention/inspection-list-query"
import { ProgramDialog } from "./_components/program-dialogs"
import { InspectionProgramsPanel } from "./_components/programs-panel"

export const metadata: Metadata = { title: "Programación de inspecciones" }

/** Cuándo se pregunta: el calendario del que nacen las inspecciones planificadas. */
export default async function ProgramacionInspeccionPage() {
  let session
  try { session = await requirePermission("prevention:inspections:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canManage = session.user.permissions.includes("prevention:inspections:manage")

  const [programs, templates, worksites, assignees] = await Promise.all([
    listInspectionPrograms(access),
    listInspectionTemplates(access),
    canManage ? listInspectionWorksites(access) : Promise.resolve([]),
    canManage ? listInspectionAssignees(access) : Promise.resolve([]),
  ])

  // A-09: el diálogo pedía escribir el ID del peligro MIPER a mano. Se precarga
  // por faena porque el picker debe cambiar al cambiar la faena seleccionada, y
  // son pocas faenas por usuario. Una consulta para todas (P2-19), no una por faena.
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
      listRiskEntriesByWorksite(worksiteIds, access),
      // Una consulta por tabla para todas las faenas, no dos por faena (INS-12).
      listInspectionSubjectsByWorksite(worksiteIds, access),
    ])
    for (const [worksiteId, rows] of Object.entries(risks)) riskEntriesByWorksite[worksiteId] = rows.map((row) => ({ ...row, hazard: row.hazard ?? "Sin peligro descrito" }))
    subjectsByWorksite = subjects
  }

  const approvedTemplates = templates.flatMap((item) => item.status === "approved"
    ? [{ id: item.id, name: item.name, versionLabel: item.versionLabel, kind: item.kind, sourceDefinitionCode: item.sourceDefinitionCode }]
    : [])

  const programDialog = canManage && approvedTemplates.length > 0 && worksites.length > 0
    ? <ProgramDialog templates={approvedTemplates} worksites={worksites} assignees={assignees} riskEntriesByWorksite={riskEntriesByWorksite} subjectsByWorksite={subjectsByWorksite} />
    : undefined
  /* El estado vacío (A4) nombra lo que falta y ofrece la acción real: crear la
   * primera programación, o —si no hay con qué— ir a aprobar una plantilla. Antes
   * mandaba a un botón del encabezado sin ofrecerlo. */
  const needsApprovedTemplate = canManage && approvedTemplates.length === 0
  const emptyAction = needsApprovedTemplate
    ? <Button asChild variant="secondary"><Link href="/prevencion/inspecciones/plantillas">Ir a Plantillas</Link></Button>
    : programDialog

  return (
    <PageContainer>
      <PageHeader
        title="Programación de inspecciones"
        description="Qué instrumento se ejecuta, en qué faena y cada cuánto."
        actions={programDialog}
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
          // El sujeto del inventario que se eligió, ya con su nombre.
          subjectLabel: row.subjectLabel,
          subjectResourceId: row.program.subjectResourceId,
          subjectVehicleId: row.program.subjectVehicleId,
          subjectContainerId: row.program.subjectContainerId,
          templateDefinitionCode: row.templateDefinitionCode,
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
        emptyAction={emptyAction}
        emptyDescription={needsApprovedTemplate ? "Para programar necesitas al menos una plantilla aprobada." : undefined}
      />
    </PageContainer>
  )
}
