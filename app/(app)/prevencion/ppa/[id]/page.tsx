import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPpa } from "@/lib/services/ppa"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Badge } from "@/components/ui/badge"
import { estadoPpaLabel, estadoPpaBadgeVariant, decisionPpaLabel, isPendienteRevision } from "@/lib/ppa/badges"
import {
  PPA_STOP_REASON_LABELS, PPA_COMPLEMENTARIAS, controlLabel, tipoTrabajoLabel,
  type PpaStopReason, type PpaAnswers,
} from "@/lib/ppa/types"
import { ReviewPanel } from "./review-panel"

export const metadata: Metadata = { title: "Detalle PPA" }

function scopeIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  return scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--color-border)] py-2 last:border-0">
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  )
}

export default async function PpaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let session
  try { session = await requirePermission("ppa:view") }
  catch { redirect("/forbidden") }

  const worksiteIds = scopeIds(resolveWorksiteScope(session))
  const ppa = await getPpa(id, worksiteIds)
  if (!ppa) notFound()

  const answers = ppa.answersJson as PpaAnswers
  const reasons = (ppa.triggeredReasons as PpaStopReason[] | null) ?? []
  const canReview = can(session, "ppa:review")
  const pendiente = isPendienteRevision(ppa.estado)

  return (
    <PageContainer>
      <PageHeader
        title={`PPA — ${ppa.workerName}`}
        description={`${tipoTrabajoLabel(ppa.tipoTrabajo)} · ${ppa.worksiteName ?? "—"}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "PPA Digital", href: "/prevencion/ppa" },
            { label: ppa.workerName },
          ]} />
        }
        headerActions={
          <Badge variant={estadoPpaBadgeVariant(ppa.estado)}>{estadoPpaLabel(ppa.estado)}</Badge>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Identificación / contexto */}
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
            <h2 className="mb-2 text-sm font-semibold">Identificación y contexto</h2>
            <dl>
              <Row label="Trabajador" value={
                <span>
                  {ppa.workerName}
                  {ppa.manualIdentificacion && (
                    <Badge variant="warning" size="sm" className="ml-2">Identificación manual — validar</Badge>
                  )}
                </span>
              } />
              <Row label="RUT" value={ppa.workerRut} />
              <Row label="Empresa" value={ppa.workerCompany} />
              <Row label="Faena" value={ppa.worksiteName} />
              <Row label="Tarea declarada" value={tipoTrabajoLabel(ppa.tipoTrabajo)} />
              <Row label="¿Tarea crítica?" value={ppa.esCritica ? "Sí" : "No"} />
              <Row label="Fecha y hora" value={new Date(ppa.createdAt).toLocaleString("es-CL")} />
            </dl>
          </section>

          {/* Respuestas */}
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
            <h2 className="mb-2 text-sm font-semibold">Respuestas del PPA</h2>
            <dl>
              <Row label="¿Cambio respecto a lo planificado?" value={answers.cambioPlanificado === "si" ? "Sí" : "No"} />
              {answers.cambioPlanificado === "si" && <Row label="¿Qué cambió?" value={answers.cambioDescripcion} />}
              <Row label="¿Peligro no controlado?" value={answers.peligroNoControlado === "si" ? "Sí" : "No"} />
              {answers.peligroNoControlado === "si" && <Row label="¿Cuál es el peligro?" value={answers.peligroDescripcion} />}
              <Row label="Controles implementados" value={
                answers.controles?.length ? answers.controles.map(controlLabel).join(", ") : "Ninguno"
              } />
              <Row label="¿Es seguro comenzar?" value={answers.seguroComenzar === "si" ? "Sí" : "No"} />
            </dl>
          </section>

          {/* Complementarias */}
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
            <h2 className="mb-2 text-sm font-semibold">Para, Piensa y Actúa</h2>
            <dl>
              {PPA_COMPLEMENTARIAS.map((q) => (
                <Row key={q.key} label={q.label} value={answers.complementarias?.[q.key]} />
              ))}
            </dl>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          {/* Resultado / motivos */}
          <section className={
            "rounded-lg border p-4 " +
            (ppa.resultado === "detenido"
              ? "border-[var(--color-danger)] bg-[var(--color-danger-tint)]"
              : "border-[var(--color-success)] bg-[var(--color-success-tint)]")
          }>
            <h2 className="mb-1 text-sm font-semibold">
              {ppa.resultado === "detenido" ? "Trabajo detenido" : "Aprobado automáticamente"}
            </h2>
            {reasons.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {reasons.map((r) => <li key={r}>{PPA_STOP_REASON_LABELS[r] ?? r}</li>)}
              </ul>
            )}
          </section>

          {/* Intervención del responsable */}
          {ppa.decision ? (
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
              <h2 className="mb-2 text-sm font-semibold">Intervención del responsable</h2>
              <dl>
                <Row label="Decisión" value={decisionPpaLabel(ppa.decision)} />
                <Row label="¿Fue al lugar?" value={ppa.fuiAlLugar ? "Sí" : "No"} />
                <Row label="Acción correctiva" value={ppa.accionCorrectiva} />
                <Row label="Nota" value={ppa.reviewNota} />
                <Row label="Revisado" value={ppa.reviewedAt ? new Date(ppa.reviewedAt).toLocaleString("es-CL") : "—"} />
              </dl>
            </section>
          ) : canReview && pendiente ? (
            <ReviewPanel ppaId={ppa.id} detenido={ppa.resultado === "detenido"} />
          ) : pendiente ? (
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-text-muted)]">
              Este PPA está pendiente de revisión por un responsable autorizado.
            </section>
          ) : null}
        </div>
      </div>
    </PageContainer>
  )
}
