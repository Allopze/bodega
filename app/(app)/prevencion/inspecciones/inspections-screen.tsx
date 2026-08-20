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
import { InspectionRunList, type InspectionSubjectOption } from "./inspection-run-list"
import { todayInChile } from "@/lib/utils"

/**
 * Pantalla del motor de inspecciones, parametrizada por los `kind` que muestra.
 *
 * `/prevencion/inspecciones` muestra inspecciones y observaciones;
 * `/prevencion/auditorias` muestra las auditorías del Sistema de Gestión
 * (DS 44 art. 22 n°4). Es el mismo motor y la misma tabla: lo único que cambia
 * es el filtro y los rótulos, así que la pantalla se comparte en vez de
 * duplicarse.
 *
 * Se usan rutas distintas y no `?kind=`, porque `isHrefActive` compara sólo el
 * pathname: dos ítems del sidebar con la misma ruta y distinto query string
 * quedarían ambos resaltados.
 */
export async function InspectionsScreen({
  kinds,
  title,
  description,
  breadcrumbLabel,
  catalogHref,
  searchParams,
}: {
  kinds:           readonly string[]
  title:           string
  description:     string
  breadcrumbLabel: string
  /** Catálogo y programación de este mismo `kind` (C-12: sin esto, el catálogo de auditorías no se alcanza desde ningún enlace). */
  catalogHref:     string
  /** Filtros y página. C-09: viajan al SQL, no se aplican sobre un dataset traído entero. */
  searchParams?:   Record<string, string | string[] | undefined>
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
    listInspectionPrograms(access, filter),
    canExecute ? listInspectionTemplates(access, filter) : Promise.resolve([]),
    canExecute ? listInspectionWorksites(access) : Promise.resolve([]),
    canExecute ? listInspectionAssignees(access) : Promise.resolve([]),
  ])

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
        title={title}
        description={description}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: breadcrumbLabel },
        ]} />}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={catalogHref}>Catálogo</Link>
            </Button>
            {session.user.permissions.includes("prevention:inspections:export") ? (
              <Button asChild variant="secondary">
                <a href="/api/prevencion/inspecciones/export" download>Exportar Excel</a>
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
        templates={templates.flatMap((item) => item.status === "approved"
          ? [{ id: item.id, name: item.name, versionLabel: item.versionLabel }]
          : [])}
        worksites={worksites}
        assignees={assignees}
        subjectsByWorksite={subjectsByWorksite}
      />
    </PageContainer>
  )
}
