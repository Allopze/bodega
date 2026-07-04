import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { getReport } from "@/lib/services/feedback"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { StateBadge } from "@/components/states/state-badge"
import { FEEDBACK_TIPO_LABELS } from "@/components/states/state-badge"
import type { FeedbackEstado, FeedbackTipo } from "@/lib/validation/feedback"
import { StatusPanel } from "./status-panel"

export const metadata: Metadata = { title: "Detalle de reporte — Soporte" }

interface Props {
  params: Promise<{ id: string }>
}

export default async function ReporteDetailPage({ params }: Props) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "feedback:view_own") && !can(session, "feedback:view_all") && !can(session, "feedback:manage")) {
    redirect("/forbidden")
  }

  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const canManage   = can(session, "feedback:manage")
  const canViewAll  = can(session, "feedback:view_all")
  const isOwn       = report.createdBy === session.user.id

  // Non-managers can only see their own reports
  if (!canViewAll && !isOwn) redirect("/forbidden")

  const tipoLabel = FEEDBACK_TIPO_LABELS[report.tipo as FeedbackTipo] ?? report.tipo

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("es-CL", {
      day:    "2-digit",
      month:  "short",
      year:   "numeric",
      hour:   "2-digit",
      minute: "2-digit",
    })
  }

  return (
    <PageContainer>
      <PageHeader
        title={report.titulo}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
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
                <p>{formatDate(report.createdAt)}</p>
              </div>
              {report.resolvedAt && (
                <div>
                  <p className="text-[var(--color-text-subtle)]">Resuelto</p>
                  <p>{formatDate(report.resolvedAt)}</p>
                </div>
              )}
              <div>
                <p className="text-[var(--color-text-subtle)]">Prioridad</p>
                <p className="capitalize">{report.priority}</p>
              </div>
              <div>
                <p className="text-[var(--color-text-subtle)]">SLA</p>
                <p>{report.dueAt ? formatDate(report.dueAt) : "—"}</p>
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
                  currentNota={report.notaInterna}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
