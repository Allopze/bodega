"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { MetaBadge } from "@/components/states/state-badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import type { ExcludedGpsDevice, FleetGpsPosition, GpsLinkableDevice, LinkableVehicle } from "@/lib/services/fleet-gps"
import type { WialonAdminStatus } from "@/lib/integrations/wialon/wialon-settings"
import { formatDateTime } from "@/lib/utils"
import { alertStatusMeta, linkedEntityLabel } from "./fleet-gps-labels"
import { FleetGpsLiveStatus } from "./fleet-gps-live-status"
import { FleetGpsMap } from "./fleet-gps-map"
import type { SourceStatusRow } from "./fleet-gps-source-status"
import { FleetGpsSourcesPanel } from "./fleet-gps-sources-panel"
import { FleetGpsTable } from "./fleet-gps-table"
import { OnwayControls } from "./onway-controls"
import { WialonControls } from "./wialon-controls"
import { GpsDeviceLinks } from "./gps-device-links"
import { useGpsLiveRefresh } from "./use-gps-live-refresh"

type Alert = {
  id: string; plate: string; worksiteName: string; alertType: string; title: string; priority: string | null
  occurredAt: string; processingStatus: string; linkedEntityType: string | null; linkedEntityId: string | null; ruleId: string | null
}

type TabKey = "live" | "alerts" | "settings"

export function FleetGpsWorkspace({ positions, alerts, adminStatus, wialonStatus, gpsDevices, excludedDevices, linkableVehicles, blockedAlertsCount = 0, sourceRows = [], onwayStale = false, emptyState }: {
  positions: FleetGpsPosition[]
  alerts: Alert[]
  adminStatus: React.ComponentProps<typeof OnwayControls>["status"] | null
  wialonStatus: WialonAdminStatus | null
  /** Dispositivos de OnWay y Wialon con su vínculo, para resolver los pendientes. */
  gpsDevices: GpsLinkableDevice[]
  excludedDevices: ExcludedGpsDevice[]
  linkableVehicles: LinkableVehicle[]
  /** Alertas en estado `blocked` que ya vienen filtradas del servidor; permite
   *  etiquetar la pestaña antes de que el usuario la abra, sin recorrer la lista. */
  blockedAlertsCount?: number
  /** Una fila por fuente GPS con su estado; vacío si ninguna fuente tiene qué decir. */
  sourceRows?: SourceStatusRow[]
  /** OnWay no entrega posiciones nuevas: «Actualización automática cada minuto» sería falso. */
  onwayStale?: boolean
  /** Lo que se ve en «En vivo» cuando ningún vehículo tiene posición. */
  emptyState?: React.ReactNode
}) {
  const hasAlerts = alerts.length > 0
  const hasBlocked = blockedAlertsCount > 0
  const canConfigure = Boolean(adminStatus || wialonStatus)
  const [tab, setTab] = React.useState<TabKey>(hasBlocked && !positions.length ? "alerts" : "live")
  // Fuera de las pestañas: el refresco sigue aunque se mire «Alertas», y se
  // detiene sólo al salir de Monitoreo GPS (este componente no vive en otra página).
  const live = useGpsLiveRefresh()
  return (
    <div className="space-y-3">
      <FleetGpsSourcesPanel rows={sourceRows} onOpenSettings={canConfigure ? () => setTab("settings") : undefined} />
      <Tabs value={tab} onValueChange={(next) => setTab(next as TabKey)}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <TabsList aria-label="Secciones de monitoreo GPS">
            <TabsTrigger value="live">
              En vivo
              {positions.length > 0 ? <Badge size="sm" className="ml-1.5 tabular-nums">{positions.length}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value="alerts">
              Alertas
              {hasAlerts ? <MetaBadge meta={{ label: String(alerts.length), variant: hasBlocked ? "danger" : "default" }} size="sm" className="ml-1.5 tabular-nums" /> : null}
            </TabsTrigger>
            {canConfigure ? <TabsTrigger value="settings">Configuración</TabsTrigger> : null}
          </TabsList>
          <FleetGpsLiveStatus refreshing={live.refreshing} status={live.status} stale={onwayStale} />
        </div>
        <TabsContent value="live" className="space-y-3">
          {positions.length === 0 && emptyState ? emptyState : (
            <>
              <FleetGpsMap positions={positions} />
              <Card id="vehiculos-gps" className="overflow-hidden">
                <CardHeader>
                  <CardTitle as="h2" className="text-base">Vehículos monitoreados</CardTitle>
                  <CardDescription>La hora de captura indica cuándo la plataforma consultó la fuente; la hora GPS indica cuándo el dispositivo reportó la ubicación.</CardDescription>
                </CardHeader>
                <FleetGpsTable positions={positions} />
              </Card>
            </>
          )}
        </TabsContent>
        <TabsContent value="alerts">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle as="h2" className="text-base">Alertas observadas</CardTitle>
              <CardDescription>Los tipos recién detectados sólo se catalogan; una regla habilitada y con propietario autorizado es necesaria para crear una OT o CAPA.</CardDescription>
            </CardHeader>
            {!hasAlerts ? (
              <EmptyState
                compact
                title="No hay alertas GPS vinculadas en esta faena"
                description="Cuando un dispositivo reporte una alerta de un vehículo vinculado, aparecerá aquí."
              />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {alerts.map((alert) => {
                  const status = alertStatusMeta(alert.processingStatus)
                  return (
                    <li key={alert.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                      <div>
                        <strong className="text-[var(--color-text)]">{alert.plate}</strong>
                        <span className="text-[var(--color-text)]"> · {alert.title}</span>
                        <div className="text-xs text-[var(--color-text-subtle)]">{alert.worksiteName} · {formatDateTime(alert.occurredAt)}</div>
                      </div>
                      <MetaBadge
                        meta={{ label: alert.linkedEntityType ? linkedEntityLabel(alert.linkedEntityType) : status.label, variant: status.variant }}
                        dot
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </TabsContent>
        {canConfigure ? (
          <TabsContent value="settings" className="space-y-3">
            {adminStatus ? (
              <Card>
                <CardHeader>
                  <CardTitle as="h2" className="text-base">Configuración de OnWay</CardTitle>
                  <CardDescription>Credenciales cifradas, sincronización, catálogo de alertas y mapeos de conductores se administran aquí. Las reglas quedan desactivadas hasta asignar un propietario con permiso para la faena.</CardDescription>
                </CardHeader>
                <div className="px-6 pb-6"><OnwayControls status={adminStatus} /></div>
              </Card>
            ) : null}
            {wialonStatus ? (
              <Card>
                <CardHeader>
                  <CardTitle as="h2" className="text-base">Configuración de Wialon</CardTitle>
                  <CardDescription>Token, URL y parámetros de sensores. Los medidores se leen cada 5 minutos y la posición cada 10 segundos con esta página abierta; no reemplaza a OnWay: suma los equipos que OnWay no cubre.</CardDescription>
                </CardHeader>
                <div className="px-6 pb-6"><WialonControls status={wialonStatus} /></div>
              </Card>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle as="h2" className="text-base">Dispositivos GPS y vínculo</CardTitle>
                <CardDescription>Los equipos de OnWay y las unidades de Wialon que no calzan por patente, VIN o código se vinculan a un vehículo; los que no son de la flota se excluyen con su motivo. El vínculo se conserva entre lecturas y no crea equipos nuevos.</CardDescription>
              </CardHeader>
              <div className="px-6 pb-6">
                <GpsDeviceLinks devices={gpsDevices} excluded={excludedDevices} vehicles={linkableVehicles} />
              </div>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  )
}
