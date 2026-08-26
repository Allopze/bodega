import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getRiskEntryBundle } from "@/lib/services/prevention-risk-legal"
import { firstControlDescription } from "@/lib/services/prevention-risk-capa"
import { RISK_CLASSIFICATION_LABEL, RISK_CLASSIFICATION_BADGE_VARIANT, type RiskClassification } from "@/lib/prevention/risk-engine"
import { riskLevelLabel } from "@/lib/prevention/risk-levels"
import { CAPA_STATUS_LABELS } from "@/lib/prevention/capa"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { formatDate, formatDateTime } from "@/lib/utils"
import { GenerateCapaForm } from "./generate-capa-form"

const CONTROL_STATUS: Record<string, string> = {
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

const CONTROL_STATUS_TEXT: Record<string, string> = {
  controlled: "Sí, controlado",
  partial: "Parcialmente controlado",
  partial_immediate: "Parcialmente controlado — requiere acción inmediata",
}

export default async function RiskEntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/miper")}`) }
  if (!can(session, "prevention:risk:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/miper")}`)
  const { id } = await params
  let detail
  try { detail = await getRiskEntryBundle({ entryId: id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }) }
  catch { notFound() }
  const { entry } = detail
  const classification = entry.riskClassification as RiskClassification | null
  const divergence = entry.evaluationDivergence as { excelMagnitude?: unknown; excelClassification?: string; systemMagnitude?: number; systemClassification?: string } | null

  return <PageContainer width="form">
    <PageHeader
      title={entry.hazard}
      description="Ficha de un riesgo dentro de una versión MIPER."
      breadcrumb={<Breadcrumbs items={[{ label: "MIPER", href: "/prevencion/miper" }, { label: entry.hazardCode }]} />}
    />
    <div className="space-y-4">
      <section className="rounded-lg border p-5">
        <div className="flex flex-wrap items-center gap-2">
          {entry.isCritical && <Badge variant="danger">Crítico</Badge>}
          {classification
            ? <Badge variant={RISK_CLASSIFICATION_BADGE_VARIANT[classification]}>{RISK_CLASSIFICATION_LABEL[classification]} · MR {entry.riskMagnitude}</Badge>
            : <Badge variant="outline">Sin evaluar P×C</Badge>}
          {!entry.isRoutine && <Badge variant="outline">No rutinaria</Badge>}
        </div>
        <h2 className="mt-3 text-lg font-semibold">{entry.risk ?? "Riesgo sin especificar"}</h2>
        <p className="mt-1 text-sm text-[var(--color-text-subtle)]">Peligro: {entry.hazard} · Código {entry.hazardCode}</p>
        <p className="mt-1 text-sm text-[var(--color-text-subtle)]">{detail.worksiteName} → {detail.process.name} → {detail.task.name} → {detail.position.name}</p>
        {divergence && (
          <p role="status" className="mt-3 rounded border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-2 text-sm">
            El Excel importado traía MR {String(divergence.excelMagnitude ?? "—")} / {divergence.excelClassification ?? "—"}; el sistema calculó MR {divergence.systemMagnitude} / {divergence.systemClassification}. Prevalece el cálculo del sistema.
          </p>
        )}
        {!classification && entry.residualLevel && (
          <p className="mt-2 text-sm">Nivel heredado (previo al motor P×C): {riskLevelLabel(entry.residualLevel)}</p>
        )}
      </section>

      <section className="rounded-lg border p-5">
        <h2 className="font-semibold">Evaluación y contexto</h2>
        <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <div><dt className="text-[var(--color-text-subtle)]">Factor de riesgo</dt><dd>{entry.riskFactor}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">Daño probable</dt><dd>{entry.expectedEventOrDamage}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">Personas expuestas</dt><dd>{entry.exposedPeopleDescription}{entry.exposedPeopleCount != null ? ` (${entry.exposedPeopleCount})` : ""}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">Lugar específico</dt><dd>{entry.specificWorkplace ?? "No definido"}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">Responsable</dt><dd>{entry.responsibleSnapshot}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">Estado de control</dt><dd>{entry.controlStatusText ? CONTROL_STATUS_TEXT[entry.controlStatusText] : "No definido"}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">Plazo</dt><dd>{entry.controlDeadlineText ?? "No definido"}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">Evidencia</dt><dd>{entry.evidenceReference ?? "Sin evidencia registrada"}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">MIPER</dt><dd>v{detail.matrix.matrixVersion} · {detail.matrix.status}</dd></div>
        </dl>
      </section>

      <section className="rounded-lg border p-5">
        <h2 className="font-semibold">Controles ({detail.controls.length})</h2>
        {detail.controls.length === 0
          ? <p className="mt-2 text-sm text-[var(--color-text-subtle)]">Sin medidas de control registradas.</p>
          : <ul className="mt-3 space-y-2">{detail.controls.map((control) => (
            <li key={control.id} className="rounded border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {control.isCritical && <Badge variant="danger">Crítico</Badge>}
                <Badge variant={control.status === "verified" ? "success" : "warning"}>{CONTROL_STATUS[control.status] ?? control.status}</Badge>
                <span className="text-[var(--color-text-subtle)]">{CONTROL_HIERARCHY[control.hierarchy] ?? control.hierarchy}</span>
              </div>
              <p className="mt-1">{control.description}</p>
              <p className="mt-1 text-[var(--color-text-subtle)]">Responsable: {control.responsibleSnapshot}</p>
            </li>
          ))}</ul>}
      </section>

      {/* Sin `prevention:capa:view` la sección entera se omite: mostrarla con
          "(0)" afirmaría que no hay acciones, cuando lo cierto es que este rol
          no puede verlas — `getRiskEntryBundle` ya devuelve la lista vacía. */}
      {can(session, "prevention:capa:view") && (
        <section className="rounded-lg border p-5">
          <h2 className="font-semibold">Programa de Trabajo ({detail.capaActions.length})</h2>
          {detail.capaActions.length === 0
            ? <p className="mt-2 text-sm text-[var(--color-text-subtle)]">Sin acciones preventivas generadas desde este riesgo todavía.</p>
            : <ul className="mt-3 space-y-2">{detail.capaActions.map((action) => (
              <li key={action.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                <div><p className="font-medium">{action.code} · {action.actionDescription}</p><p className="text-[var(--color-text-subtle)]">Vence {formatDate(action.targetDate)}</p></div>
                <Badge variant={action.status === "verified" || action.status === "closed" ? "success" : "warning"}>{CAPA_STATUS_LABELS[action.status as keyof typeof CAPA_STATUS_LABELS] ?? action.status}</Badge>
              </li>
            ))}</ul>}
          <div className="mt-3 flex flex-wrap gap-2">
            {can(session, "prevention:capa:manage") && <GenerateCapaForm riskEntryId={entry.id} suggestedActionDescription={firstControlDescription(detail.controls)} />}
            <Button asChild variant="secondary" size="sm"><Link href={`/prevencion/capa?source=risk&worksite=${detail.matrix.worksiteId}`}>Ver en Programa de Trabajo</Link></Button>
          </div>
        </section>
      )}

      {detail.history.length > 0 && (
        <section className="rounded-lg border p-5">
          <h2 className="font-semibold">Bitácora</h2>
          <ul className="mt-3 space-y-2 text-sm">{detail.history.map((item) => (
            <li key={item.id} className="rounded border p-2"><p>{item.changeType} · {item.reason}</p><p className="text-[var(--color-text-subtle)]">{formatDateTime(item.createdAt)}</p></li>
          ))}</ul>
        </section>
      )}
    </div>
  </PageContainer>
}
