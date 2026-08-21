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
  listInspectionRuns,
  listInspectionSubjects,
  listInspectionTemplates,
  listInspectionWorksites,
  summarizeInspectionRuns,
  INSPECTION_PAGE_SIZE,
} from "@/lib/services/prevention-inspections"
import { InspectionRunList, NewRunDialog, type InspectionSubjectOption } from "./inspection-run-list"
import { todayInChile } from "@/lib/utils"

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

  const single = (key: string) => {
    const value = searchParams?.[key]
    return Array.isArray(value) ? value[0] : value
  }
  const page = Math.max(1, Number(single("pagina") ?? 1) || 1)
  const rawView = single("vista")
  const view: "pending_review" | "open_findings" | "critical" | undefined =
    rawView === "pending_review" || rawView === "open_findings" || rawView === "critical" ? rawView : undefined
  // El tipo de instrumento es un filtro más. `kinds` se mantiene como lista
  // porque el SQL lo consume así y "todos" es simplemente no declararlo.
  const rawKind = single("tipo")
  const kinds = rawKind === "inspection" || rawKind === "observation" || rawKind === "audit" ? [rawKind] : undefined
  const exportQuery = kinds ? `?tipo=${kinds[0]}` : ""
  const filter = {
    kinds,
    status: single("estado") || undefined,
    worksiteId: single("faena") || undefined,
    search: single("q") || undefined,
    view,
  }

  const [runs, summary, programs, templates, worksites, assignees] = await Promise.all([
    listInspectionRuns(access, filter, { offset: (page - 1) * INSPECTION_PAGE_SIZE }),
    // KPIs sobre el universo completo, no sobre la página visible (C-09).
    summarizeInspectionRuns(access, { kinds }),
    listInspectionPrograms(access, { kinds }),
    canExecute ? listInspectionTemplates(access, { kinds }) : Promise.resolve([]),
    canExecute ? listInspectionWorksites(access) : Promise.resolve([]),
    canExecute ? listInspectionAssignees(access) : Promise.resolve([]),
  ])

  const approvedTemplates = templates.flatMap((item) => item.status === "approved"
    ? [{ id: item.id, name: item.name, versionLabel: item.versionLabel }]
    : [])

  // Función #11: inventario por faena para el picker de sujeto. Son pocas
  // faenas por usuario, así que se precarga en vez de pedirlo al cambiar.
  const subjectsByWorksite: Record<string, InspectionSubjectOption[]> = {}
  if (canExecute) {
    const entries = await Promise.all(
      worksites.map(async (worksite) => [worksite.id, await listInspectionSubjects(worksite.id, access)] as const),
    )
    for (const [worksiteId, rows] of entries) subjectsByWorksite[worksiteId] = rows
  }

  return (
    <PageContainer>
      <PageHeader
        title="Inspecciones"
        description="Inspecciones, observaciones de conducta y auditorías del Sistema de Gestión (DS 44 art. 22 n°4). Cada incumplimiento genera un hallazgo, y los graves exigen una acción correctiva antes de cerrar."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Inspecciones" },
        ]} />}
        actions={
          <>
            {/* Esta pantalla ES "realizar una inspección": su verbo va primero
                y en el encabezado, no dentro de la barra de filtros. */}
            {canExecute && approvedTemplates.length > 0 && worksites.length > 0 ? (
              <NewRunDialog
                templates={approvedTemplates}
                worksites={worksites}
                assignees={assignees}
                subjectsByWorksite={subjectsByWorksite}
              />
            ) : undefined}
            {/* El export respeta los filtros de la pantalla: exportar el
                universo completo desde una bandeja acotada a un tipo era una
                trampa silenciosa. */}
            <Button asChild variant="secondary">
              <Link href="/prevencion/inspecciones/plantillas">Plantillas</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/prevencion/inspecciones/programacion">Programación</Link>
            </Button>
            {session.user.permissions.includes("prevention:inspections:export") ? (
              <Button asChild variant="secondary">
                <a href={`/api/prevencion/inspecciones/export${exportQuery}`} download>Exportar Excel</a>
              </Button>
            ) : undefined}
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
          executedAt: row.run.executedAt,
          compliancePercent: row.run.compliancePercent,
          nonConformingCount: row.run.nonConformingCount,
          openFindings: row.openFindings,
          criticalFindings: row.criticalFindings,
        }))}
        summary={summary}
        page={page}
        pageSize={INSPECTION_PAGE_SIZE}
        overdueProgramCount={programs.filter((row) => row.program.isActive && row.program.nextDueOn < todayInChile()).length}
        canExecute={canExecute}
        templates={approvedTemplates}
        worksites={worksites}
        assignees={assignees}
        subjectsByWorksite={subjectsByWorksite}
      />
    </PageContainer>
  )
}
