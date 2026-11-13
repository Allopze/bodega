import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { requirePermission } from "@/lib/auth/can"
import { readOnwayAdminStatus } from "@/lib/integrations/onway/onway-settings"
import { readWialonAdminStatus } from "@/lib/integrations/wialon/wialon-settings"
import { getFleetGpsAlerts, getFleetGpsMonitoring, isGpsCaptureStale, listLinkableVehicles, listWialonUnitsForLinking } from "@/lib/services/fleet-gps"
import { formatDateTime } from "@/lib/utils"
import { buildSourceStatusRow } from "./fleet-gps-source-status"
import { FleetGpsWorkspace } from "./fleet-gps-workspace"
import { GpsRefreshButton } from "./gps-refresh-button"

export const metadata: Metadata = { title: "Monitoreo GPS" }

export default async function FleetGpsMonitoringPage() {
  let session
  try { session = await requirePermission("flota:view") }
  catch { redirect("/forbidden") }

  const [monitoring, alerts] = await Promise.all([getFleetGpsMonitoring(session), getFleetGpsAlerts(session)])
  const [adminStatus, wialonStatus, wialonLinks] = monitoring.canManage
    ? await Promise.all([
        readOnwayAdminStatus(),
        readWialonAdminStatus(),
        Promise.all([listWialonUnitsForLinking(session), listLinkableVehicles(session)]),
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

  // Un solo bloque «Estado de las fuentes», una fila por proveedor, en vez de hasta ocho avisos apilados.
  const sourceRows = [
    buildSourceStatusRow({
      provider: "onway",
      latestAt: monitoring.providerLatestAt.onway,
      stale: onwayIsStale,
      run: monitoring.providerRuns.onway,
      unmatched: monitoring.unmatchedByProvider.onway,
      canManage: monitoring.canManage,
    }),
    buildSourceStatusRow({
      provider: "wialon",
      latestAt: monitoring.providerLatestAt.wialon,
      stale: wialonIsStale,
      run: monitoring.providerRuns.wialon,
      unmatched: monitoring.unmatchedByProvider.wialon,
      canManage: monitoring.canManage,
    }),
  ].filter((row) => row !== null)

  return (
    <PageContainer>
      <PageHeader
        title="Monitoreo GPS"
        description="Posición operacional de la flota vinculada con Entel OnWay y Wialon."
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Monitoreo GPS" },
        ]} />}
        // La configuración vive sólo en su pestaña; la cabecera deja la acción de uso diario.
        actions={monitoring.canManage && (onwayIsConfigured || wialonIsConfigured)
          ? <GpsRefreshButton onway={onwayIsConfigured} wialon={wialonIsConfigured} />
          : undefined}
      />

      <SummaryBar stats={stats} />

      <div className="mt-3">
        <FleetGpsWorkspace
          positions={monitoring.positions}
          alerts={alerts}
          adminStatus={adminStatus}
          wialonStatus={wialonStatus}
          wialonUnits={wialonLinks?.[0] ?? []}
          linkableVehicles={wialonLinks?.[1] ?? []}
          blockedAlertsCount={blockedAlerts}
          sourceRows={sourceRows}
          onwayStale={onwayIsStale}
          emptyState={(
            <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
              <EmptyState
                title="No hay posiciones GPS para mostrar"
                description={onwayIsConfigured || wialonIsConfigured
                  ? "Las posiciones se actualizan solas; también puedes pedirlo con «Actualizar ahora». Si los vehículos ya están en Flota y las unidades de Wialon están vinculadas, aparecerán en la próxima actualización."
                  : monitoring.canManage
                    ? "Configura OnWay o Wialon en la pestaña «Configuración» y vincula las patentes de los vehículos de Flota. La primera captura demora unos minutos."
                    : "Todavía no hay una fuente GPS conectada. Pide a quien administra el monitoreo que la configure."}
                action={monitoring.canManage && !onwayIsConfigured && !wialonIsConfigured ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/admin/flota-catalogos/vehiculos">Abrir catálogo de vehículos</Link>
                  </Button>
                ) : undefined}
              />
            </div>
          )}
        />
      </div>
    </PageContainer>
  )
}
