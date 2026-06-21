import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listPpa, getPpaStats } from "@/lib/services/ppa"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { PPA_STOP_REASON_LABELS, tipoTrabajoLabel, type PpaStopReason } from "@/lib/ppa/types"
import { PpaList } from "./ppa-list"

export const metadata: Metadata = { title: "PPA Digital" }

function scopeIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  return scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: "danger" | "success" | "warning" }) {
  const color =
    tone === "danger" ? "text-[var(--color-danger)]" :
    tone === "success" ? "text-[var(--color-success)]" :
    tone === "warning" ? "text-[var(--color-warning)]" : ""
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <p className="text-xs text-[var(--color-text-subtle)]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

export default async function PpaPanelPage() {
  let session
  try { session = await requirePermission("ppa:view") }
  catch { redirect("/forbidden") }

  const worksiteIds = scopeIds(resolveWorksiteScope(session))
  const [rows, stats] = await Promise.all([
    listPpa({ worksiteIds }, 100, 0),
    getPpaStats(worksiteIds),
  ])
  const canReview = can(session, "ppa:review")
  const canExport = can(session, "ppa:manage")

  return (
    <PageContainer>
      <PageHeader
        title="PPA Digital"
        description="Para, Piensa y Actúa — evaluaciones preventivas, trabajos detenidos e indicadores."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "PPA Digital" },
          ]} />
        }
        headerActions={
          canExport ? (
            <Button asChild variant="secondary">
              <a href="/api/prevencion/ppa/export">Exportar XLSX</a>
            </Button>
          ) : undefined
        }
      />

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total PPA" value={stats.total} />
        <StatCard label="Trabajos detenidos" value={stats.detenidos} tone="danger" />
        <StatCard label="Pendientes de revisión" value={stats.pendientes} tone="warning" />
        <StatCard label="Aprobados automáticamente" value={stats.aprobadosAuto} tone="success" />
        <StatCard label="Autorizados por revisor" value={stats.autorizados} tone="success" />
        <StatCard label="Rechazados" value={stats.rechazados} tone="danger" />
        <StatCard label="% con desviaciones" value={`${stats.porcentajeDesviaciones}%`} />
      </div>

      {(stats.topReasons.length > 0 || stats.topTareas.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {stats.topReasons.length > 0 && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
              <h3 className="mb-2 text-sm font-semibold">Motivos de alerta más frecuentes</h3>
              <ul className="space-y-1 text-sm text-[var(--color-text-muted)]">
                {stats.topReasons.map((r) => (
                  <li key={r.reason} className="flex justify-between gap-2">
                    <span>{PPA_STOP_REASON_LABELS[r.reason as PpaStopReason] ?? r.reason}</span>
                    <span className="font-medium">{r.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {stats.topTareas.length > 0 && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
              <h3 className="mb-2 text-sm font-semibold">Tareas con más PPA</h3>
              <ul className="space-y-1 text-sm text-[var(--color-text-muted)]">
                {stats.topTareas.map((t) => (
                  <li key={t.tipoTrabajo} className="flex justify-between gap-2">
                    <span>{tipoTrabajoLabel(t.tipoTrabajo)}</span>
                    <span className="font-medium">{t.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <PpaList initialRows={rows} canReview={canReview} />
    </PageContainer>
  )
}
