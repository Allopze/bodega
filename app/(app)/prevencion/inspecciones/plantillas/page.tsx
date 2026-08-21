import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listImportableDefinitions, listInspectionTemplates } from "@/lib/services/prevention-inspections"
import { InspectionTemplatesPanel } from "../inspection-catalog"

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
  const templates = await listInspectionTemplates(access)

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
      />
      <InspectionTemplatesPanel
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
          pdtpReviewActivityNumbers: row.pdtpReviewActivityNumbers,
          sourceDefinitionCode: row.sourceDefinitionCode,
          definitionDrifted: row.definitionDrifted,
          definitionMissing: row.definitionMissing,
        }))}
        importable={canManage ? listImportableDefinitions() : []}
        canManage={canManage}
        canApprove={session.user.permissions.includes("prevention:inspections:approve")}
      />
    </PageContainer>
  )
}
