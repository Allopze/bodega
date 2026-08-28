import type { Metadata } from "next"
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
  const stats: SummaryStat[] = monitoring.positions.length === 0 ? [] : [
    { key: "linked", label: "Vehículos vinculados", value: monitoring.positions.length },
    { key: "moving", label: "En movimiento", value: monitoring.positions.filter((position) => position.speedKph > 0).length },
    { key: "ignition", label: "Con encendido", value: monitoring.positions.filter((position) => position.ignition).length },
    { key: "capture", label: "Última captura", value: latestCapture ? formatDateTime(latestCapture) : "Sin datos" },
  ]

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

      {captureIsStale && (
        <p role="status" className="mt-3 rounded-[var(--radius)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
          La última captura tiene más de 15 minutos. Las ubicaciones son el último dato conocido, no una posición en tiempo real.
        </p>
      )}

      {monitoring.canManage && monitoring.latestRun?.status === "failed" && (
        <p role="alert" className="mt-3 rounded-[var(--radius)] border border-[var(--color-danger)] bg-[var(--color-danger-tint)] p-3 text-sm text-[var(--color-danger-ink)]">
          La última actualización de OnWay falló. Revisa las credenciales o ejecuta una actualización manual.
        </p>
      )}

      {monitoring.canManage && Number(monitoring.unmatched ?? 0) > 0 && (
        <p role="status" className="mt-3 rounded-[var(--radius)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
          {monitoring.unmatched} dispositivo{monitoring.unmatched === 1 ? "" : "s"} de OnWay no coincide{monitoring.unmatched === 1 ? "" : "n"} con una patente única del catálogo de Flota.
        </p>
      )}

      <div className="mt-3"><FleetGpsWorkspace positions={monitoring.positions} alerts={alerts} canViewHistory={can(session, "flota:view_gps_history")} adminStatus={adminStatus} /></div>
    </PageContainer>
  )
}
