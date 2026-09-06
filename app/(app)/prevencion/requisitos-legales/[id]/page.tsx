import { notFound, redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getLegalRequirementDetail } from "@/lib/services/prevention-risk-legal"
import {
  LEGAL_APPLICABILITY_STATUS_LABELS,
  LEGAL_COMPLIANCE_STATUS_LABELS,
  LEGAL_REQUIREMENT_STATUS_LABELS,
  legalStatusVariant,
} from "@/lib/prevention/badges"
import { formatDate } from "@/lib/utils"
import { MetaBadge } from "@/components/states/state-badge"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

const SOURCE_TYPE: Record<string, string> = {
  legal: "Ley",
  regulatory: "Reglamento",
  contractual: "Contrato",
  standard: "Norma",
  internal: "Política interna",
}

export default async function LegalRequirementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/requisitos-legales")}`) }
  if (!can(session, "prevention:legal:view") && !can(session, "prevention:pdtp:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/requisitos-legales")}`)
  const { id } = await params
  let detail
  try { detail = await getLegalRequirementDetail(id, { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }) }
  catch { notFound() }
  return <PageContainer width="workbench"><PageHeader title={`${detail.requirement.code} · ${detail.requirement.article}`} description="Fuente y evaluación de aplicabilidad del requisito." breadcrumb={<Breadcrumbs items={[{ label: "Requisitos legales", href: "/prevencion/requisitos-legales" }, { label: detail.requirement.code }]} />} />
    <div className="space-y-4"><section className="rounded-lg border p-5"><div className="flex gap-2"><MetaBadge meta={{ label: detail.inForce ? "Vigente" : detail.requirement.status === "published" ? "Vigencia terminada" : LEGAL_REQUIREMENT_STATUS_LABELS[detail.requirement.status] ?? detail.requirement.status, variant: legalStatusVariant(detail.inForce ? detail.requirement.status : "superseded") }} /><MetaBadge meta={{ label: SOURCE_TYPE[detail.requirement.sourceType] ?? detail.requirement.sourceType, variant: "default" }} /><MetaBadge meta={{ label: `Vigencia ${formatDate(detail.requirement.validFrom)}${detail.requirement.validTo ? ` a ${formatDate(detail.requirement.validTo)}` : " en adelante"}`, variant: "outline" }} /></div><h2 className="mt-3 text-lg font-semibold">{detail.requirement.requirement}</h2><p className="mt-2 text-sm">{detail.requirement.authority} · {detail.requirement.sourceTitle} · {detail.requirement.sourceReference}</p><p className="mt-1 text-sm text-[var(--color-text-subtle)]">Rol de Chome: {detail.requirement.chomeRole}</p></section><section className="rounded-lg border p-5"><h2 className="font-semibold">Aplicabilidad en tu alcance</h2><div className="mt-3 space-y-2">{detail.applicabilities.length === 0 ? <p className="text-sm text-[var(--color-text-subtle)]">Sin decisiones visibles.</p> : detail.applicabilities.map(({ applicability, worksiteName }) => <div key={applicability.id} className="rounded border p-3 text-sm"><div className="flex gap-2"><strong>{worksiteName}</strong><MetaBadge meta={{ label: LEGAL_APPLICABILITY_STATUS_LABELS[applicability.applicabilityStatus] ?? applicability.applicabilityStatus, variant: legalStatusVariant(applicability.applicabilityStatus) }} /><MetaBadge meta={{ label: LEGAL_COMPLIANCE_STATUS_LABELS[applicability.complianceStatus] ?? applicability.complianceStatus, variant: legalStatusVariant(applicability.complianceStatus) }} /></div><p className="mt-1">{applicability.rationale}</p><p className="mt-1 text-[var(--color-text-subtle)]">Evidencia: {applicability.evidenceReference ?? "pendiente"}</p></div>)}</div></section></div>
  </PageContainer>
}
