import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listImportableDefinitions,
  listInspectionPdtpActivityOptions,
  listInspectionDocumentSources,
  listInspectionTemplates,
  listUnclassifiedDeviationsFor,
} from "@/lib/services/prevention-inspections"
import { listTemplateDeviationSelections } from "@/lib/services/prevention-deviations"
import { ImportTemplateDialog, InspectionTemplatesPanel, type TemplateItem } from "../inspection-catalog"
import { listCatalogActivities } from "@/lib/services/pdtp/catalog-activities"
import { listPdtpAccreditationBindings } from "@/lib/services/pdtp/accreditation-bindings"

export const metadata: Metadata = { title: "Plantillas de inspección" }

/**
 * Qué se pregunta. Incluye las auditorías del SGSST (DS 44 art. 22 n°4), que
 * son un `kind` más del mismo catálogo: antes duplicaban esta pantalla completa
 * bajo /prevencion/auditorias/catalogo.
 */
export default async function PlantillasInspeccionPage() {
  let session
  try { session = await requirePermission("prevention:inspections:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canManage = session.user.permissions.includes("prevention:inspections:manage")
  const [templates, pdtpOptions, documentSources, catalogActivities] = await Promise.all([
    listInspectionTemplates(access),
    listInspectionPdtpActivityOptions(access),
    canManage ? listInspectionDocumentSources(access) : Promise.resolve([]),
    listCatalogActivities(),
  ])
  const bindings = await listPdtpAccreditationBindings({ sourceType: "inspeccion", sourceIds: templates.map((template) => template.id) })

  /* Qué desviaciones del maestro ofrece cada instrumento, más las que se
   * registraron como "Otra" y esperan clasificación. Se piden en paralelo y
   * sólo para quien administra: quien sólo mira no tiene qué hacer con ellas. */
  /* INS-12: antes eran dos consultas secuenciales POR plantilla —una de ellas
   * un GROUP BY con join— y para todas, aunque sólo cuatro instrumentos del
   * catálogo registran desviaciones. Ahora son tres consultas en total, y sólo
   * sobre los que pueden tenerlas. */
  const deviationTemplates = templates
    .filter((row) => Boolean((row.definitionSnapshot as { recordsDeviations?: boolean } | null)?.recordsDeviations))
  // La selección cuelga del CÓDIGO del instrumento, no de la fila de su versión.
  const deviationTemplateCodes = [...new Set(deviationTemplates.map((row) => row.code))]
  const deviationTemplateIds = deviationTemplates.map((row) => row.id)
  // Sólo para quien administra: quien únicamente mira no tiene qué hacer con ellas.
  const [deviationsByCode, unclassifiedByTemplate] = await Promise.all([
    canManage ? listTemplateDeviationSelections(deviationTemplateCodes, access) : Promise.resolve(new Map()),
    canManage ? listUnclassifiedDeviationsFor(deviationTemplateIds, access) : Promise.resolve(new Map()),
  ]) as [
    Awaited<ReturnType<typeof listTemplateDeviationSelections>>,
    Awaited<ReturnType<typeof listUnclassifiedDeviationsFor>>,
  ]
  const templateItems: TemplateItem[] = templates.map((row) => ({
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
    pdtpReviewActivityNumbers: row.pdtpReviewActivityNumbers,
    pdtpCatalogActivityIds: bindings.filter((binding) => binding.sourceId === row.id && binding.eventType === "execute" && binding.isActive).map((binding) => binding.catalogActivityId),
    pdtpReviewCatalogActivityIds: bindings.filter((binding) => binding.sourceId === row.id && binding.eventType === "review" && binding.isActive).map((binding) => binding.catalogActivityId),
    sourceDefinitionCode: row.sourceDefinitionCode,
    executorOfRecord: row.executorOfRecord,
    definitionDrifted: row.definitionDrifted,
    definitionMissing: row.definitionMissing,
    provenanceKind: row.provenanceKind,
    sourceDocumentVersionId: row.sourceDocumentVersionId,
    sourceSnapshot: row.sourceSnapshot,
    parityReport: row.parityReport,
    contentHash: row.contentHash,
    /* El maestro entero marcado con lo que este instrumento ofrece: el diálogo
     * es un selector, así que necesita también las no seleccionadas. Se ocultan
     * las retiradas del maestro que este instrumento no ofrece — no hay nada
     * que hacer con ellas y sólo alargan la lista. */
    deviations: (deviationsByCode.get(row.code) ?? [])
      .filter((entry) => entry.isActive || entry.selected)
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        danoPotencial: entry.danoPotencial,
        isActive: entry.isActive,
        criticality: entry.criticality,
        selected: entry.selected,
        danoPotencialOverride: entry.danoPotencialOverride,
        effectiveDano: entry.effectiveDano,
        effectiveCriticality: entry.effectiveCriticality,
      })),
    unclassifiedDeviations: unclassifiedByTemplate.get(row.id) ?? [],
  }))
  const importable = canManage ? listImportableDefinitions() : []

  return (
    <PageContainer>
      <PageHeader
        title="Plantillas de inspección"
        description="Los instrumentos versionados del catálogo SST —inspecciones, observaciones y la auditoría del Sistema de Gestión (DS 44 art. 22 n°4)—: qué se pregunta, con qué gravedad por ítem y qué actividad del programa anual acredita."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Inspecciones", href: "/prevencion/inspecciones" },
          { label: "Plantillas" },
        ]} />}
        actions={canManage && importable.length > 0 ? <ImportTemplateDialog importable={importable} templates={templateItems} documentSources={documentSources} /> : undefined}
      />
      <InspectionTemplatesPanel
        templates={templateItems}
        pdtpOptions={pdtpOptions}
        catalogActivities={catalogActivities.map((activity) => ({ id: activity.id, code: activity.code, title: activity.title, description: activity.description, status: activity.status as "draft" | "active" | "retired" }))}
        canManage={canManage}
        canApprove={session.user.permissions.includes("prevention:inspections:approve")}
      />
    </PageContainer>
  )
}
