import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPpa } from "@/lib/services/ppa"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { estadoPpaLabel, estadoPpaBadgeVariant, decisionPpaLabel, isPendienteRevision } from "@/lib/ppa/badges"
import {
  PPA_STOP_REASON_LABELS, PPA_COMPLEMENTARIAS, controlLabel, tipoTrabajoLabel,
  type PpaStopReason, type PpaAnswers,
} from "@/lib/ppa/types"
import { ReviewPanel } from "./review-panel"
import { CloseCaseButton } from "./close-case-button"
import { scopeToIds } from "@/lib/ppa/utils"

export const metadata: Metadata = { title: "Detalle PPA" }

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--color-border)] py-2 last:border-0">
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  )
}

function fmtDateTime(iso: string): string {
  try { return new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) }
  catch { return iso }
}

function fmtDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m} m`
}

type TimelineTone = "neutral" | "success" | "warning" | "danger"
const DOT_TONE: Record<TimelineTone, string> = {
  neutral: "bg-[var(--color-border-strong)]",
  success: "bg-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]",
  danger:  "bg-[var(--color-danger)]",
}

function Timeline({ events }: { events: { title: string; time: string; sub?: string; tone: TimelineTone }[] }) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <h2 className="mb-3 text-sm font-semibold">Trazabilidad</h2>
      <ol className="flex flex-col">
        {events.map((e, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", DOT_TONE[e.tone])} />
              {i < events.length - 1 && <span className="w-px flex-1 bg-[var(--color-border)]" />}
            </div>
            <div className="pb-4">
              <p className="text-sm font-medium">{e.title}</p>
              <p className="text-xs text-[var(--color-text-subtle)]">
                {e.time}{e.sub ? ` · ${e.sub}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default async function PpaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let session
  try { session = await requirePermission("ppa:view") }
  catch { redirect("/forbidden") }

  const worksiteIds = scopeToIds(resolveWorksiteScope(session))
  const ppa = await getPpa(id, worksiteIds)
  if (!ppa) notFound()

  const answers = ppa.answersJson as PpaAnswers
  const reasons = (ppa.triggeredReasons as PpaStopReason[] | null) ?? []
  const canReview = can(session, "ppa:review")
  const pendiente = isPendienteRevision(ppa.estado)
  const detenido = ppa.resultado === "detenido"
  const resuelto = ppa.estado === "autorizado" || ppa.estado === "rechazado"

  // Trazabilidad: línea de tiempo del caso.
  const decisionTone: TimelineTone =
    ppa.decision === "autorizado" ? "success" : ppa.decision === "rechazado" ? "danger" : "warning"
  const timeline: { title: string; time: string; sub?: string; tone: TimelineTone }[] = [
    { title: "PPA enviado", time: fmtDateTime(ppa.createdAt), tone: "neutral" },
    {
      title: detenido ? "Trabajo detenido (automático)" : "Aprobado automáticamente",
      time: fmtDateTime(ppa.createdAt),
      tone: detenido ? "danger" : "success",
    },
  ]
  if (ppa.reviewedAt) {
    timeline.push({
      title: `Revisado — ${decisionPpaLabel(ppa.decision)}`,
      time: fmtDateTime(ppa.reviewedAt),
      sub: `respuesta en ${fmtDuration(new Date(ppa.reviewedAt).getTime() - new Date(ppa.createdAt).getTime())}`,
      tone: decisionTone,
    })
  }
  if (ppa.estado === "cerrado") {
    timeline.push({ title: "Caso cerrado", time: fmtDateTime(ppa.updatedAt), tone: "neutral" })
  }

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
              {canReview && resuelto && (
                <div className="mt-3">
                  <CloseCaseButton ppaId={ppa.id} />
                </div>
              )}
            </section>
          ) : canReview && pendiente ? (
            <ReviewPanel ppaId={ppa.id} detenido={detenido} />
          ) : pendiente ? (
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-text-muted)]">
              Este PPA está pendiente de revisión por un responsable autorizado.
            </section>
          ) : null}

          {/* Trazabilidad */}
          <Timeline events={timeline} />
        </div>
      </div>
    </PageContainer>
  )
}
