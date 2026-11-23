import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { findFieldApp, isFieldAppId, type FieldAppDef } from "@/lib/apps/field-apps"
import { BUILD_ID, BUILD_TIME, buildLabel } from "@/lib/build-info"
import {
  getFieldAppAccess,
  getFieldAppCaptureQuality,
  getFieldAppDevices,
  getFieldAppLatency,
  getFieldAppSummaries,
  getFieldAppUsage,
  FIELD_DEVICES_LIMIT,
} from "@/lib/services/field-apps/overview"
import type {
  AccessSummary,
  CaptureQuality,
  LatencyWeek,
  UsageRow,
} from "@/lib/services/field-apps/types"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { EmptyState } from "@/components/ui/empty-state"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ChartDataTable } from "@/components/charts/chart-data-table"
import { MechanicAppInstallDialog } from "@/components/mantencion/jefatura/shared/mechanic-app-install-dialog"
import { formatDate, formatDateTime, formatPercent, formatQty } from "@/lib/utils"
import { DEVICE_FILTERS, formatMinutes, formatSince, matchesDeviceFilter, parseDeviceFilter } from "../status"
import { DevicesTable, type DeviceTableRow } from "./devices-table"
import { LatencyChartLazy } from "./latency-chart-lazy"

export async function generateMetadata({ params }: { params: Promise<{ appId: string }> }): Promise<Metadata> {
  const app = findFieldApp((await params).appId)
  return { title: app ? `${app.label} · Apps` : "Apps" }
}

const CARD = "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xs"
const TH = "py-2 pr-4 text-left text-xs font-medium text-[var(--color-text-subtle)]"
const TD = "py-2 pr-4"
const NUM = "font-mono tabular-nums"
const LINK_STATUS_META = {
  active:  { label: "Vigente",   variant: "success" },
  revoked: { label: "Revocado",  variant: "warning" },
  expired: { label: "Vencido",   variant: "warning" },
} as const

