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
import { loadPdtpActivityIdentityMap } from "@/lib/services/prevention-inspections/pdtp-identity"
import { officialInspectionSourceFor } from "@/lib/sst/official-inspection-sources"
import type { TemplateItem } from "../_components/catalog-types"
import { ImportTemplateDialog } from "./_components/import-template-dialog"
import { InspectionTemplatesPanel } from "./_components/templates-panel"
import { listCatalogActivities } from "@/lib/services/pdtp/catalog-activities"
import { listPdtpAccreditationBindings } from "@/lib/services/pdtp/accreditation-bindings"
import { buildTemplatePdtpAccreditation } from "./pdtp-accreditation"

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
  const recordsDeviationsIds = new Set(deviationTemplateIds)
  // Sólo para quien administra: quien únicamente mira no tiene qué hacer con ellas.
  // Los bindings también cuelgan sólo de los ids de plantilla: van en esta
  // misma tanda en vez de sumar un viaje propio antes de ella.
  const [bindings, deviationsByCode, unclassifiedByTemplate, identities] = await Promise.all([
    listPdtpAccreditationBindings({ sourceType: "inspeccion", sourceIds: templates.map((template) => template.id) }),
    canManage ? listTemplateDeviationSelections(deviationTemplateCodes, access) : Promise.resolve(new Map()),
    canManage ? listUnclassifiedDeviationsFor(deviationTemplateIds, access) : Promise.resolve(new Map()),
    // Identidad corporativa de cada actividad del programa vigente: con ella la
    // tabla y el diálogo dicen lo mismo de lo que una plantilla acredita.
    loadPdtpActivityIdentityMap(),
  ]) as [
    Awaited<ReturnType<typeof listPdtpAccreditationBindings>>,
    Awaited<ReturnType<typeof listTemplateDeviationSelections>>,
    Awaited<ReturnType<typeof listUnclassifiedDeviationsFor>>,
    Awaited<ReturnType<typeof loadPdtpActivityIdentityMap>>,
  ]
  const nameByNumber = new Map(pdtpOptions.map((option) => [option.n, option.name]))
  const catalogTitleById = new Map(catalogActivities.map((activity) => [activity.id, activity.title]))
  /** Vínculos vigentes por plantilla y eje; los inactivos son historia, no acreditación. */
  const bindingIdsOf = (templateId: string, eventType: "execute" | "review") => bindings
    .filter((binding) => binding.sourceId === templateId && binding.eventType === eventType && binding.isActive)
    .map((binding) => binding.catalogActivityId)
  const templateItems: TemplateItem[] = templates.map((row) => ({
    id: row.id,
    code: row.code,
    versionLabel: row.versionLabel,
    name: row.name,
    kind: row.kind,
    status: row.status,
    // Retirada a propósito = `superseded` sin versión que la reemplace.
    supersededByTemplateId: row.supersededByTemplateId,
    authorUserId: row.authorUserId,
    version: row.version,
    coverage: row.coverage,
    pdtpActivityNumbers: row.pdtpActivityNumbers,
    pdtpReviewActivityNumbers: row.pdtpReviewActivityNumbers,
    ...buildTemplatePdtpAccreditation({
      numbers: { execute: row.pdtpActivityNumbers, review: row.pdtpReviewActivityNumbers },
      bindingIds: { execute: bindingIdsOf(row.id, "execute"), review: bindingIdsOf(row.id, "review") },
      identities,
      nameByNumber,
      catalogTitleById,
    }),
    // El catálogo de desviaciones sólo existe donde el instrumento las registra.
    recordsDeviations: recordsDeviationsIds.has(row.id),
    sourceDefinitionCode: row.sourceDefinitionCode,
    executorOfRecord: row.executorOfRecord,
    definitionDrifted: row.definitionDrifted,
    definitionMissing: row.definitionMissing,
    provenanceKind: row.provenanceKind,
    // Un anexo oficial no se aprueba sin su planilla; el checksum del archivo
    // oficial deja ofrecer en la Biblioteca sólo el que coincide.
    needsOfficialSource: row.provenanceKind === "official_document",
    officialChecksumSha256: row.sourceDefinitionCode ? officialInspectionSourceFor(row.sourceDefinitionCode)?.sha256 ?? null : null,
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
  // El mismo botón del encabezado llena el catálogo vacío (A4): una acción real, no una ruta pegada como texto.
  const importAction = canManage && importable.length > 0
    ? <ImportTemplateDialog importable={importable} templates={templateItems} documentSources={documentSources} />
    : undefined

  return (
    <PageContainer>
      <PageHeader
        title="Plantillas de inspección"
        description="Instrumentos versionados: qué se pregunta y qué acredita."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Inspecciones", href: "/prevencion/inspecciones" },
          { label: "Plantillas" },
        ]} />}
        actions={importAction}
      />
      <InspectionTemplatesPanel
        templates={templateItems}
        // El número anual de cada actividad acompaña al título en el selector: es
        // como se la reconoce cuando una plantilla todavía acredita por número.
        catalogActivities={catalogActivities.map((activity) => ({
          id: activity.id,
          code: activity.code,
          title: activity.title,
          description: activity.description,
          status: activity.status as "draft" | "active" | "retired",
          annualNumber: identities.byCatalogId.get(activity.id)?.n ?? null,
        }))}
        documentSources={documentSources}
        canManage={canManage}
        canApprove={session.user.permissions.includes("prevention:inspections:approve")}
        currentUserId={session.user.id}
        emptyAction={importAction}
      />
    </PageContainer>
  )
}
