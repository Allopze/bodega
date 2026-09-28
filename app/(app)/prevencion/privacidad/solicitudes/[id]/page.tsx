import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { MetaBadge, metaFor } from "@/components/states/state-badge"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPreventionPrivacyRequestWorkbench } from "@/lib/services/prevention-privacy-rights"
import { labelOf, PRIVACY_REQUEST_STATUS_META, PRIVACY_RIGHT_LABELS } from "@/lib/prevention/privacy-inventory"
import { PrivacyRightExecutionWorkbench } from "./privacy-right-execution-workbench"

export const metadata: Metadata = { title: "Ejecución de derecho de privacidad" }

interface Props { params: Promise<{ id: string }> }

export default async function PrivacyRequestDetailPage({ params }: Props) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/privacidad/solicitudes")}`) }
  if (!can(session, "prevention:privacy:manage_requests")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/privacidad/solicitudes")}`)
  const { id } = await params
  const bundle = await getPreventionPrivacyRequestWorkbench({
    requestId: id,
    ctx: { userId: session.user.id },
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  })
  if (!bundle) redirect("/prevencion/privacidad/solicitudes")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`${labelOf(PRIVACY_RIGHT_LABELS, bundle.request.rightType)} · ${bundle.subject.name}`}
        description="Inventario del titular y ejecución auditable por dominio, sin copiar contenido sensible a la bitácora."
        breadcrumb={<Breadcrumbs items={[
          { label: "Prevención", href: "/prevencion" },
          { label: "Datos personales", href: "/prevencion/privacidad/auditoria" },
          { label: "Solicitudes", href: "/prevencion/privacidad/solicitudes" },
          { label: id },
        ]} />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-(--color-border) py-2 text-sm">
        <span><strong>Faena:</strong> {bundle.worksite?.name ?? bundle.subject.worksiteId}</span>
        <span><strong>RUT:</strong> {bundle.subject.rut ?? "Sin RUT"}</span>
        {/* Mismo catálogo y color que el listado de solicitudes: antes la ficha
            mostraba el enum crudo (`suspendida_retencion`) con su propio color. */}
        <MetaBadge meta={metaFor(PRIVACY_REQUEST_STATUS_META, bundle.request.status)} />
        {bundle.request.legalHold && bundle.request.status !== "suspendida_retencion" ? (
          <MetaBadge meta={{ label: "Retención legal", variant: "danger" }} />
        ) : null}
      </div>
      <PrivacyRightExecutionWorkbench bundle={bundle} />
    </PageContainer>
  )
}
