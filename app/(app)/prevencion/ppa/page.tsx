import type { Metadata } from "next"
import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listPpa, countPpa, getPpaStats, listScopedWorksites } from "@/lib/services/ppa"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { PPA_STOP_REASON_LABELS, tipoTrabajoLabel, type PpaStopReason } from "@/lib/ppa/types"
import { PpaMetricBar } from "./ppa-metric-bar"
import { PpaList } from "./ppa-list"
import { PpaAccessPanel } from "./ppa-access-panel"
import { PpaExportButton } from "./ppa-export-button"
import { scopeToIds } from "@/lib/ppa/utils"

export const metadata: Metadata = { title: "PPA Digital" }

const PAGE_SIZE = 20

function RankPanel({
  title,
  rows,
}: {
  title: string
  rows: { label: ReactNode; count: number }[]
}) {
  if (rows.length === 0) return null
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <h3 className="mb-3 text-eyebrow">{title}</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-[var(--color-text-muted)]">{r.label}</span>
              <span className="font-mono font-semibold tabular-nums">{r.count}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div
                className="h-full rounded-full bg-[var(--color-border-strong)]"
                style={{ width: `${Math.round((r.count / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default async function PpaPanelPage() {
  let session
  try { session = await requirePermission("ppa:view") }
  catch { redirect("/forbidden") }

  const worksiteIds = scopeToIds(resolveWorksiteScope(session))
  const [rows, total, stats, worksiteOptions] = await Promise.all([
    listPpa({ worksiteIds }, PAGE_SIZE, 0),
    countPpa({ worksiteIds }),
    getPpaStats(worksiteIds),
    listScopedWorksites(worksiteIds),
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
          <PpaExportButton worksites={worksiteOptions} canExport={canExport} />
        }
      />

      <PpaMetricBar stats={stats} />

      {(stats.topReasons.length > 0 || stats.topTareas.length > 0 || stats.topFaenas.length > 0) && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <RankPanel
            title="Motivos de alerta más frecuentes"
            rows={stats.topReasons.map((r) => ({
              label: PPA_STOP_REASON_LABELS[r.reason as PpaStopReason] ?? r.reason,
              count: r.count,
            }))}
          />
          <RankPanel
            title="Faenas con más desviaciones"
            rows={stats.topFaenas.map((f) => ({ label: f.worksiteName, count: f.count }))}
          />
          <RankPanel
            title="Tareas con más PPA"
            rows={stats.topTareas.map((t) => ({ label: tipoTrabajoLabel(t.tipoTrabajo), count: t.count }))}
          />
        </div>
      )}

      <PpaAccessPanel worksites={worksiteOptions} />

      <PpaList
        initialRows={rows}
        total={total}
        pageSize={PAGE_SIZE}
        worksiteOptions={worksiteOptions}
        canReview={canReview}
      />
    </PageContainer>
  )
}
