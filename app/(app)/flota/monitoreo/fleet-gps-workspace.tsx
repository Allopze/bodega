"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { FleetGpsPosition } from "@/lib/services/fleet-gps"
import { formatDateTime } from "@/lib/utils"
import { FleetGpsMap } from "./fleet-gps-map"
import { FleetGpsTable } from "./fleet-gps-table"
import { OnwayControls } from "./onway-controls"

type Alert = {
  id: string; plate: string; worksiteName: string; alertType: string; title: string; priority: string | null
  occurredAt: string; processingStatus: string; linkedEntityType: string | null; linkedEntityId: string | null; ruleId: string | null
}

const ALERT_STATUS_LABEL: Record<string, string> = {
  new: "Nueva",
  actioned: "Atendida",
  ignored: "Descartada",
  blocked: "Requiere atención",
}

export function FleetGpsWorkspace({ positions, alerts, canViewHistory, adminStatus, blockedAlertsCount = 0 }: {
  positions: FleetGpsPosition[]
  alerts: Alert[]
  canViewHistory: boolean
  adminStatus: React.ComponentProps<typeof OnwayControls>["status"] | null
  /** Alertas en estado `blocked` que ya vienen filtradas del servidor; permite
   *  etiquetar la pestaña antes de que el usuario la abra, sin recorrer la lista. */
  blockedAlertsCount?: number
}) {
  const hasAlerts = alerts.length > 0
  const hasBlocked = blockedAlertsCount > 0
  return (
    <Tabs defaultValue={hasBlocked && !positions.length ? "alerts" : "live"}>
      <TabsList aria-label="Secciones de monitoreo GPS">
        <TabsTrigger value="live">
          En vivo
          {positions.length > 0 ? <span className="ml-1.5 rounded-full bg-[var(--color-surface-2)] px-1.5 text-[10px] font-semibold tabular-nums text-[var(--color-text-subtle)]">{positions.length}</span> : null}
        </TabsTrigger>
        <TabsTrigger value="alerts">
          Alertas
          {hasAlerts ? <span className={`ml-1.5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${hasBlocked ? "bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]" : "bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]"}`}>{alerts.length}</span> : null}
        </TabsTrigger>
        {canViewHistory ? <TabsTrigger value="history">Historial</TabsTrigger> : null}
        {adminStatus ? <TabsTrigger value="settings">Configuración</TabsTrigger> : null}
      </TabsList>
      <TabsContent value="live" className="space-y-3">
        <FleetGpsMap positions={positions} />
        <Card id="vehiculos-gps" className="overflow-hidden">
          <CardHeader>
            <CardTitle as="h2" className="text-base">Vehículos monitoreados</CardTitle>
            <CardDescription>La tabla es la alternativa accesible al mapa; la hora de captura y la hora GPS se diferencian en el detalle.</CardDescription>
          </CardHeader>
          <FleetGpsTable positions={positions} />
        </Card>
      </TabsContent>
      <TabsContent value="alerts">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle as="h2" className="text-base">Alertas observadas</CardTitle>
            <CardDescription>Los tipos recién detectados sólo se catalogan; una regla habilitada y con propietario autorizado es necesaria para crear una OT o CAPA.</CardDescription>
          </CardHeader>
          {!hasAlerts ? (
            <p className="px-6 pb-6 text-sm text-[var(--color-text-muted)]">No hay alertas GPS vinculadas en esta faena.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {alerts.map((alert) => {
                const status = ALERT_STATUS_LABEL[alert.processingStatus] ?? alert.processingStatus
                const isBlocked = alert.processingStatus === "blocked"
                return (
                  <li key={alert.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                    <div>
                      <strong className="text-[var(--color-text)]">{alert.plate}</strong>
                      <span className="text-[var(--color-text)]"> · {alert.title}</span>
                      <div className="text-xs text-[var(--color-text-subtle)]">{alert.worksiteName} · {formatDateTime(alert.occurredAt)} · {alert.alertType}</div>
                    </div>
                    <span className={isBlocked ? "font-semibold text-[var(--color-danger-ink)]" : "text-[var(--color-text-muted)]"}>
                      {alert.linkedEntityType ? `${alert.linkedEntityType.toUpperCase()} creada` : status}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </TabsContent>
      {canViewHistory ? (
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">Historial y viajes</CardTitle>
              <CardDescription>La consulta de recorridos se limita a un vehículo y hasta 30 días. Los puntos exactos se eliminan al día 30; los resúmenes de viaje permanecen hasta 24 meses.</CardDescription>
            </CardHeader>
            <p className="px-6 pb-6 text-sm text-[var(--color-text-muted)]">Selecciona un vehículo desde la tabla en <em>En vivo</em> para consultar su historial en la ficha de Flota. Esta vista no expone direcciones geocodificadas.</p>
          </Card>
        </TabsContent>
      ) : null}
      {adminStatus ? (
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">Configuración de OnWay</CardTitle>
              <CardDescription>Credenciales cifradas, sincronización, catálogo de alertas y mapeos de conductores se administran aquí. Las reglas quedan desactivadas hasta asignar un propietario con permiso para la faena.</CardDescription>
            </CardHeader>
            <div className="px-6 pb-6"><OnwayControls status={adminStatus} /></div>
          </Card>
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
