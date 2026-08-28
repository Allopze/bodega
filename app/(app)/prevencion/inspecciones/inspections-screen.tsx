import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listInspectionAssignees,
  listInspectionPrograms,
  listInspectionRuns,
  listInspectionSubjectsByWorksite,
  listInspectionTemplates,
  listInspectionWorksites,
  summarizeInspectionRuns,
  INSPECTION_PAGE_SIZE,
} from "@/lib/services/prevention-inspections"
import { InspectionPageActions, InspectionRunList } from "./inspection-run-list"
import type { InspectionSubjectOption } from "@/lib/prevention/inspection-list-query"
import { todayInChile } from "@/lib/utils"
import { buildInspectionExportQuery, parseInspectionListQuery } from "@/lib/prevention/inspection-list-query"
import { inspectionProgramIsOverdue } from "@/lib/prevention/inspections"

/**
 * Realizar una inspección: la bandeja de ejecuciones del motor.
 *
 * Un solo listado para los tres instrumentos —inspección, observación y la
 * auditoría del Sistema de Gestión (DS 44 art. 22 n°4)—. Antes las auditorías
 * tenían su propio par de rutas (`/prevencion/auditorias` y su catálogo) con la
 * misma pantalla, los mismos permisos y las mismas acciones; el tipo pasó de ser
 * una ruta a ser un filtro visible, que es lo que siempre fue en la tabla.
 */
export async function InspectionsScreen({ searchParams }: {
  /** Filtros y página. C-09: viajan al SQL, no se aplican sobre un dataset traído entero. */
  searchParams?: Record<string, string | string[] | undefined>
}) {
  let session
  try { session = await requirePermission("prevention:inspections:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canExecute = session.user.permissions.includes("prevention:inspections:execute")

  const { page, filter } = parseInspectionListQuery(searchParams ?? {})
  const exportQuery = buildInspectionExportQuery(filter)

  const [runs, summary, programs, templates, worksites, assignees] = await Promise.all([
    listInspectionRuns(access, filter, { offset: (page - 1) * INSPECTION_PAGE_SIZE }),
    // KPIs sobre el universo completo, no sobre la página visible (C-09).
    summarizeInspectionRuns(access, filter),
    listInspectionPrograms(access, { kinds: filter.kinds }),
    canExecute ? listInspectionTemplates(access, { kinds: filter.kinds }) : Promise.resolve([]),
    canExecute ? listInspectionWorksites(access) : Promise.resolve([]),
    // I-10: el filtro de responsable es para cualquiera con `view` (la jefa
    // puede tener `review` sin `execute`), no sólo para quien ejecuta.
    listInspectionAssignees(access),
  ])

  const approvedTemplates = templates.flatMap((item) => item.status === "approved"
    ? [{ id: item.id, name: item.name, versionLabel: item.versionLabel, kind: item.kind }]
    : [])

  // Función #11: inventario por faena para el picker de sujeto. Son pocas
  // faenas por usuario, así que se precarga en vez de pedirlo al cambiar.
  const subjectsByWorksite: Record<string, InspectionSubjectOption[]> = canExecute
    ? await listInspectionSubjectsByWorksite(worksites.map((worksite) => worksite.id), access)
    : {}

  return (
    <PageContainer>
      <PageHeader
        title="Inspecciones"
        description="Inspecciones, observaciones y auditorías del Sistema de Gestión (DS 44). Todo incumplimiento genera un hallazgo."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Inspecciones" },
        ]} />}
        actions={
          <>
            {/* Esta pantalla ES "realizar una inspección": su verbo va primero
                y en el encabezado, no dentro de la barra de filtros. */}
            <InspectionPageActions
              canCreate={canExecute && approvedTemplates.length > 0 && worksites.length > 0}
              canExport={session.user.permissions.includes("prevention:inspections:export")}
              templates={approvedTemplates}
              worksites={worksites}
              assignees={assignees}
              subjectsByWorksite={subjectsByWorksite}
              exportQuery={exportQuery}
            />
          </>
        }
      />
      <InspectionRunList
        runs={runs.map((row) => ({
          id: row.run.id,
          code: row.run.code,
          status: row.run.status,
          templateName: row.templateName,
          templateKind: row.templateKind,
          origin: row.run.origin,
          subjectLabel: row.run.subjectLabel,
          worksiteId: row.run.worksiteId,
          worksiteName: row.worksiteName,
          // I-18: sustituye a la columna "Origen", que decía "Departamento de
          // Prevención" en prácticamente todas las filas.
          assigneeName: row.assigneeName,
          executedAt: row.run.executedAt,
          scheduledFor: row.run.scheduledFor,
          compliancePercent: row.run.compliancePercent,
          nonConformingCount: row.run.nonConformingCount,
          openFindings: row.openFindings,
          criticalFindings: row.criticalFindings,
        }))}
        summary={summary}
        page={page}
        pageSize={INSPECTION_PAGE_SIZE}
        overdueProgramCount={programs.filter((row) => inspectionProgramIsOverdue(
          { isActive: row.program.isActive, templateApproved: row.templateStatus === "approved", nextDueOn: row.program.nextDueOn },
          todayInChile(),
        )).length}
        today={todayInChile()}
        canExecute={canExecute}
        templates={approvedTemplates}
        worksites={worksites}
        assignees={assignees}
        subjectsByWorksite={subjectsByWorksite}
      />
    </PageContainer>
  )
}
