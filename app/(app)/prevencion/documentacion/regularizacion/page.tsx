import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getDocumentIntegrityFindings } from "@/lib/services/prevention-documents-library"
import { DocumentIntegrityWorkbench } from "./document-integrity-workbench"

export const metadata: Metadata = { title: "Regularización documental SST" }

export default async function DocumentRegularizationPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:docs:publish")) redirect("/forbidden")

  const findings = await getDocumentIntegrityFindings(
    resolveWorksiteScope(session),
    session.user.permissions,
  )
  const criticalCount = findings.filter((finding) => finding.severity === "critico").length

  return (
    <PageContainer>
      <PageHeader
        title="Regularización documental"
        description="Expedientes que no pueden usarse como evidencia hasta resolver la inconsistencia con trazabilidad."
        breadcrumb={<Breadcrumbs items={[
          { label: "Prevención", href: "/prevencion" },
          { label: "Documentación", href: "/prevencion/documentacion" },
          { label: "Regularización" },
        ]} />}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href="/prevencion/privacidad/auditoria">Revisar accesos sensibles</Link>
            </Button>
            <Button asChild size="sm">
              <a href="/api/prevencion/documentacion/integrity/export" download>Exportar hallazgos Excel</a>
            </Button>
          </div>
        )}
      />

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-[var(--color-border)] py-2 text-sm">
        <span><strong>{findings.length}</strong> hallazgo(s)</span>
        <span className="text-[var(--color-danger)]"><strong>{criticalCount}</strong> crítico(s)</span>
        <span className="text-[var(--color-text-muted)]">Estado: evidencia no utilizable hasta regularización auditada</span>
      </div>

      {findings.length === 0 ? (
        <EmptyState
          title="Sin inconsistencias automáticas"
          description="Los controles verificables de versión, aprobación y distribución no detectaron expedientes pendientes."
        />
      ) : (
        <DocumentIntegrityWorkbench findings={findings} />
      )}
    </PageContainer>
  )
}
