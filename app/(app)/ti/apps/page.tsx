import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { getAppsOverview } from "@/lib/services/apps-overview"
import type { AppOverview } from "@/lib/apps/metrics"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { countOf, formatDate } from "@/lib/utils"
import { AppsTable, type AppRow } from "./apps-table"
import { APP_FILTERS, parseAppFilter, type AppFilter } from "./status"

export const metadata: Metadata = { title: "Apps" }

const hasIntegrationProblem = (app: AppOverview) => app.integrationStatus === "failing" || app.integrationStatus === "stale"

function matchesFilter(app: AppOverview, filter: AppFilter | null): boolean {
  if (filter === "integraciones") return hasIntegrationProblem(app)
  if (filter === "sin-uso") return app.idle
  if (filter === "desactivadas") return !app.enabled
  return true
}

export default async function AppsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  try { await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const filter = parseAppFilter((await searchParams).filtro)
  const overview = await getAppsOverview()
  const { apps } = overview

  const enabled = apps.filter((app) => app.enabled).length
  const withProblems = apps.filter(hasIntegrationProblem).length
  const idle = apps.filter((app) => app.idle).length

  const stats: SummaryStat[] = [
    {
      key: "enabled",
      label: "Apps activas",
      value: enabled,
      hint: `de ${apps.length}`,
      href: enabled < apps.length ? "/ti/apps?filtro=desactivadas" : undefined,
    },
    {
      key: "users",
      label: "Usuarios activos",
      value: overview.totalActiveUsers,
      secondary: "abrieron o registraron algo en 30 días",
    },
    {
      key: "integrations",
      label: "Integraciones con problemas",
      value: withProblems,
      tone: "danger",
      href: "/ti/apps?filtro=integraciones",
    },
    {
      key: "idle",
      label: "Apps sin uso",
      value: idle,
      tone: "signal",
      secondary: "sin movimientos en 30 días",
      href: "/ti/apps?filtro=sin-uso",
    },
  ]

  const rows: AppRow[] = apps.filter((app) => matchesFilter(app, filter)).map((app) => ({
    id: app.id,
    label: app.label,
    href: app.href,
    iconName: app.iconName,
    areaLabel: app.areaLabel,
    areaOrder: app.areaOrder,
    activityNote: app.activityNote ?? null,
    enabled: app.enabled,
    usersWithAccess: app.usersWithAccess,
    activeUsers: app.activeUsers,
    movements: app.movements,
    visits: app.visits,
    trend: app.trend,
    lastActivityAt: app.lastActivityAt,
    idle: app.idle,
    integrationStatus: app.integrationStatus,
    integrationCount: app.integrations.length,
    integrationProblems: app.integrations.filter((integration) => integration.status === "failing" || integration.status === "stale").length,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Apps"
        description="Uso y salud de cada app de la plataforma en los últimos 30 días."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "TI", href: "/ti" }, { label: "Apps" }]} />}
      />
      <div className="space-y-4">
        <SummaryBar
          stats={stats}
          // Cada cifra filtra esta misma lista: sin entrada nueva en el historial ni salto de scroll.
          renderLink={({ href, className, children, ...rest }) => (
            <Link href={href} replace scroll={false} className={className} {...rest}>{children}</Link>
          )}
        />
        {filter && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <span>Mostrando: <span className="font-medium text-[var(--color-text)]">{APP_FILTERS[filter]}</span></span>
            <Link href="/ti/apps" replace scroll={false} className="text-[var(--color-primary-ink)] hover:underline">Ver todas</Link>
          </p>
        )}
        <AppsTable rows={rows} filtered={filter !== null} />
        <p className="text-xs text-[var(--color-text-subtle)]">
          Una visita es entrar a la app: moverse entre sus pantallas antes de 30 minutos no suma otra.
          {overview.visitsTrackedSince
            ? <> Las visitas se registran desde el {formatDate(overview.visitsTrackedSince)}.</>
            : <> Las visitas empiezan a registrarse con el primer ingreso después de esta versión.</>}
          {" "}Los movimientos son altas, cambios y cambios de estado registrados en la auditoría. «Con acceso» son las
          personas activas con al menos un permiso de la app; «Activos», las que la abrieron o registraron algo.
          {overview.unassigned.movements > 0 && (
            <> {countOf(overview.unassigned.movements, "movimiento")} de los últimos 30 días son de tipos sin app asignada
              ({overview.unassigned.entityTypes.join(", ")}).</>
          )}
        </p>
      </div>
    </PageContainer>
  )
}
