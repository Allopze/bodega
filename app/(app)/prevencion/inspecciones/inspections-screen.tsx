import { redirect } from "next/navigation"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpAccreditationBindings } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  countOverdueInspectionPrograms,
  listInspectionAssignees,
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
import { PdtpScheduledActivityPanelServer } from "@/components/prevention/pdtp-scheduled-activity-panel-server"

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
  // Decide el texto del tile «Pendientes de revisión»: «para mí» con permiso de
  // revisión, «para Prevención» sin él (mismo criterio que `pendingReviewCondition`).
  const canReview = session.user.permissions.includes("prevention:inspections:review")

  const queryValue = (value: string | string[] | undefined): string | undefined => {
    const candidate = Array.isArray(value) ? value[0] : value
    return candidate?.trim() || undefined
  }
  const contextualWorksiteId = queryValue(searchParams?.faena)
  const contextualInstanceId = queryValue(searchParams?.instancia)
  const contextualInstrumentId = queryValue(searchParams?.instrumento)
  // Los enlaces de una instancia llevan el binding PDTP, no el ID interno de
  // la plantilla. Resolverlo aquí permite que el formulario nativo siga siendo
  // la única fuente de creación y, al mismo tiempo, llegue con el instrumento
  // correcto preseleccionado.
  const [contextualBinding] = contextualInstrumentId
    ? await db.select({ sourceType: pdtpAccreditationBindings.sourceType, sourceId: pdtpAccreditationBindings.sourceId, eventType: pdtpAccreditationBindings.eventType })
      .from(pdtpAccreditationBindings)
      .where(and(eq(pdtpAccreditationBindings.id, contextualInstrumentId), eq(pdtpAccreditationBindings.isActive, true)))
      .limit(1)
    : []
  const contextualTemplateId = contextualBinding?.sourceType === "inspeccion" && contextualBinding.eventType === "execute"
    ? contextualBinding.sourceId
    : undefined

  const { page, filter } = parseInspectionListQuery(searchParams ?? {})
  const exportQuery = buildInspectionExportQuery(filter)

  const [runs, summary, overdueProgramCount, templates, worksites, assignees] = await Promise.all([
    listInspectionRuns(access, filter, { offset: (page - 1) * INSPECTION_PAGE_SIZE }),
    // KPIs sobre el universo completo, no sobre la página visible (C-09).
    summarizeInspectionRuns(access, filter),
    // Sólo se necesita la cifra del aviso de programaciones vencidas: se cuenta
    // en SQL en vez de traer todas las programaciones con sus joins.
    countOverdueInspectionPrograms(access, { kinds: filter.kinds }),
    canExecute ? listInspectionTemplates(access, { kinds: filter.kinds }) : Promise.resolve([]),
    // P1-10: las faenas del alcance las pide cualquiera con `view` (el servicio
    // no exige más). Condicionarlas a `execute` dejaba el filtro «Faena» casi
    // vacío para jefatura, CPHS y mantención, que sólo veían las de las 50 filas
    // de la página. Crear (`canCreate`) y el inventario de sujetos siguen
    // siendo cosa de `canExecute`.
    listInspectionWorksites(access),
    // I-10: el filtro de responsable es para cualquiera con `view` (la jefa
    // puede tener `review` sin `execute`), no sólo para quien ejecuta.
    listInspectionAssignees(access),
  ])

  const approvedTemplates = templates.flatMap((item) => item.status === "approved"
    ? [{ id: item.id, name: item.name, versionLabel: item.versionLabel, kind: item.kind, sourceDefinitionCode: item.sourceDefinitionCode }]
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
        description="Inspecciones, observaciones y auditorías por faena."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Inspecciones" },
        ]} />}
        /* Sólo acciones de página. "Seguimiento", "Plantillas" y "Programación"
           estaban acá como botones y no son acciones: son las rutas hermanas
           que el menú lateral ya lista bajo "Inspecciones" —Seguimiento se
           sumó ahí—. Seis controles en la cabecera dejaban al único verbo
           primario, "Nueva inspección", compitiendo con la navegación. */
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
              initialTemplateId={contextualTemplateId}
              initialWorksiteId={contextualWorksiteId}
              initialOpen={Boolean(contextualInstanceId)}
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
        overdueProgramCount={overdueProgramCount}
        today={todayInChile()}
        canExecute={canExecute}
        canReview={canReview}
        templates={approvedTemplates}
        worksites={worksites}
        assignees={assignees}
        subjectsByWorksite={subjectsByWorksite}
        // Sobre la barra de filtros y no al pie, y como aviso de una línea: con
        // 50 filas y la paginación debajo, el bloque completo no lo veía nadie.
        // Sigue la faena que la pantalla ya filtró y no pregunta otra vez.
        activities={<PdtpScheduledActivityPanelServer
          connectorKey="inspections"
          searchQuery={filter.search}
          worksiteId={filter.worksiteId}
          presentation="summary"
        />}
      />
    </PageContainer>
  )
}
