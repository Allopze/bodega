import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listDeviationCatalog,
  listImportableDefinitions,
  listInspectionPdtpActivityOptions,
  listInspectionTemplates,
  listUnclassifiedDeviations,
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
  const [templates, pdtpOptions] = await Promise.all([
    listInspectionTemplates(access),
    listInspectionPdtpActivityOptions(access),
  ])

  /* Catálogo de desviaciones por instrumento, más las que se registraron como
   * "Otra" y esperan clasificación. Se piden en paralelo y sólo para quien
   * administra: quien sólo mira no tiene qué hacer con ellas. */
  const deviationsByTemplate = new Map<string, Awaited<ReturnType<typeof listDeviationCatalog>>>()
  const unclassifiedByTemplate = new Map<string, Awaited<ReturnType<typeof listUnclassifiedDeviations>>>()
  if (canManage) {
    const rows = await Promise.all(templates.map(async (template) => [
      template.id,
      await listDeviationCatalog(template.id, access),
      await listUnclassifiedDeviations(template.id, access),
    ] as const))
    for (const [templateId, catalog, unclassified] of rows) {
      deviationsByTemplate.set(templateId, catalog)
      unclassifiedByTemplate.set(templateId, unclassified)
    }
  }
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
    definitionDrifted: row.definitionDrifted,
    definitionMissing: row.definitionMissing,
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
        actions={canManage && importable.length > 0 ? <ImportTemplateDialog importable={importable} templates={templateItems} /> : undefined}
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