export default async function FieldAppDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const { appId } = await params
  if (!isFieldAppId(appId)) notFound()
  const app = findFieldApp(appId)
  if (!app) notFound()

  const filter = parseDeviceFilter((await searchParams).estado)
  const scope = serviceWorksiteScope(session)
  const now = new Date()
  const withAccess = app.id === "mantencion" || app.id === "tae"
  const withCapture = app.id === "ppa" || app.id === "tae"

  const [summaries, devices, latency, usage, access, quality] = await Promise.all([
    getFieldAppSummaries(scope, now, [app.id]),
    getFieldAppDevices(app.id, scope, now),
    getFieldAppLatency(app.id, scope, now),
    getFieldAppUsage(app.id, scope, now),
    withAccess ? getFieldAppAccess(app.id as "mantencion" | "tae", scope, now) : Promise.resolve(null),
    withCapture ? getFieldAppCaptureQuality(app.id as "ppa" | "tae", scope, now) : Promise.resolve(null),
  ])
  const summary = summaries.find((entry) => entry.app === app.id)
  if (!summary) notFound()

  const attention = summary.byState.error + summary.byState.stuck
  const base = `/ti/apps/${app.id}`
  const stats: SummaryStat[] = [
    {
      key: "activos", label: "Teléfonos activos", value: summary.activeDevices,
      hint: `de ${formatQty(summary.seenDevices)} vistos en 90 días`,
      href: summary.seenDevices > 0 ? `${base}?estado=activos` : undefined,
    },
    {
      key: "atencion", label: "Atascados o con error", value: attention, tone: "danger",
      href: attention > 0 ? `${base}?estado=atencion` : undefined,
    },
    {
      key: "version", label: "Con versión atrasada", value: summary.versionBehind, tone: "signal",
      href: summary.versionBehind > 0 ? `${base}?estado=version` : undefined,
    },
    {
      key: "sin-senal", label: "Sin señal / sin abrir", value: summary.byState.silent,
      href: summary.byState.silent > 0 ? `${base}?estado=sin-senal` : undefined,
    },
  ]

  const rows: DeviceTableRow[] = devices
    .filter((device) => matchesDeviceFilter(device, filter, now))
    .map((device) => ({
      ...device,
      lastSeenLabel: formatSince(device.lastSeenAt, now),
      pendingSinceLabel: device.pendingCount > 0 && device.oldestPendingAt ? formatSince(device.oldestPendingAt, now) : null,
    }))

  const published = BUILD_TIME ? buildLabel(BUILD_TIME, BUILD_ID) : null
  const openApp = summary.enabled ? (
    <Button asChild variant="secondary">
      <Link href={app.entryHref}><ArrowSquareOut size={16} aria-hidden /> Abrir app</Link>
    </Button>
  ) : null

  return (
    <PageContainer>
      <PageHeader
        title={app.label}
        description={app.description}
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "TI", href: "/ti" }, { label: "Apps", href: "/ti/apps" }, { label: app.label }]} />}
        actions={summary.enabled ? (
          <>
            {app.id === "mantencion" && <MechanicAppInstallDialog />}
            {openApp}
          </>
        ) : (
          <MetaBadge meta={{ label: "Desactivada", variant: "neutral" }} title="Se activa en Administración › Módulos" />
        )}
      />
      <div className="space-y-4">
        <SummaryBar
          stats={stats}
          // Cada cifra filtra la tabla de abajo: sin entrada nueva en el historial ni salto de scroll.
          renderLink={({ href, className, children, ...rest }) => (
            <Link href={href} replace scroll={false} className={className} {...rest}>{children}</Link>
          )}
        />

        <section className={CARD} aria-labelledby="telefonos">
          <h2 id="telefonos" className="text-base font-semibold">Teléfonos</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Los que avisaron en los últimos 90 días, con lo que quedó sin enviar.</p>
          {filter && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <span>Mostrando: <span className="font-medium text-[var(--color-text)]">{DEVICE_FILTERS[filter]}</span></span>
              <Link href={base} replace scroll={false} className="text-[var(--color-primary-ink)] hover:underline">Ver todos</Link>
            </p>
          )}
          <div className="mt-4">
            {devices.length === 0 && !filter ? (
              <EmptyState
                compact
                title="Aún no llegan avisos de esta app"
                description={published
                  ? `Empiezan cuando alguien la abre con la versión publicada el ${published}.`
                  : "Empiezan cuando alguien la abre con la versión publicada."}
                action={openApp ?? undefined}
              />
            ) : (
              <DevicesTable app={app.id} rows={rows} filtered={filter !== null} />
            )}
            {devices.length >= FIELD_DEVICES_LIMIT && summary.seenDevices > devices.length && (
              <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
                Se muestran los {formatQty(FIELD_DEVICES_LIMIT)} teléfonos más relevantes de {formatQty(summary.seenDevices)}.
              </p>
            )}
          </div>
        </section>

        <LatencySection app={app} latency={latency} />
        <UsageSection app={app} usage={usage} now={now} />
        {withAccess && access && <AccessSection app={app} access={access} now={now} />}
        {withCapture && quality && <QualitySection app={app} quality={quality} />}
      </div>
    </PageContainer>
  )
}

function OpenAppCta({ app }: { app: FieldAppDef }) {
  return <Button asChild variant="secondary" size="sm"><Link href={app.entryHref}>Abrir app</Link></Button>
}

function LatencySection({ app, latency }: { app: FieldAppDef; latency: LatencyWeek[] }) {
  const total = latency.reduce((sum, week) => sum + week.count, 0)
  const offline = latency.reduce((sum, week) => sum + week.count * (week.offlineShare ?? 0), 0)
  return (
    <section className={CARD} aria-labelledby="demora">
      <h2 id="demora" className="text-base font-semibold">Demora de llegada</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Tiempo entre que se llenó o firmó un envío y que llegó al servidor, por semana, en las últimas {latency.length || 12} semanas.
      </p>
      {total === 0 ? (
        <EmptyState
          compact
          title="Sin envíos en 12 semanas"
          description="Cuando lleguen envíos desde esta app verás cuánto demoran en llegar y qué parte se hizo sin señal."
          action={<OpenAppCta app={app} />}
        />
      ) : (
        <>
          <p className="mt-3 text-sm">
            <span className={`${NUM} text-lg font-semibold`}>{formatPercent((offline / total) * 100, 0)}</span>{" "}
            <span className="text-[var(--color-text-muted)]">de los {formatQty(total)} envíos se hicieron sin señal.</span>
          </p>
          <div className="mt-4">
            <LatencyChartLazy data={latency} ariaLabel={`Demora de llegada de ${app.label} por semana`} />
          </div>
          <ChartDataTable
            caption={`Demora de llegada de ${app.label} por semana`}
            headers={["Semana del", "Envíos", "Mediana", "Percentil 90", "Sin señal"]}
            rows={latency.map((week) => [
              formatDate(week.weekStart),
              formatQty(week.count),
              formatMinutes(week.p50Minutes),
              formatMinutes(week.p90Minutes),
              week.offlineShare === null ? "—" : formatPercent(week.offlineShare * 100, 0),
            ])}
          />
        </>
      )}
    </section>
  )
}

