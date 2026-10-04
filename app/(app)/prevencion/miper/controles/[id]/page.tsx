import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getRiskControlDetail } from "@/lib/services/prevention-risk-legal"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { RISK_CLASSIFICATIONS, type RiskClassification } from "@/lib/prevention/miper/methodology"
import { riskLevelLabel } from "@/lib/prevention/risk-levels"
import { MetaBadge } from "@/components/states/state-badge"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { DetailItem } from "@/components/ui/detail-item"
import { PageContainer } from "@/components/ui/page-container"
import { formatDateTime } from "@/lib/utils"
import { VerifyControlForm } from "./verify-control-form"

const CONTROL_STATUS: Record<string, string> = {
  // 'proposed' y 'retired' faltaban y son estados reales de la tabla: un control
  // recién importado caía al `?? status` y se mostraba "proposed" en crudo.
  proposed: "Propuesto",
  implemented: "Implementado",
  verified: "Verificado",
  ineffective: "Ineficaz",
  retired: "Retirado",
}

const CONTROL_HIERARCHY: Record<string, string> = {
  elimination: "Eliminación",
  substitution: "Sustitución",
  engineering: "Control de ingeniería",
  administrative: "Control administrativo",
  ppe: "Equipo de protección personal",
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
  // Mismas identidades que valida `verifyRiskControl`: creador de la versión y
  // responsables del control y del peligro.
  const conflicted = [detail.matrix.createdByUserId, detail.control.responsibleUserId, detail.entry.responsibleUserId].includes(session.user.id)
  const canVerify = can(session, "prevention:risk:edit") && detail.matrix.status === "published" && detail.control.status !== "retired"
  // La clasificación RE-04 es la columna generada de la fila (P×C); sólo las filas legacy, sin P×C, traen un nivel residual en texto.
  const classification = detail.entry.classification && (RISK_CLASSIFICATIONS as readonly string[]).includes(detail.entry.classification) ? detail.entry.classification as RiskClassification : null
  const matrixHref = `/prevencion/miper/${detail.matrix.id}`
  const breadcrumb = [
    { label: "Prevención", href: "/prevencion" },
    { label: "MIPER", href: "/prevencion/miper" },
    { label: `${detail.worksiteName}${detail.matrix.period ? ` ${detail.matrix.period}` : ""}`, href: matrixHref },
    { label: detail.entry.rowNumber ? `Riesgo #${detail.entry.rowNumber}` : "Riesgo", href: `${matrixHref}?fila=${encodeURIComponent(detail.entry.id)}` },
    { label: detail.control.description },
  ]
  return (
    <PageContainer width="workbench">
      <PageHeader title="Verificación de una medida" description="Comprueba si la medida funciona y consulta el registro que respalda esa verificación."
        breadcrumb={<Breadcrumbs items={breadcrumb} />}
        actions={canVerify ? <VerifyControlForm controlId={detail.control.id} expectedVersion={detail.control.version} conflicted={conflicted} canOverride={can(session, "prevention:risk:override_segregation")} /> : undefined} />
      <div className="space-y-5">
        <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex gap-2">
            <MetaBadge meta={{ label: detail.control.isCritical ? "Control crítico" : "Medida preventiva", variant: detail.control.isCritical ? "danger" : "default" }} />
            <MetaBadge meta={{ label: CONTROL_STATUS[detail.control.status] ?? detail.control.status, variant: detail.control.status === "verified" ? "success" : "warning" }} />
          </div>
          <h2 className="text-h2">{detail.control.description}</h2>
          <p className="text-sm">Peligro: {detail.entry.hazard ?? "Sin identificar"}</p>
          <p className="text-sm text-[var(--color-text-muted)]">{detail.worksiteName} · {detail.process?.name ?? "Sin actividad"} · {detail.task?.name ?? "Sin tarea"}</p>
          <div>{classification || !detail.entry.residualLevel
            ? <RiskClassificationBadge classification={classification} magnitude={detail.entry.magnitude} />
            : <span className="text-sm">Riesgo {riskLevelLabel(detail.entry.residualLevel)}</span>}</div>
          <dl className="grid gap-3 md:grid-cols-2">
            <DetailItem label="Responsable de la medida" value={detail.control.responsibleSnapshot ?? "Sin responsable"} layout="stacked" />
            <DetailItem label="Última verificación" value={detail.control.lastVerifiedAt ? formatDateTime(detail.control.lastVerifiedAt) : "Sin verificar"} layout="stacked" />
            <DetailItem label="Qué debe cumplir" value={detail.control.performanceStandard ?? "Estándar no definido"} layout="stacked" />
            <DetailItem label="Cada cuánto se verifica" value={detail.control.verificationFrequency ?? "Frecuencia no definida"} layout="stacked" />
          </dl>
          <Button asChild size="sm" variant="secondary"><Link href={`${matrixHref}?fila=${encodeURIComponent(detail.entry.id)}&paso=medidas`}>Volver al riesgo y sus medidas</Link></Button>
        </section>
        <section className="space-y-3" aria-labelledby="control-evidence-title">
          <h2 id="control-evidence-title" className="text-h3">Evidencia de la verificación</h2>
          <p className="text-sm text-[var(--color-text-muted)]">Este registro respalda que la medida se comprobó. La evidencia de una ejecución del programa demuestra que una actividad se realizó; son comprobaciones distintas.</p>
          <p className="break-words rounded-xl bg-[var(--color-surface-2)] p-4 text-sm">{detail.control.evidenceReference ?? "Todavía no hay una referencia de evidencia registrada."}</p>
          {detail.control.evidenceReference && <p className="text-xs text-[var(--color-text-muted)]">La referencia se conserva tal como fue registrada. Consulta el acta, foto o checklist indicado con la persona que verificó la medida.</p>}
        </section>
        <section className="space-y-2" aria-labelledby="control-pdtp-title">
          <h2 id="control-pdtp-title" className="text-h3">Actividades del programa preventivo (PDTP)</h2>
          <p className="text-sm text-[var(--color-text-muted)]">{detail.links.length > 0
            ? `Esta medida tiene ${detail.links.length} ${detail.links.length === 1 ? "vínculo activo" : "vínculos activos"} con actividades del programa preventivo. Consulta la cobertura para ver sus fuentes.`
            : "Esta medida todavía no está vinculada a una actividad del programa preventivo."}</p>
          {can(session, "prevention:pdtp:view") && detail.linkedActivities.length > 0 && (
            <ul className="space-y-1 text-sm">{detail.linkedActivities.map((activity) => <li key={activity.id}><span className="font-mono text-xs tabular-nums">N° {activity.n}</span> · {activity.activity}</li>)}</ul>
          )}
          {can(session, "prevention:pdtp:view") && <Button asChild size="sm" variant="secondary"><Link href="/prevencion/pdtp/cobertura">Consultar cobertura del programa</Link></Button>}
        </section>
        <details className="rounded-xl border border-[var(--color-border)] p-4">
          <summary className="cursor-pointer text-sm font-medium">Trazabilidad y datos técnicos</summary>
          <dl className="mt-3 grid gap-3 md:grid-cols-2">
            <DetailItem label="Tipo de medida" value={CONTROL_HIERARCHY[detail.control.hierarchy] ?? detail.control.hierarchy} layout="stacked" />
            <DetailItem label="Puesto" value={detail.position?.name ?? "Sin puesto"} layout="stacked" />
            <DetailItem label="Versión de la matriz" value={`v${detail.matrix.matrixVersion}`} layout="stacked" />
            <DetailItem label="Huella de la versión" value={detail.matrix.publishedHashSha256 ?? "Sin huella registrada"} layout="stacked" className="break-all" />
          </dl>
        </details>
      </div>
    </PageContainer>
  )
}
