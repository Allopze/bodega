import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { can, requirePermission } from "@/lib/auth/can"
import { getFleetVehicleDetail } from "@/lib/services/fleet"
import { formatFuelVehicleStatus } from "@/lib/combustibles/validation"
import { MAINTENANCE_STATUS_LABELS } from "@/lib/validation/maintenance"
import { formatDate, formatDateTime, formatQty } from "@/lib/utils"
import { FleetDocumentsPanel } from "./fleet-documents-panel"

export const metadata: Metadata = { title: "Detalle de vehículo" }

export default async function FlotaVehiclePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("flota:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/flota")}`) }

  const { id } = await params
  const detail = await getFleetVehicleDetail(session, id)
  if (!detail) notFound()

  const vehicle = detail.vehicle

  return (
    <PageContainer>
      <PageHeader
        title={vehicle.plate}
        description={[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.equipmentType?.name || vehicle.type}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Vehículos", href: "/flota" },
            { label: vehicle.plate },
          ]} />
        }
        actions={
          <div className="flex justify-end gap-2">
            {can(session, "combustibles:view") && <Button asChild size="sm" variant="secondary">
              <Link href={`/combustibles?vehicle=${vehicle.id}`}>Combustible</Link>
            </Button>}
            {can(session, "mantenciones:view") && <Button asChild size="sm" variant="secondary">
              <Link href={`/mantenciones?vehicle=${vehicle.id}`}>Mantenciones</Link>
            </Button>}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle as="h2" className="text-base">Operación</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Fact label="Faena" value={vehicle.worksite?.name ?? "Sin faena"} />
            <Fact label="Tipo" value={vehicle.equipmentType?.name ?? vehicle.type} />
            <Fact label="Rendimiento" value={vehicle.performanceUnit === "km_per_liter" ? "km/L" : vehicle.performanceUnit === "liters_per_hour" ? "L/h" : "No aplica"} />
            <Fact label="Capacidad" value={vehicle.tankCapacityLiters != null ? formatQty(Number(vehicle.tankCapacityLiters), "L") : "Sin información"} />
            <Fact label="Proveedor habitual" value={vehicle.usualFuelSupplier?.name ?? "No asignado"} />
            <Fact label="Responsable" value={vehicle.responsibleUser?.name ?? vehicle.responsibleUser?.email ?? "—"} />
            <Fact label="Estado" value={<Badge variant={vehicle.operationalStatus === "operativo" ? "success" : "outline"}>{formatFuelVehicleStatus(vehicle.operationalStatus)}</Badge>} />
            <Fact label="Próximo vencimiento" value={detail.nextExpiryDate ? formatDate(detail.nextExpiryDate) : "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle as="h2" className="text-base">Vencimientos</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Fact label="SOAP" value={vehicle.soapExpiresAt ? formatDate(vehicle.soapExpiresAt) : "—"} />
            <Fact label="Revisión técnica" value={vehicle.technicalReviewExpiresAt ? formatDate(vehicle.technicalReviewExpiresAt) : "—"} />
            <Fact label="Permiso circulación" value={vehicle.circulationPermitExpiresAt ? formatDate(vehicle.circulationPermitExpiresAt) : "—"} />
            <Fact label="Seguro" value={vehicle.insuranceExpiresAt ? formatDate(vehicle.insuranceExpiresAt) : "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle as="h2" className="text-base">Seguro</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Fact label="Póliza" value={vehicle.insurancePolicyNumber ?? "—"} />
            <Fact label="Estado catálogo" value={vehicle.isActive ? "Activo" : "Inactivo"} />
            <Fact label="Notas" value={vehicle.notes ?? "—"} />
          </CardContent>
        </Card>
      </div>

      {(detail.currentReading || detail.topOperators.length > 0) && (
        <Card>
          <CardHeader><CardTitle as="h2" className="text-base">Uso operacional</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-3 text-sm">
              <Fact label="Código interno" value={vehicle.code ?? "—"} />
              {detail.currentReading ? (
                <>
                  <Fact
                    label="Última lectura"
                    value={
                      detail.currentReading.horometro != null
                        ? `${detail.currentReading.horometro} ${detail.currentReading.medidoPor === "hora" ? "hr" : detail.currentReading.medidoPor === "km" ? "km" : ""}`.trim()
                        : "—"
                    }
                  />
                  <Fact label="Fecha de lectura" value={detail.currentReading.fecha} />
                  <Fact label="Último operador" value={detail.currentReading.operador ?? "—"} />
                </>
              ) : (
                <p className="text-[var(--color-text-muted)]">Sin lecturas del log operacional de combustible.</p>
              )}
            </div>
            {detail.topOperators.length > 0 && (
              <div className="space-y-1.5 text-sm">
                <p className="text-[var(--color-text-muted)] mb-1">Operadores más frecuentes</p>
                {detail.topOperators.map((o) => (
                  <div key={o.operador} className="flex items-center justify-between gap-3">
                    <span>{o.operador}</span>
                    <span className="font-mono text-[var(--color-text-muted)]">{o.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle as="h2" className="text-base">Historial de estado operacional</CardTitle></CardHeader>
        <CardContent>
          {detail.operationalIntervals.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Sin intervalos históricos registrados.</p>
          ) : (
            <ol className="divide-y divide-[var(--color-border)]">
              {detail.operationalIntervals.map((interval) => (
                <li key={interval.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[10rem_1fr_auto] sm:items-center sm:gap-4">
                  <Badge variant={interval.status === "operativo" ? "success" : interval.status === "mantencion" ? "warning" : "danger"}>
                    {formatFuelVehicleStatus(interval.status)}
                  </Badge>
                  <div>
                    <p>{interval.reason ?? "Sin motivo informado"}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{interval.changedByUser?.name ?? interval.changedByUser?.email ?? "Usuario no disponible"}</p>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] sm:text-right">
                    {formatDateTime(interval.startedAt)}
                    <span className="block">{interval.endedAt ? `hasta ${formatDateTime(interval.endedAt)}` : "intervalo vigente"}</span>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {detail.recentMaintenance.length > 0 && (
        <Card>
          <CardHeader><CardTitle as="h2" className="text-base">Mantenciones y su efecto en el rendimiento</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">Rendimiento promedio del log operacional 30 días antes vs. 30 días después de cada mantención.</p>
            <ol className="divide-y divide-[var(--color-border)]">
              {detail.recentMaintenance.map((m) => {
                const impact = detail.maintenanceConsumptionImpact.find((i) => i.maintenanceId === m.id)
                return (
                  <li key={m.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[10rem_1fr_auto] sm:items-center sm:gap-4">
                    <span className="capitalize">{m.maintenanceType}</span>
                    <Badge variant={m.status === "completed" ? "success" : m.status === "cancelled" ? "default" : "outline"}>{MAINTENANCE_STATUS_LABELS[m.status as keyof typeof MAINTENANCE_STATUS_LABELS] ?? m.status}</Badge>
                    <p className="text-xs text-[var(--color-text-muted)] sm:text-right">
                      {formatDate(m.maintenanceDate)}
                      {impact && (impact.avgBefore != null || impact.avgAfter != null) ? (
                        <span className="block font-mono">{impact.avgBefore?.toFixed(2) ?? "—"} → {impact.avgAfter?.toFixed(2) ?? "—"}</span>
                      ) : (
                        <span className="block">Sin datos de rendimiento en la ventana de 30 días</span>
                      )}
                    </p>
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle as="h2" className="text-base">Documentos del vehículo</CardTitle></CardHeader>
        <CardContent>
          <FleetDocumentsPanel
            vehicleId={vehicle.id}
            canManageDocuments={can(session, "flota:manage_documents")}
            documents={detail.documents.map((document) => ({
              id: document.id,
              documentType: document.documentType,
              fileName: document.fileName,
              mimeType: document.mimeType ?? null,
              expiresAt: document.expiresAt ?? null,
              status: document.status,
              supersededAt: document.supersededAt ?? null,
              createdAt: document.createdAt,
            }))}
          />
        </CardContent>
      </Card>
    </PageContainer>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
