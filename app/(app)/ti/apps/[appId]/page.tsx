import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { findApp } from "@/lib/apps/catalog"
import { getAppCronRuns, getAppsOverview, getAppWorksiteUsage } from "@/lib/services/apps-overview"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { EmptyState } from "@/components/ui/empty-state"
import { MetaBadge } from "@/components/states/state-badge"
import { MiniSparkline } from "@/components/ui/mini-sparkline"
import { BarRankingChartLazy } from "@/components/charts/bar-ranking-chart-lazy"
import { Button } from "@/components/ui/button"
import { formatDateRelative, formatDateTime } from "@/lib/utils"
import { INTEGRATION_STATUS_META, RUN_OUTCOME_LABEL } from "../status"

export async function generateMetadata({ params }: { params: Promise<{ appId: string }> }): Promise<Metadata> {
  const app = findApp((await params).appId)
  return { title: app ? `${app.label} · Apps` : "Apps" }
}

const CARD = "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xs"

function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${ms} ms`
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

export default async function AppDetailPage({ params }: { params: Promise<{ appId: string }> }) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const { appId } = await params
  if (!findApp(appId)) notFound()

  const scope = serviceWorksiteScope(session)
  const [overview, worksiteUsage, runs] = await Promise.all([
    getAppsOverview(),
    getAppWorksiteUsage(appId, scope),
    getAppCronRuns(appId),
  ])
  const app = overview.apps.find((entry) => entry.id === appId)
  if (!app) notFound()

  const stats: SummaryStat[] = [
    { key: "access", label: "Con acceso", value: app.usersWithAccess, secondary: "personas activas con permiso" },
    { key: "active", label: "Usuarios activos", value: app.activityNote ? "—" : app.activeUsers, valueKind: app.activityNote ? "text" : "number", secondary: "con movimientos en 30 días" },
    { key: "movements", label: "Movimientos 30 d", value: app.activityNote ? "—" : app.movements, valueKind: app.activityNote ? "text" : "number" },
    {
      key: "last",
      label: "Última actividad",
      valueKind: "text",
      value: app.activityNote ? "No aplica" : app.lastActivityAt ? formatDateRelative(app.lastActivityAt) : "Más de un año",
      secondary: app.lastActivityAt ? formatDateTime(app.lastActivityAt) : undefined,
    },
  ]

  const currentWeek = app.trend.at(-1) ?? 0
  const weeklyAverage = Math.round(app.trend.reduce((sum, value) => sum + value, 0) / app.trend.length)
  const jobLabel = new Map(app.integrations.map((integration) => [integration.jobName, integration.label]))

  return (
    <PageContainer>
      <PageHeader
        title={app.label}
        description={`${app.areaLabel} · uso y salud en los últimos 30 días`}
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "TI", href: "/ti" }, { label: "Apps", href: "/ti/apps" }, { label: app.label }]} />}
        actions={app.enabled ? (
          <Button asChild variant="secondary">
            <Link href={app.href}><ArrowSquareOut size={16} aria-hidden /> Abrir app</Link>
          </Button>
        ) : (
          <MetaBadge meta={{ label: "Desactivada", variant: "neutral" }} title="Se activa en Administración › Módulos" />
        )}
      />
      <div className="space-y-4">
        <SummaryBar stats={stats} />

        {app.activityNote ? (
          <p className="text-sm text-[var(--color-text-muted)]">{app.activityNote}.</p>
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <section className={CARD} aria-labelledby="tendencia">
              <h2 id="tendencia" className="text-base font-semibold">Movimientos por semana</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Esta semana: <span className="font-mono tabular-nums">{currentWeek}</span> · promedio de las últimas {app.trend.length}: <span className="font-mono tabular-nums">{weeklyAverage}</span>
              </p>
              <MiniSparkline data={app.trend} className="mt-4 h-24 w-full" />
            </section>
            <section className={CARD} aria-labelledby="por-faena">
              <h2 id="por-faena" className="text-base font-semibold">Movimientos por faena</h2>
              {worksiteUsage.length === 0 ? (
                <EmptyState
                  compact
                  title="Sin movimientos en 30 días"
                  description="Cuando alguien registre o cambie algo en esta app, aquí verás en qué faenas."
                  action={app.enabled ? <Button asChild variant="secondary" size="sm"><Link href={app.href}>Abrir app</Link></Button> : undefined}
                />
              ) : (
                <div className="mt-4">
                  <BarRankingChartLazy
                    ariaLabel={`Movimientos de ${app.label} por faena en los últimos 30 días`}
                    items={worksiteUsage.map((row) => ({ key: row.worksiteId ?? "none", label: row.worksiteName, value: row.movements }))}
                    unit=" mov."
                    limit={10}
                  />
                </div>
              )}
            </section>
          </div>
        )}

        <section className={CARD} aria-labelledby="integraciones">
          <h2 id="integraciones" className="text-base font-semibold">Integraciones y tareas programadas</h2>
          {app.integrations.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">Esta app no tiene sincronizaciones ni tareas programadas.</p>
          ) : (
            <>
              <ul className="mt-4 divide-y divide-[var(--color-border)]">
                {app.integrations.map((integration) => {
                  const meta = INTEGRATION_STATUS_META[integration.status]
                  return (
                    <li key={integration.jobName} className="flex flex-wrap items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="font-medium">{integration.label}</div>
                        <div className="text-xs text-[var(--color-text-subtle)]">
                          {integration.lastStartedAt ? `Última corrida ${formatDateTime(integration.lastStartedAt)}` : "Sin corridas en 30 días"}
                          {integration.failures7d > 0 && ` · ${integration.failures7d} ${integration.failures7d === 1 ? "falla" : "fallas"} en 7 días`}
                        </div>
                        {integration.status === "failing" && integration.lastDetail && (
                          <div className="mt-1 text-xs text-[var(--color-danger-ink)]">{integration.lastDetail}</div>
                        )}
                      </div>
                      <MetaBadge meta={meta} title={meta.hint} />
                    </li>
                  )
                })}
              </ul>
              {runs.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-[var(--color-primary-ink)]">Últimas corridas</summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Últimas corridas de las tareas de {app.label}</caption>
                      <thead>
                        <tr className="text-left text-xs text-[var(--color-text-subtle)]">
                          <th scope="col" className="py-2 pr-4 font-medium">Tarea</th>
                          <th scope="col" className="py-2 pr-4 font-medium">Inicio</th>
                          <th scope="col" className="py-2 pr-4 font-medium">Resultado</th>
                          <th scope="col" className="py-2 pr-4 text-right font-medium">Duración</th>
                          <th scope="col" className="py-2 font-medium">Detalle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border)]">
                        {runs.map((run) => (
                          <tr key={`${run.jobName}-${run.startedAt}`}>
                            <td className="py-2 pr-4">{jobLabel.get(run.jobName) ?? run.jobName}</td>
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
            </>
          )}
        </section>
      </div>
    </PageContainer>
  )
}
