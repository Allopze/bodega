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

export function FleetGpsWorkspace({ positions, alerts, canViewHistory, adminStatus }: {
  positions: FleetGpsPosition[]; alerts: Alert[]; canViewHistory: boolean; adminStatus: React.ComponentProps<typeof OnwayControls>["status"] | null
}) {
  return (
    <Tabs defaultValue="live">
      <TabsList aria-label="Secciones de monitoreo GPS">
        <TabsTrigger value="live">En vivo</TabsTrigger>
        <TabsTrigger value="alerts">Alertas {alerts.length > 0 ? `(${alerts.length})` : ""}</TabsTrigger>
        {canViewHistory && <TabsTrigger value="history">Historial</TabsTrigger>}
        {adminStatus && <TabsTrigger value="settings">Configuración</TabsTrigger>}
      </TabsList>
      <TabsContent value="live" className="space-y-3">
        <FleetGpsMap positions={positions} />
        <Card id="vehiculos-gps" className="overflow-hidden">
          <CardHeader><CardTitle as="h2" className="text-base">Vehículos monitoreados</CardTitle><CardDescription>La tabla es la alternativa accesible al mapa; la hora de captura y la hora GPS se diferencian en el detalle.</CardDescription></CardHeader>
          <FleetGpsTable positions={positions} />
        </Card>
      </TabsContent>
      <TabsContent value="alerts">
        <Card className="overflow-hidden"><CardHeader><CardTitle as="h2" className="text-base">Alertas observadas</CardTitle><CardDescription>Los tipos recién detectados sólo se catalogan; una regla habilitada y con propietario autorizado es necesaria para crear una OT o CAPA.</CardDescription></CardHeader>
          {alerts.length === 0 ? <p className="px-6 pb-6 text-sm text-[var(--color-text-muted)]">No hay alertas GPS vinculadas en esta faena.</p> : <ul className="divide-y divide-[var(--color-border)]">{alerts.map((alert) => <li key={alert.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm"><div><strong>{alert.plate}</strong> · {alert.title}<div className="text-xs text-[var(--color-text-subtle)]">{alert.worksiteName} · {formatDateTime(alert.occurredAt)} · {alert.alertType}</div></div><span className="text-[var(--color-text-muted)]">{alert.linkedEntityType ? `${alert.linkedEntityType.toUpperCase()} creada` : alert.processingStatus === "blocked" ? "Requiere atención" : alert.processingStatus}</span></li>)}</ul>}
        </Card>
      </TabsContent>
      {canViewHistory && <TabsContent value="history"><Card><CardHeader><CardTitle as="h2" className="text-base">Historial y viajes</CardTitle><CardDescription>La consulta de recorridos se limita a un vehículo y hasta 30 días. Los puntos exactos se eliminan al día 30; los resúmenes de viaje permanecen hasta 24 meses.</CardDescription></CardHeader><p className="px-6 pb-6 text-sm text-[var(--color-text-muted)]">Selecciona un vehículo desde la tabla para consultar su historial en la ficha de Flota. Esta vista no expone direcciones geocodificadas.</p></Card></TabsContent>}
      {adminStatus && <TabsContent value="settings"><Card><CardHeader><CardTitle as="h2" className="text-base">Configuración de OnWay</CardTitle><CardDescription>Credenciales cifradas, sincronización, catálogo de alertas y mapeos de conductores se administran aquí. Las reglas quedan desactivadas hasta asignar un propietario con permiso para la faena.</CardDescription></CardHeader><div className="px-6 pb-6"><OnwayControls status={adminStatus} /></div></Card></TabsContent>}
    </Tabs>
  )
}
