import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPpa, getPpaCorrectiveAction, getPpaStatusHistory } from "@/lib/services/ppa"
import { getCapaActionBundle } from "@/lib/services/prevention-capa"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Badge } from "@/components/ui/badge"
import { cn, formatDateTime } from "@/lib/utils"
import { estadoPpaLabel, estadoPpaBadgeVariant, decisionPpaLabel, isPendienteRevision } from "@/lib/ppa/badges"
import {
  PPA_STOP_REASON_LABELS, PPA_COMPLEMENTARIAS, controlLabel, tipoTrabajoLabel,
  type EstadoPpa, type PpaStopReason, type PpaAnswers,
} from "@/lib/ppa/types"
import { ReviewPanel } from "./review-panel"
import { PpaWorkflowPanel } from "./ppa-workflow-panel"
import { RevokeTokenButton } from "./revoke-token-button"
import { scopeToIds } from "@/lib/ppa/utils"
import { readPpaReturnHref } from "../list-filters"

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
  try { return formatDateTime(iso) }
  catch { return "Fecha no disponible" }
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
          <li key={`${e.title}:${e.time}`} className="flex gap-3">
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

export default async function PpaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ returnTo?: string | string[] }>
}) {
  const { id } = await params
  const { returnTo } = await searchParams
  const listHref = readPpaReturnHref(returnTo)

  let session
  try { session = await requirePermission("ppa:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/ppa")}`) }

  const worksiteIds = scopeToIds(resolveWorksiteScope(session))
  const ppa = await getPpa(id, worksiteIds)
  if (!ppa) notFound()
  const scope = resolveWorksiteScope(session)
  const [correctiveAction, persistedHistory] = await Promise.all([
    getPpaCorrectiveAction(id, worksiteIds),
    getPpaStatusHistory(id, worksiteIds),
  ])
  const capaBundle = correctiveAction?.capaActionId && can(session, "prevention:capa:view")
    ? await getCapaActionBundle({
      actionId: correctiveAction.capaActionId,
      scope,
      permissions: session.user.permissions,
    })
    : null

  const answers = ppa.answersJson as PpaAnswers
  const reasons = (ppa.triggeredReasons as PpaStopReason[] | null) ?? []
  const canReview = can(session, "ppa:review")
  const pendiente = isPendienteRevision(ppa.estado)
  const detenido = ppa.resultado === "detenido"
  const timeline: { title: string; time: string; sub?: string; tone: TimelineTone }[] = persistedHistory.length > 0
    ? persistedHistory.map((event) => ({
      title: estadoPpaLabel(event.toStatus),
      time: fmtDateTime(event.createdAt),
      sub: [event.actorType === "system" ? "Sistema" : event.actorName ?? "Usuario histórico", event.reason]
        .filter(Boolean).join(" · "),
      tone: event.toStatus === "autorizado" || event.toStatus === "cerrado" || event.toStatus === "aprobado_auto"
        ? "success"
        : event.toStatus === "detenido" || event.toStatus === "rechazado" || event.toStatus === "cancelado"
          ? "danger"
          : "warning",
    }))
    : [
      { title: "PPA enviado", time: fmtDateTime(ppa.createdAt), tone: "neutral" },
      {
        title: detenido ? "Trabajo detenido (automático)" : "Aprobado automáticamente",
        time: fmtDateTime(ppa.createdAt),
        tone: detenido ? "danger" : "success",
      },
    ]

  return (
    <PageContainer>
      <PageHeader
        title={`PPA — ${ppa.workerName}`}
        description={`${tipoTrabajoLabel(ppa.tipoTrabajo)} · ${ppa.worksiteName ?? "—"}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Para, Piensa y Actúa", href: listHref },
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
              <Row label="Fecha y hora" value={fmtDateTime(ppa.createdAt)} />
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
                <Row label="Revisado" value={ppa.reviewedAt ? fmtDateTime(ppa.reviewedAt) : "—"} />
              </dl>
              {correctiveAction && (
                <div className="mt-3 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3">
                  <p className="text-sm font-medium">
                    {correctiveAction.status === "verificada" || correctiveAction.status === "cerrada"
                      ? "Acción correctiva verificada"
                      : "Acción correctiva pendiente de verificación"}
                  </p>
                  <dl className="mt-2">
                    <Row label="Responsable" value={`${correctiveAction.responsible} · ${correctiveAction.responsibleRole === "admin_contrato" ? "Supervisor de faena" : correctiveAction.responsibleRole === "prevencionista_faena" ? "Prevencionista de faena" : correctiveAction.responsibleRole === "prevencionista" ? "Jefa Dpto. Prevención" : "Jefe de faena"}`} />
                    <Row label="Plazo" value={correctiveAction.dueDate} />
                    <Row label="Prioridad" value={correctiveAction.priority} />
                    <Row label="Estado" value={correctiveAction.status} />
                    {capaBundle && <Row label="CAPA común" value={`${capaBundle.action.code} · ${capaBundle.action.status}`} />}
                    {capaBundle && <Row label="Evidencias verificables" value={capaBundle.evidence.filter((item) => item.kind !== "note").length} />}
                  </dl>
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

          <PpaWorkflowPanel
            ppaId={ppa.id}
            ppaVersion={ppa.version}
            status={ppa.estado as EstadoPpa}
            verified={Boolean(ppa.verifiedAt)}
            capa={capaBundle ? {
              id: capaBundle.action.id,
              version: capaBundle.action.version,
              status: capaBundle.action.status,
              evidenceCount: capaBundle.evidence.filter((item) => item.kind !== "note").length,
            } : null}
            canCorrect={can(session, "ppa:correct")}
            canVerify={can(session, "ppa:verify")}
            canAuthorize={can(session, "ppa:authorize_restart")}
            canCancel={can(session, "ppa:cancel")}
            canClose={can(session, "ppa:close")}
          />

          {/* Trazabilidad */}
          <Timeline events={timeline} />

          {/* Gestión del enlace público */}
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
            <h2 className="mb-2 text-sm font-semibold">Enlace público</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              El trabajador accede al resultado vía QR o enlace sin iniciar sesión.
              Puedes revocar el acceso si el enlace fue compartido indebidamente.
            </p>
            {can(session, "ppa:manage") && (
              <RevokeTokenButton ppaId={ppa.id} revoked={!!ppa.publicTokenRevokedAt} />
            )}
          </section>
        </div>
      </div>
    </PageContainer>
  )
}
