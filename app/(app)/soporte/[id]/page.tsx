import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { getReport, getReportAttachments, getReportEvents } from "@/lib/services/feedback"
import { canAccessFeedbackIndex, canAccessFeedbackReport } from "@/lib/services/feedback-access"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { StateBadge } from "@/components/states/state-badge"
import { FEEDBACK_TIPO_LABELS } from "@/components/states/state-badge"
import type { FeedbackEstado, FeedbackTipo } from "@/lib/validation/feedback"
import { FEEDBACK_ESTADO_LABELS } from "@/lib/validation/feedback"
import { StatusPanel } from "./status-panel"
import { formatDateTime } from "@/lib/utils"

export const metadata: Metadata = { title: "Detalle de reporte (Soporte)" }

interface Props {
  params: Promise<{ id: string }>
}

function eventLabel(event: { eventType: string; fromEstado: string | null; toEstado: string | null }) {
  if (event.eventType === "created") return "Reporte creado"
  if (event.eventType === "note_added") return "Nota interna agregada"
  const from = FEEDBACK_ESTADO_LABELS[event.fromEstado as FeedbackEstado] ?? event.fromEstado ?? "Sin estado"
  const to = FEEDBACK_ESTADO_LABELS[event.toEstado as FeedbackEstado] ?? event.toEstado ?? "Sin estado"
  return `Estado: ${from} → ${to}`
}

export default async function ReporteDetailPage({ params }: Props) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/soporte")}`) }
  if (!canAccessFeedbackIndex(session)) {
    redirect(`/forbidden?desde=${encodeURIComponent("/soporte")}`)
  }

  const { id } = await params
  // SOP-002: el permiso se resuelve ANTES de leer, porque ahora es lo que
  // decide si el servicio entrega la nota interna. Antes la nota venía siempre
  // y la vista la escondía.
  const canManage   = can(session, "feedback:manage")
  const report = await getReport(id, canManage)
  if (!report) notFound()

  if (!canAccessFeedbackReport(session, report)) {
    redirect(`/forbidden?desde=${encodeURIComponent("/soporte")}`)
  }
  const [attachmentList, eventList] = await Promise.all([
    getReportAttachments(report.id),
    getReportEvents(report.id),
  ])
  const visibleEvents = canManage ? eventList : eventList.filter((event) => event.eventType !== "note_added")

  const tipoLabel = FEEDBACK_TIPO_LABELS[report.tipo as FeedbackTipo] ?? report.tipo

  return (
    <PageContainer>
      <PageHeader
        title={report.titulo}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Soporte",   href: "/soporte" },
            { label: report.titulo },
          ]} />
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Contenido principal ─────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-sub text-sm">{tipoLabel}</span>
                <StateBadge state={report.estado as FeedbackEstado} entity="feedback" />
              </div>

              <div>
                <p className="text-sm font-medium text-[var(--color-text-subtle)] mb-1">Descripción</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{report.descripcion}</p>
              </div>

              {report.pagina && (
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-subtle)] mb-1">Página / sección</p>
                  <code className="text-xs bg-[var(--color-bg-subtle)] px-2 py-1 rounded">
                    {report.pagina}
                  </code>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Nota interna — visible solo a gestores */}
          {canManage && report.notaInterna && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Nota interna</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap text-[var(--color-text-subtle)]">
                  {report.notaInterna}
                </p>
              </CardContent>
            </Card>
          )}

          {attachmentList.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Adjuntos</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {attachmentList.map((attachment) => (
                    <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <a
                        href={`/api/soporte/adjuntos/${attachment.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-[var(--color-accent-ink)] underline underline-offset-2"
                      >
                        {attachment.fileName}
                      </a>
                      <span className="text-xs text-[var(--color-text-subtle)]">
                        {attachment.mimeType ?? "Archivo adjunto"}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {visibleEvents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Historial</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4">
                  {visibleEvents.map((event) => (
                    <li key={event.id} className="border-l-2 border-[var(--color-border)] pl-3">
                      <p className="text-sm font-medium">{eventLabel(event)}</p>
                      <p className="text-xs text-[var(--color-text-subtle)]">
                        {event.actorName ?? "Usuario"} · {formatDateTime(event.createdAt)}
                      </p>
                      {canManage && event.note && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-text-subtle)]">
                          {event.note}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Información</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-[var(--color-text-subtle)]">Autor</p>
                <p className="font-medium">{report.authorName}</p>
              </div>
              <div>
                <p className="text-[var(--color-text-subtle)]">Enviado</p>
                <p>{formatDateTime(report.createdAt)}</p>
              </div>
              {report.resolvedAt && (
                <div>
                  <p className="text-[var(--color-text-subtle)]">Resuelto</p>
                  <p>{formatDateTime(report.resolvedAt)}</p>
                </div>
              )}
              <div>
                <p className="text-[var(--color-text-subtle)]">Prioridad</p>
                <p className="capitalize">{report.priority}</p>
              </div>
              <div>
                <p className="text-[var(--color-text-subtle)]">SLA</p>
                <p>{report.dueAt ? formatDateTime(report.dueAt) : "—"}</p>
              </div>
            </CardContent>
          </Card>

          {/* Panel de gestión — solo gestores */}
          {canManage && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Gestión</CardTitle>
              </CardHeader>
              <CardContent>
                <StatusPanel
                  reportId={report.id}
                  currentEstado={report.estado as FeedbackEstado}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
