import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { getIntegrationRuns, getIntegrationsHealth } from "@/lib/services/integrations-health"
import type { IntegrationHealth, IntegrationStatus } from "@/lib/integrations/health"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { EmptyState } from "@/components/ui/empty-state"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/utils"
import { INTEGRATION_STATUS_META, RUN_OUTCOME_LABEL, parseEstadoFilter } from "./status"

export const metadata: Metadata = { title: "Integraciones" }

const CARD = "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xs"

function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${ms} ms`
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

export default async function IntegracionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  try { await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const estado = parseEstadoFilter((await searchParams).estado)
  const groups = await getIntegrationsHealth()

  const all = groups.flatMap((group) => group.jobs)
  const count = (status: IntegrationStatus) => all.filter((job) => job.status === status).length

  const stats: SummaryStat[] = [
    { key: "ok", label: "Al día", value: count("ok"), href: "/ti/integraciones?estado=ok" },
    { key: "failing", label: "Con falla", value: count("failing"), tone: "danger", href: "/ti/integraciones?estado=failing" },
    { key: "stale", label: "Detenidas", value: count("stale"), tone: "signal", href: "/ti/integraciones?estado=stale" },
    { key: "never", label: "Sin corridas", value: count("never"), href: "/ti/integraciones?estado=never" },
  ]

  const visible = groups
    .map((group) => ({ ...group, jobs: group.jobs.filter((job) => estado === null || job.status === estado) }))
    .filter((group) => group.jobs.length > 0)

  const runsByJob = new Map<string, Awaited<ReturnType<typeof getIntegrationRuns>>>(
    await Promise.all(
      visible.flatMap((group) => group.jobs).map(async (job) => [job.jobName, await getIntegrationRuns(job.jobName)] as const),
    ),
  )

  return (
    <PageContainer>
      <PageHeader
        title="Integraciones"
        description="Sincronizaciones y tareas programadas: si corrieron bien y a tiempo."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "TI", href: "/ti" }, { label: "Integraciones" }]} />}
      />
      <div className="space-y-4">
        <SummaryBar
          stats={stats}
          // Cada cifra filtra esta misma lista: sin entrada nueva en el historial ni salto de scroll.
          renderLink={({ href, className, children, ...rest }) => (
            <Link href={href} replace scroll={false} className={className} {...rest}>{children}</Link>
          )}
        />
        {estado && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <span>Mostrando: <span className="font-medium text-[var(--color-text)]">{INTEGRATION_STATUS_META[estado].label}</span></span>
            <Link href="/ti/integraciones" replace scroll={false} className="text-[var(--color-primary-ink)] hover:underline">Ver todas</Link>
          </p>
        )}

        {visible.length === 0 ? (
          <section className={CARD}>
            <EmptyState
              compact
              title="Ninguna integración en este estado"
              description="Ninguna sincronización ni tarea programada está así ahora. Quita el filtro para ver todas."
              action={<Button asChild variant="secondary" size="sm"><Link href="/ti/integraciones" replace scroll={false}>Ver todas</Link></Button>}
            />
          </section>
        ) : (
          visible.map((group) => (
            <section key={group.moduleId} className={CARD} aria-labelledby={`modulo-${group.moduleId}`}>
              <h2 id={`modulo-${group.moduleId}`} className="text-base font-semibold">{group.moduleLabel}</h2>
              <ul className="mt-4 divide-y divide-[var(--color-border)]">
                {group.jobs.map((job) => (
                  <JobRow key={job.jobName} job={job} runs={runsByJob.get(job.jobName) ?? []} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </PageContainer>
  )
}

function JobRow({ job, runs }: { job: IntegrationHealth; runs: Awaited<ReturnType<typeof getIntegrationRuns>> }) {
  const meta = INTEGRATION_STATUS_META[job.status]
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{job.label}</div>
          <div className="text-xs text-[var(--color-text-subtle)]">
            {job.lastStartedAt ? `Última corrida ${formatDateTime(job.lastStartedAt)}` : "Sin corridas en 30 días"}
            {job.failures7d > 0 && ` · ${job.failures7d} ${job.failures7d === 1 ? "falla" : "fallas"} en 7 días`}
          </div>
          {job.status === "failing" && job.lastDetail && (
            <div className="mt-1 text-xs text-[var(--color-danger-ink)]">{job.lastDetail}</div>
          )}
        </div>
        <MetaBadge meta={meta} title={meta.hint} />
      </div>
      {runs.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-[var(--color-primary-ink)]">Últimas corridas</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Últimas corridas de {job.label}</caption>
              <thead>
                <tr className="text-left text-xs text-[var(--color-text-subtle)]">
                  <th scope="col" className="py-2 pr-4 font-medium">Inicio</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Resultado</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Duración</th>
                  <th scope="col" className="py-2 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {runs.map((run) => (
                  <tr key={`${run.jobName}-${run.startedAt}`}>
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(run.startedAt)}</td>
                    <td className={`py-2 pr-4 ${run.outcome === "failed" ? "text-[var(--color-danger-ink)]" : ""}`}>{RUN_OUTCOME_LABEL[run.outcome] ?? run.outcome}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">{formatDuration(run.durationMs)}</td>
                    <td className="max-w-[360px] truncate py-2 text-[var(--color-text-muted)]" title={run.detail ?? undefined}>{run.detail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </li>
  )
}
