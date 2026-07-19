import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPreventionPrivacyRequestWorkbench } from "@/lib/services/prevention-privacy-rights"
import { PrivacyRightExecutionWorkbench } from "./privacy-right-execution-workbench"

export const metadata: Metadata = { title: "Ejecución de derecho de privacidad" }

interface Props { params: Promise<{ id: string }> }

const RIGHT_LABELS: Record<string, string> = {
  access: "Acceso",
  rectification: "Rectificación",
  deletion: "Supresión",
  opposition: "Oposición",
  portability: "Portabilidad",
  restriction: "Restricción",
}

export default async function PrivacyRequestDetailPage({ params }: Props) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:privacy:manage_requests")) redirect("/forbidden")
  const { id } = await params
  const bundle = await getPreventionPrivacyRequestWorkbench({
    requestId: id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  })
  if (!bundle) redirect("/prevencion/privacidad/solicitudes")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`${RIGHT_LABELS[bundle.request.rightType] ?? bundle.request.rightType} · ${bundle.subject.name}`}
        description="Inventario del titular y ejecución auditable por dominio, sin copiar contenido sensible a la bitácora."
        breadcrumb={<Breadcrumbs items={[
          { label: "Prevención", href: "/prevencion" },
          { label: "Privacidad", href: "/prevencion/privacidad/auditoria" },
          { label: "Solicitudes", href: "/prevencion/privacidad/solicitudes" },
          { label: id },
        ]} />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-(--color-border) py-2 text-sm">
        <span><strong>Faena:</strong> {bundle.worksite?.name ?? bundle.subject.worksiteId}</span>
        <span><strong>RUT:</strong> {bundle.subject.rut ?? "Sin RUT"}</span>
        <Badge variant={bundle.request.legalHold ? "danger" : bundle.request.status === "completada" ? "success" : "info"}>{bundle.request.status}</Badge>
      </div>
      <PrivacyRightExecutionWorkbench bundle={bundle} />
    </PageContainer>
  )
}
