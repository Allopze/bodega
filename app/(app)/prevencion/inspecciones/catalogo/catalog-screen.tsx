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
  listRiskEntriesForWorksite,
} from "@/lib/services/prevention-inspections"
import { InspectionCatalog } from "./inspection-catalog"

/**
 * Catálogo y programación del motor de inspecciones, parametrizado por `kind`
 * — mismo patrón que `InspectionsScreen` (`../inspections-screen.tsx`).
 *
 * Antes de esto, esta pantalla no filtraba por `kind`: bajo la ruta
 * "/prevencion/inspecciones/catalogo" aparecían también las plantillas y la
 * programación de auditorías (`kind='audit'`), y el catálogo de auditorías no
 * se alcanzaba desde ningún enlace propio (C-11/C-12, auditoría 2026-08-18).
 */
export async function CatalogScreen({
  kinds,
  title,
  description,
  breadcrumbLabel,
  backHref,
}: {
  kinds:           readonly string[]
  title:           string
  description:     string
  breadcrumbLabel: string
  /** Ruta de la pantalla de ejecuciones correspondiente a este `kind`. */
  backHref:        string
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
  const filter = { kinds }

  const [templates, programs, worksites, assignees] = await Promise.all([
    listInspectionTemplates(access, filter),
    listInspectionPrograms(access, filter),
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

  return (
    <PageContainer>
      <PageHeader
        title={title}
        description={description}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: breadcrumbLabel, href: backHref },
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
          sourceDefinitionCode: row.sourceDefinitionCode,
          definitionDrifted: row.definitionDrifted,
          definitionMissing: row.definitionMissing,
        }))}
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
          subjectType: row.program.subjectType,
          isActive: row.program.isActive,
          version: row.program.version,
        }))}
        riskEntriesByWorksite={riskEntriesByWorksite}
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