function UsageSection({ app, usage, now }: { app: FieldAppDef; usage: UsageRow[]; now: Date }) {
  const byPerson = app.id === "mantencion"
  return (
    <section className={CARD} aria-labelledby="uso">
      <h2 id="uso" className="text-base font-semibold">Uso</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        {byPerson ? "Quién registra desde la app" : "En qué faenas se usa"} y quién dejó de enviar: tenía envíos en los 30 días previos y ninguno en los últimos 7.
      </p>
      {usage.length === 0 ? (
        <EmptyState
          compact
          title="Sin envíos en los últimos 30 días"
          description={`Cuando alguien envíe desde la app verás aquí ${byPerson ? "quién la usa" : "en qué faenas"} y cuándo dejó de hacerlo.`}
          action={<OpenAppCta app={app} />}
        />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Uso de {app.label} por {byPerson ? "persona" : "faena"}</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>{byPerson ? "Persona" : "Faena"}</th>
                <th scope="col" className={`${TH} text-right`}>Teléfonos activos</th>
                <th scope="col" className={TH}>Último envío</th>
                <th scope="col" className={`${TH} text-right`}>Envíos en 30 días</th>
                <th scope="col" className={TH}>Situación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {usage.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className={`${TD} text-left font-medium`}>{row.label}</th>
                  <td className={`${TD} text-right ${NUM}`}>{formatQty(row.activeDevices)}</td>
                  <td className={`${TD} whitespace-nowrap`} title={row.lastSubmissionAt ? formatDateTime(row.lastSubmissionAt) : undefined}>
                    {formatSince(row.lastSubmissionAt, now)}
                  </td>
                  <td className={`${TD} text-right ${NUM}`}>{formatQty(row.submissions30d)}</td>
                  <td className={TD}>
                    {row.stopped
                      ? <MetaBadge meta={{ label: "Dejó de enviar", variant: "warning" }} title="Tenía envíos en los 30 días previos y ninguno en los últimos 7." />
                      : <span className="text-[var(--color-text-subtle)]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AccessSection({ app, access, now }: { app: FieldAppDef; access: AccessSummary; now: Date }) {
  const links = access.kind === "links"
  const nothing = access.active === 0 && access.revokedOrExpired30d === 0 && access.links.length === 0
  const figures: Array<{ key: string; label: string; value: number; warn?: boolean }> = [
    { key: "active", label: links ? "Enlaces vigentes" : "Credenciales vigentes", value: access.active },
    { key: "expiring", label: "Vencen en 7 días", value: access.expiringSoon, warn: true },
    { key: "unused", label: "Sin uso en 14 días", value: access.unused, warn: true },
    { key: "gone", label: links ? "Revocados o vencidos en 30 días" : "Revocadas en 30 días", value: access.revokedOrExpired30d },
  ]
  const manage = app.manageHref && app.manageLabel
    ? <Button asChild variant="secondary" size="sm"><Link href={app.manageHref}>{app.manageLabel}</Link></Button>
    : null
  return (
    <section className={CARD} aria-labelledby="accesos">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="accesos" className="text-base font-semibold">Accesos</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {links ? "Enlaces con que los teléfonos entran a Control TAE." : "Credenciales con que los mecánicos entran a la app."}
          </p>
        </div>
        {manage}
      </div>
      {nothing ? (
        <EmptyState
          compact
          title={links ? "Todavía no hay enlaces de acceso" : "Todavía no hay credenciales de mecánicos"}
          description={links
            ? "Sin un enlace, ningún teléfono puede entrar a Control TAE. Se crean en Combustibles › Ajustes › Puntos de carga."
            : "Sin una credencial, ningún mecánico puede registrar desde su teléfono. Se crean al vincular el dispositivo."}
          action={manage ?? undefined}
        />
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {figures.map((figure) => (
              <div key={figure.key}>
                <dt className="text-xs text-[var(--color-text-subtle)]">{figure.label}</dt>
                <dd className={`${NUM} mt-0.5 text-xl font-semibold ${figure.warn && figure.value > 0 ? "text-[var(--color-warning-ink)]" : ""}`}>
                  {formatQty(figure.value)}
                </dd>
              </div>
            ))}
          </dl>
          {links && access.links.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Enlaces de acceso a Control TAE</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>Enlace</th>
                    <th scope="col" className={TH}>Faena</th>
                    <th scope="col" className={TH}>Estado</th>
                    <th scope="col" className={TH}>Último uso</th>
                    <th scope="col" className={`${TH} text-right`}>Teléfonos activos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {access.links.map((link) => (
                    <tr key={link.id}>
                      <th scope="row" className={`${TD} text-left font-medium`}>{link.label}</th>
                      <td className={TD}>{link.worksiteName}</td>
                      <td className={TD}><MetaBadge meta={LINK_STATUS_META[link.status]} /></td>
                      <td className={`${TD} whitespace-nowrap`} title={link.lastUsedAt ? formatDateTime(link.lastUsedAt) : undefined}>
                        {link.lastUsedAt ? formatSince(link.lastUsedAt, now) : "Nunca"}
                      </td>
                      <td className={`${TD} text-right ${NUM}`}>{formatQty(link.activeDevices)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function QualitySection({ app, quality }: { app: FieldAppDef; quality: CaptureQuality }) {
  const worker = app.id === "ppa" ? "trabajador" : "conductor"
  const hasManual = quality.manualIdentity.length > 0
  const hasOcr = quality.ocrWeeks !== null && quality.ocrWeeks.length > 0
  return (
    <section className={CARD} aria-labelledby="calidad">
      <h2 id="calidad" className="text-base font-semibold">Calidad de captura</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Cuántas veces la persona no apareció en la nómina y hubo que escribirla a mano (un problema de datos maestros), en los últimos 30 días.
      </p>
      {!hasManual && !hasOcr ? (
        <EmptyState
          compact
          title="Sin envíos para medir"
          description={`Cuando lleguen envíos verás en qué faenas el ${worker} se identifica a mano${app.id === "tae" ? " y cuánto del medidor se lee por OCR" : ""}.`}
          action={<OpenAppCta app={app} />}
        />
      ) : (
        <div className="mt-4 space-y-6">
          {hasManual && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Identificación manual por faena en {app.label}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>Faena</th>
                    <th scope="col" className={`${TH} text-right`}>Envíos</th>
                    <th scope="col" className={`${TH} text-right`}>Identificación manual</th>
                    <th scope="col" className={`${TH} text-right`}>% manual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {quality.manualIdentity.map((row) => (
                    <tr key={row.worksiteId}>
                      <th scope="row" className={`${TD} text-left font-medium`}>{row.worksiteName}</th>
                      <td className={`${TD} text-right ${NUM}`}>{formatQty(row.total)}</td>
                      <td className={`${TD} text-right ${NUM}`}>{formatQty(row.manual)}</td>
                      <td className={`${TD} text-right ${NUM}`}>{row.total > 0 ? formatPercent((row.manual / row.total) * 100, 0) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {quality.ocrWeeks !== null && (
            <div>
              <h3 className="text-sm font-semibold">Lectura del medidor: OCR contra digitada</h3>
              {hasOcr ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Lectura del medidor por OCR y digitada, por semana</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={TH}>Semana del</th>
                        <th scope="col" className={`${TH} text-right`}>Lecturas</th>
                        <th scope="col" className={`${TH} text-right`}>Por OCR</th>
                        <th scope="col" className={`${TH} text-right`}>Digitadas</th>
                        <th scope="col" className={`${TH} text-right`}>Confianza media del OCR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {quality.ocrWeeks.map((week) => (
                        <tr key={week.weekStart}>
                          <th scope="row" className={`${TD} text-left font-normal`}>{formatDate(week.weekStart)}</th>
                          <td className={`${TD} text-right ${NUM}`}>{formatQty(week.readings)}</td>
                          <td className={`${TD} text-right ${NUM}`}>{formatQty(week.ocr)}</td>
                          <td className={`${TD} text-right ${NUM}`}>{formatQty(week.manual)}</td>
                          <td className={`${TD} text-right ${NUM}`}>{week.avgConfidence === null ? "—" : formatPercent(week.avgConfidence * 100, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">Todavía no hay lecturas de medidor en las últimas semanas.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
