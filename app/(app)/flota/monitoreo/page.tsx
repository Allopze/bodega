import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { requirePermission } from "@/lib/auth/can"
import { readOnwayAdminStatus } from "@/lib/integrations/onway/onway-settings"
import { can } from "@/lib/auth/can"
import { getFleetGpsAlerts, getFleetGpsMonitoring } from "@/lib/services/fleet-gps"
import { formatDateTime } from "@/lib/utils"
import { FleetGpsWorkspace } from "./fleet-gps-workspace"
import { OnwayControls } from "./onway-controls"

export const metadata: Metadata = { title: "Monitoreo GPS" }

function staleSinceLabel(latestCapture: string): string {
  // Sin capturar por más de un día, dejar de contar en minutos y hablar en días
  // para no acumular cuatro dígitos en el banner.
  const diffMs = Date.now() - Date.parse(latestCapture)
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "reciente"
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? "" : "s"}`
  const hours = Math.round(diffMs / 3_600_000)
  if (hours < 24) return `${hours} hora${hours === 1 ? "" : "s"}`
  const days = Math.round(diffMs / 86_400_000)
  return `${days} día${days === 1 ? "" : "s"}`
}

export default async function FleetGpsMonitoringPage() {
  let session
  try { session = await requirePermission("flota:view") }
  catch { redirect("/forbidden") }

  const [monitoring, alerts] = await Promise.all([getFleetGpsMonitoring(session), getFleetGpsAlerts(session)])
  const adminStatus = monitoring.canManage ? await readOnwayAdminStatus() : null
  const latestCapture = monitoring.positions.reduce<string | null>(
    (latest, position) => !latest || position.observedAt > latest ? position.observedAt : latest,
    null,
  )
  const captureIsStale = latestCapture !== null
    && latestCapture < monitoring.staleBefore
  const hasData = monitoring.positions.length > 0
  const blockedAlerts = alerts.filter((alert) => alert.processingStatus === "blocked").length
  const stats: SummaryStat[] = hasData ? [
    { key: "linked", label: "Vehículos vinculados", value: monitoring.positions.length },
    { key: "moving", label: "En movimiento", value: monitoring.positions.filter((position) => position.speedKph > 0).length },
    { key: "ignition", label: "Con encendido", value: monitoring.positions.filter((position) => position.ignition).length },
    { key: "capture", label: "Última captura", value: latestCapture ? formatDateTime(latestCapture) : "Sin datos" },
  ] : []
  const onwayIsConfigured = adminStatus?.hasCredentials ?? false

  return (
    <PageContainer>
      <PageHeader
        title="Monitoreo GPS"
        description="Posición operacional de la flota vinculada con Entel OnWay."
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Flota", href: "/flota" },
          { label: "Monitoreo GPS" },
        ]} />}
        actions={adminStatus ? <OnwayControls status={adminStatus} /> : undefined}
      />

      <SummaryBar stats={stats} />

      {captureIsStale && latestCapture ? (
        <p role="status" className="mt-3 rounded-[var(--radius)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
          <strong>Captura desactualizada:</strong> la última posición se tomó hace {staleSinceLabel(latestCapture)}. Las ubicaciones son el último dato conocido, no una lectura en tiempo real.
          {monitoring.canManage ? <span> Si OnWay no responde, ejecuta <em>Actualizar ahora</em> desde la barra superior.</span> : null}
        </p>
      ) : null}

      {monitoring.canManage && monitoring.latestRun?.status === "failed" ? (
        <p role="alert" className="mt-3 flex flex-wrap items-start justify-between gap-2 rounded-[var(--radius)] border border-[var(--color-danger)] bg-[var(--color-danger-tint)] p-3 text-sm text-[var(--color-danger-ink)]">
          <span><strong>Última sincronización de OnWay falló.</strong> Revisa las credenciales en <em>Configurar</em> (arriba a la derecha) o ejecuta una corrida manual.</span>
          {monitoring.latestRun.errorCode ? <span className="rounded bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-xs">{monitoring.latestRun.errorCode}</span> : null}
        </p>
      ) : null}

      {monitoring.canManage && Number(monitoring.unmatched ?? 0) > 0 ? (
        <p role="status" className="mt-3 flex flex-wrap items-start justify-between gap-2 rounded-[var(--radius)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
          <span><strong>{monitoring.unmatched} dispositivo{monitoring.unmatched === 1 ? "" : "s"} de OnWay sin patente única</strong> en el catálogo de Flota. La posición se descarta hasta corregirlo.</span>
          <Link href="/admin/flota-catalogos/vehiculos" className="shrink-0 font-semibold underline">Revisar catálogo de vehículos</Link>
        </p>
      ) : null}

      {!hasData ? (
        <section role="status" className="mt-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-text)]">
          <p className="font-semibold">No hay posiciones de OnWay para mostrar.</p>
          <p className="mt-1 text-[var(--color-text-subtle)]">
            {onwayIsConfigured
              ? "La sincronización corre por cron; puedes forzar una corrida desde la barra superior. Si los vehículos ya están en el catálogo, la captura aparecerá en el siguiente ciclo."
              : "Configura las credenciales de OnWay y vincula las patentes del catálogo de Flota. La primera captura demora unos minutos."}
          </p>
          {!onwayIsConfigured ? (
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
          blockedAlertsCount={blockedAlerts}
        />
      </div>
    </PageContainer>
  )
}
