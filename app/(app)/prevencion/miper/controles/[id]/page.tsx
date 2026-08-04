import { notFound, redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getRiskControlDetail } from "@/lib/services/prevention-risk-legal"
import { Badge } from "@/components/ui/badge"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

const CONTROL_STATUS: Record<string, string> = {
  planned: "Planificado",
  implemented: "Implementado",
  verified: "Verificado",
  ineffective: "Ineficaz",
}

const CONTROL_HIERARCHY: Record<string, string> = {
  elimination: "Eliminación",
  substitution: "Sustitución",
  engineering: "Control de ingeniería",
  administrative: "Control administrativo",
  ppe: "Equipo de protección personal",
}

const RISK_LEVEL: Record<string, string> = {
  low: "Bajo",
  moderate: "Moderado",
  medium: "Medio",
  high: "Alto",
  critical: "Crítico",
}

export default async function RiskControlDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/miper/controles")}`) }
  if (!can(session, "prevention:risk:view") && !can(session, "prevention:pdtp:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/miper/controles")}`)
  const { id } = await params
  let detail
  try { detail = await getRiskControlDetail(id, { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }) }
  catch { notFound() }
  return <PageContainer width="form"><PageHeader title="Control MIPER" description="Fuente versionada de una medida preventiva." breadcrumb={<Breadcrumbs items={[{ label: "MIPER", href: "/prevencion/miper" }, { label: detail.control.description }]} />} />
    <div className="space-y-4"><section className="rounded-lg border p-5"><div className="flex gap-2"><Badge variant={detail.control.isCritical ? "danger" : "default"}>{detail.control.isCritical ? "Control crítico" : "Control"}</Badge><Badge variant={detail.control.status === "verified" ? "success" : "warning"}>{CONTROL_STATUS[detail.control.status] ?? detail.control.status}</Badge></div><h2 className="mt-3 text-lg font-semibold">{detail.control.description}</h2><p className="mt-2 text-sm">Peligro: {detail.entry.hazard} · riesgo residual {RISK_LEVEL[detail.entry.residualLevel] ?? detail.entry.residualLevel}</p><p className="mt-1 text-sm text-[var(--color-text-subtle)]">{detail.worksiteName} → {detail.process.name} → {detail.task.name} → {detail.position.name}</p></section><section className="rounded-lg border p-5"><h2 className="font-semibold">Desempeño y trazabilidad</h2><dl className="mt-3 grid gap-3 text-sm md:grid-cols-2"><div><dt className="text-[var(--color-text-subtle)]">Jerarquía</dt><dd>{CONTROL_HIERARCHY[detail.control.hierarchy] ?? detail.control.hierarchy}</dd></div><div><dt className="text-[var(--color-text-subtle)]">Responsable</dt><dd>{detail.control.responsibleSnapshot}</dd></div><div><dt className="text-[var(--color-text-subtle)]">Estándar</dt><dd>{detail.control.performanceStandard ?? "No definido"}</dd></div><div><dt className="text-[var(--color-text-subtle)]">Frecuencia</dt><dd>{detail.control.verificationFrequency ?? "No definida"}</dd></div><div><dt className="text-[var(--color-text-subtle)]">MIPER</dt><dd>v{detail.matrix.matrixVersion} · {detail.matrix.publishedHashSha256?.slice(0, 16)}…</dd></div><div><dt className="text-[var(--color-text-subtle)]">Cobertura PDTP</dt><dd>{detail.links.length} vínculo(s)</dd></div></dl></section></div>
  </PageContainer>
}
