import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { requirePermission } from "@/lib/auth/can"
import { readOnwayAdminStatus } from "@/lib/integrations/onway/onway-settings"
import { readWialonAdminStatus } from "@/lib/integrations/wialon/wialon-settings"
import { can } from "@/lib/auth/can"
import { getFleetGpsAlerts, getFleetGpsMonitoring, isGpsCaptureStale, listExcludedGpsDevices, listGpsDevicesForLinking, listLinkableVehicles } from "@/lib/services/fleet-gps"
import { formatDateTime } from "@/lib/utils"
import { Callout } from "@/components/ui/callout"
import { FleetGpsWorkspace } from "./fleet-gps-workspace"
import { OnwayControls } from "./onway-controls"
import { WialonControls } from "./wialon-controls"

export const metadata: Metadata = { title: "Monitoreo GPS" }

function staleSinceLabel(observedAt: string): string {
  // Sin capturar por más de un día, dejar de contar en minutos y hablar en días
  // para no acumular cuatro dígitos en el banner.
  const diffMs = Date.now() - Date.parse(observedAt)
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "reciente"
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? "" : "s"}`
  const hours = Math.round(diffMs / 3_600_000)
  if (hours < 24) return `${hours} hora${hours === 1 ? "" : "s"}`
  const days = Math.round(diffMs / 86_400_000)
  return `${days} día${days === 1 ? "" : "s"}`
}

/** `?pestana=configuracion` abre la pestaña Configuración (los avisos de pendientes enlazan acá). */
const SETTINGS_TAB_HREF = "/flota/monitoreo?pestana=configuracion"

export default async function FleetGpsMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const openSettings = sp.pestana === "configuracion"
  let session
  try { session = await requirePermission("flota:view") }
  catch { redirect("/forbidden") }

  const [monitoring, alerts] = await Promise.all([getFleetGpsMonitoring(session), getFleetGpsAlerts(session)])
  const [adminStatus, wialonStatus, deviceLinks] = monitoring.canManage
    ? await Promise.all([
        readOnwayAdminStatus(),
        readWialonAdminStatus(),
        Promise.all([listGpsDevicesForLinking(session), listExcludedGpsDevices(session), listLinkableVehicles(session)]),
      ])
    : [null, null, null]
  const latestSyncAt = [monitoring.providerLatestAt.onway, monitoring.providerLatestAt.wialon]
    .filter((value): value is string => Boolean(value))
    .reduce<string | null>((latest, value) => !latest || value > latest ? value : latest, null)
  const onwayIsStale = isGpsCaptureStale(monitoring.providerLatestAt.onway, monitoring.staleBefore)
  const wialonIsStale = isGpsCaptureStale(monitoring.providerLatestAt.wialon, monitoring.staleBefore)
  const hasData = monitoring.positions.length > 0
  const blockedAlerts = alerts.filter((alert) => alert.processingStatus === "blocked").length
  const stats: SummaryStat[] = hasData ? [
    { key: "linked", label: "Vehículos vinculados", value: monitoring.positions.length },
    { key: "moving", label: "En movimiento", value: monitoring.positions.filter((position) => position.speedKph > 0).length },
    { key: "ignition", label: "Con encendido", value: monitoring.positions.filter((position) => position.ignitionKnown && position.ignition).length },
    { key: "capture", label: "Última consulta", value: latestSyncAt ? formatDateTime(latestSyncAt) : "Sin datos", valueKind: "text" },
  ] : []
  const onwayIsConfigured = adminStatus?.hasCredentials ?? false
  const wialonIsConfigured = wialonStatus?.fields.token.configured ?? false

  return (
    <PageContainer>
      <PageHeader
        title="Monitoreo GPS"
        description="Posición operacional de la flota vinculada con Entel OnWay y Wialon."
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Monitoreo GPS" },
        ]} />}
        actions={monitoring.canManage && adminStatus && wialonStatus ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <OnwayControls status={adminStatus} />
            <WialonControls status={wialonStatus} />
          </div>
        ) : undefined}
      />

      <SummaryBar stats={stats} />

      {onwayIsStale && monitoring.providerLatestAt.onway ? (
        <Callout tone="warning" className="mt-3">
          <strong>Consulta a OnWay atrasada:</strong> la plataforma no recibe una posición nueva de OnWay desde hace {staleSinceLabel(monitoring.providerLatestAt.onway)}. Las ubicaciones de OnWay reflejan el último reporte recibido, no una lectura en tiempo real.
          {monitoring.canManage ? <span> Revisa la corrida de OnWay en <em>Configurar</em> o ejecuta una actualización manual.</span> : null}
        </Callout>
      ) : null}

      {wialonIsStale && monitoring.providerLatestAt.wialon ? (
        <Callout tone="warning" className="mt-3">
          <strong>Consulta a Wialon atrasada:</strong> la plataforma no recibe una posición nueva de Wialon desde hace {staleSinceLabel(monitoring.providerLatestAt.wialon)}. Las ubicaciones de Wialon reflejan el último reporte recibido, no una lectura en tiempo real.
          {monitoring.canManage ? <span> Revisa la corrida de Wialon en <em>Configurar</em> o ejecuta una actualización manual.</span> : null}
        </Callout>
      ) : null}

      {monitoring.canManage && monitoring.latestRun?.status === "failed" ? (
        <Callout tone="danger" role="alert" className="mt-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span><strong>Última sincronización de OnWay falló.</strong> Revisa las credenciales en <em>Configurar</em> (arriba a la derecha) o ejecuta una corrida manual.</span>
            {monitoring.latestRun.errorCode ? <span className="rounded bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-xs">{monitoring.latestRun.errorCode}</span> : null}
          </div>
        </Callout>
      ) : null}

      {monitoring.canManage && monitoring.latestRun?.status === "partial" && Number(monitoring.unmatchedByProvider.onway ?? 0) === 0 ? (
        <Callout tone="warning" role="status" className="mt-3">
          <strong>La última sincronización de OnWay fue parcial.</strong> OnWay devolvió datos incompletos; pueden faltar telemetría, alertas o historial.
        </Callout>
      ) : null}

      {monitoring.canManage && monitoring.providerRuns.wialon?.status === "failed" ? (
        <Callout tone="danger" role="alert" className="mt-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span><strong>Última sincronización de Wialon falló.</strong> Revisa el token en <em>Configurar</em> o ejecuta una corrida manual.</span>
            {monitoring.providerRuns.wialon.errorCode ? <span className="rounded bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-xs">{monitoring.providerRuns.wialon.errorCode}</span> : null}
          </div>
        </Callout>
      ) : null}

      {monitoring.canManage && monitoring.providerRuns.wialon?.status === "partial" ? (
        <Callout tone="warning" role="status" className="mt-3">
          <strong>La última sincronización de Wialon fue parcial.</strong> Wialon devolvió más unidades de las que se pueden procesar en una corrida; revisa el límite de unidades.
        </Callout>
      ) : null}

      {monitoring.canManage && Number(monitoring.unmatchedByProvider.onway ?? 0) > 0 ? (
        <Callout tone="warning" className="mt-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span><strong>{monitoring.unmatchedByProvider.onway} dispositivo{monitoring.unmatchedByProvider.onway === 1 ? "" : "s"} de OnWay sin vehículo</strong>: la patente no calza con una única patente del catálogo. Vincúlalo a mano o exclúyelo si no es de la flota.</span>
            <Link href={SETTINGS_TAB_HREF} scroll={false} className="shrink-0 font-semibold underline">Vincular en Configuración</Link>
          </div>
        </Callout>
      ) : null}

      {monitoring.canManage && Number(monitoring.unmatchedByProvider.wialon ?? 0) > 0 ? (
        <Callout tone="warning" className="mt-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span><strong>{monitoring.unmatchedByProvider.wialon} unidad{monitoring.unmatchedByProvider.wialon === 1 ? "" : "es"} de Wialon sin vehículo</strong>. La posición se conserva, pero no entra al panel hasta vincularla.</span>
            <Link href={SETTINGS_TAB_HREF} scroll={false} className="shrink-0 font-semibold underline">Vincular en Configuración</Link>
          </div>
        </Callout>
      ) : null}

      {!hasData ? (
        <section role="status" className="mt-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-text)]">
          <p className="font-semibold">No hay posiciones GPS para mostrar.</p>
          <p className="mt-1 text-[var(--color-text-subtle)]">
            {onwayIsConfigured || wialonIsConfigured
              ? "La sincronización corre por cron; puedes forzar una corrida desde Configurar. Si los vehículos ya están en el catálogo y las unidades Wialon están vinculadas, la captura aparecerá en el siguiente ciclo."
              : "Configura OnWay o Wialon y vincula las patentes del catálogo de Flota. La primera captura demora unos minutos."}
          </p>
          {!onwayIsConfigured && !wialonIsConfigured ? (
            <p className="mt-2">
              <Link href="/admin/flota-catalogos/vehiculos" className="font-semibold text-[var(--color-primary)] underline">Abrir catálogo de vehículos</Link>
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="mt-3">
        <FleetGpsWorkspace
          positions={monitoring.positions}
          alerts={alerts}
          canViewHistory={can(session, "flota:view_gps_history")}
          adminStatus={adminStatus}
          wialonStatus={wialonStatus}
          gpsDevices={deviceLinks?.[0] ?? []}
          excludedDevices={deviceLinks?.[1] ?? []}
          linkableVehicles={deviceLinks?.[2] ?? []}
          blockedAlertsCount={blockedAlerts}
          openSettings={openSettings}
        />
      </div>
    </PageContainer>
  )
}
