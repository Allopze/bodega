import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listDeviationCatalogs,
  listImportableDefinitions,
  listInspectionPdtpActivityOptions,
  listInspectionDocumentSources,
  listInspectionTemplates,
  listUnclassifiedDeviationsFor,
} from "@/lib/services/prevention-inspections"
import { ImportTemplateDialog, InspectionTemplatesPanel, type TemplateItem } from "../inspection-catalog"

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
  const [templates, pdtpOptions, documentSources] = await Promise.all([
    listInspectionTemplates(access),
    listInspectionPdtpActivityOptions(access),
    canManage ? listInspectionDocumentSources(access) : Promise.resolve([]),
  ])

  /* Catálogo de desviaciones por instrumento, más las que se registraron como
   * "Otra" y esperan clasificación. Se piden en paralelo y sólo para quien
   * administra: quien sólo mira no tiene qué hacer con ellas. */
  /* INS-12: antes eran dos consultas secuenciales POR plantilla —una de ellas
   * un GROUP BY con join— y para todas, aunque sólo tres instrumentos del
   * catálogo registran desviaciones. Ahora son dos consultas en total, y sólo
   * sobre los que pueden tenerlas. */
  const deviationTemplateIds = templates
    .filter((row) => Boolean((row.definitionSnapshot as { recordsDeviations?: boolean } | null)?.recordsDeviations))
    .map((row) => row.id)
  // Sólo para quien administra: quien únicamente mira no tiene qué hacer con ellas.
  const [deviationsByTemplate, unclassifiedByTemplate] = await Promise.all([
    canManage ? listDeviationCatalogs(deviationTemplateIds, access) : Promise.resolve(new Map()),
    canManage ? listUnclassifiedDeviationsFor(deviationTemplateIds, access) : Promise.resolve(new Map()),
  ]) as [
    Awaited<ReturnType<typeof listDeviationCatalogs>>,
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
    sourceDefinitionCode: row.sourceDefinitionCode,
    executorOfRecord: row.executorOfRecord,
    definitionDrifted: row.definitionDrifted,
    definitionMissing: row.definitionMissing,
    provenanceKind: row.provenanceKind,
    sourceDocumentVersionId: row.sourceDocumentVersionId,
    sourceSnapshot: row.sourceSnapshot,
    parityReport: row.parityReport,
    contentHash: row.contentHash,
    deviations: (deviationsByTemplate.get(row.id) ?? []).map((entry) => ({
      id: entry.id,
      label: entry.label,
      danoPotencial: entry.danoPotencial,
      isActive: entry.isActive,
      criticality: entry.criticality,
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
        canManage={canManage}
        canApprove={session.user.permissions.includes("prevention:inspections:approve")}
      />
    </PageContainer>
  )
}
