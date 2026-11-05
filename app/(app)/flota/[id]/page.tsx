import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { can, requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { getFleetVehicleDetail } from "@/lib/services/fleet"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { FUEL_PERFORMANCE_UNIT_LABELS, VEHICLE_EXPIRY_FIELDS, formatFuelVehicleStatus } from "@/lib/combustibles/validation"
import { CANONICAL_FIELD_LABEL, expiringDocuments } from "@/lib/validation/fleet-documents"
import { formatDate, formatDateTime, formatQty, todayInChile } from "@/lib/utils"
import { OT_STATUS_LABELS, OT_STATUS_TONES } from "@/lib/mantencion/work-order-states"
import { FleetDocumentsPanel } from "./fleet-documents-panel"
import { VehicleExpiries } from "./vehicle-expiries"
import { fuelEquipmentHref } from "@/lib/combustibles/routes"

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

  // La fecha que rige de cada documento: la guardada en el equipo y, a falta de ella, la del documento
  // vigente subido (`expiringDocuments`, la misma precedencia que la lista y los avisos). Aquí solo se
  // recoge el origen; la tarjeta calcula el estado y ordena.
  const { warningDays } = await getFleetAdminSettings()
  const expiring = new Map(expiringDocuments(
    {
      soapExpiresAt: vehicle.soapExpiresAt,
      technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
      circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
      insuranceExpiresAt: vehicle.insuranceExpiresAt,
    },
    detail.documents.filter((document) => document.status === "current"),
  ).map((entry) => [entry.documentType, entry]))
  const expiryRows = VEHICLE_EXPIRY_FIELDS.map((field) => {
    const label = CANONICAL_FIELD_LABEL[field]
    const entry = expiring.get(label)
    return {
      field,
      label,
      declared: vehicle[field] ?? null,
      documentExpiresAt: entry?.source === "document" ? entry.expiresAt : null,
    }
  })
  const canEditExpiries = can(session, "flota:manage_documents") && canAccessWorksite(session, vehicle.worksiteId)

  return (
    <PageContainer>
      <PageHeader
        title={vehicle.plate}
        description={[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.equipmentType?.name || vehicle.type}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Control operacional", href: "/control-operacional" },
            { label: "Vehículos", href: "/flota" },
            { label: vehicle.plate },
          ]} />
        }
        actions={
          <div className="flex justify-end gap-2">
            {can(session, "combustibles:view") && <Button asChild size="sm" variant="secondary">
              <Link href={fuelEquipmentHref(vehicle.id)}>Combustible</Link>
            </Button>}
            {detail.recentWorkOrders && <Button asChild size="sm" variant="secondary">
              <Link href={`/mantencion/ot?equipo=${vehicle.id}`}>Ver órdenes de trabajo</Link>
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
            <Fact label="N.º de serie" value={vehicle.serialNumber ?? "—"} />
            {/* Es la unidad del catálogo, no una medición: rotulada «Rendimiento» se leía como un valor sin cifra («km/L» a secas). */}
            <Fact label="Unidad de rendimiento" value={FUEL_PERFORMANCE_UNIT_LABELS[vehicle.performanceUnit as keyof typeof FUEL_PERFORMANCE_UNIT_LABELS] ?? "No aplica"} />
            <Fact label="Capacidad" value={vehicle.tankCapacityLiters != null ? formatQty(Number(vehicle.tankCapacityLiters), "L") : "Sin información"} />
            <Fact label="Proveedor habitual" value={vehicle.usualFuelSupplier?.name ?? "No asignado"} />
            <Fact label="Responsable" value={vehicle.responsibleUser?.name ?? vehicle.responsibleUser?.email ?? "—"} />
            <Fact label="Estado" value={<MetaBadge meta={{ label: `${formatFuelVehicleStatus(vehicle.operationalStatus)}`, variant: vehicle.operationalStatus === "operativo" ? "success" : "outline" }} />} />
            <Fact label="Próximo vencimiento" value={detail.nextExpiryDate ? formatDate(detail.nextExpiryDate) : "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle as="h2" className="text-base">Vencimientos</CardTitle></CardHeader>
          <CardContent>
            <VehicleExpiries
              vehicleId={vehicle.id}
              vehicleLabel={vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.plate}
              rows={expiryRows}
              today={todayInChile()}
              warningDays={warningDays}
              canEdit={canEditExpiries}
            />
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
                  <MetaBadge meta={{ label: `${formatFuelVehicleStatus(interval.status)}`, variant: interval.status === "operativo" ? "success" : interval.status === "mantencion" ? "warning" : "danger" }} />
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

      {detail.recentWorkOrders && (
        <Card>
          <CardHeader><CardTitle as="h2" className="text-base">Órdenes de trabajo y su efecto en el rendimiento</CardTitle></CardHeader>
          <CardContent>
            {detail.recentWorkOrders.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Este equipo aún no tiene órdenes de trabajo. Se piden desde{" "}
                <Link href={`/mantencion/ot?equipo=${vehicle.id}`} className="text-[var(--color-primary-ink)] underline-offset-4 hover:underline">Órdenes de trabajo</Link>.
              </p>
            ) : (
              <>
                {detail.workOrderConsumptionImpact.length > 0 && (
                  <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                    En las órdenes cerradas: rendimiento promedio del log operacional 30 días antes vs. 30 días después de la salida de taller.
                  </p>
                )}
                <ol className="divide-y divide-[var(--color-border)]">
                  {detail.recentWorkOrders.map((workOrder) => {
                    const impact = detail.workOrderConsumptionImpact.find((item) => item.workOrderId === workOrder.id)
                    const kind = [workOrder.repair ? "Reparación" : null, workOrder.maintenance ? "Mantención" : null].filter(Boolean).join(" y ")
                    return (
                      <li key={workOrder.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[10rem_1fr_auto] sm:items-center sm:gap-4">
                        <Link href={`/mantencion/ot/${workOrder.id}`} className="font-mono text-[var(--color-primary-ink)] underline-offset-4 hover:underline">
                          {workOrder.folio}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2">
                          <MetaBadge meta={{ label: OT_STATUS_LABELS[workOrder.status], variant: OT_STATUS_TONES[workOrder.status] }} />
                          <span className="text-xs text-[var(--color-text-muted)]">{kind}</span>
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)] sm:text-right">
                          Pedida el {formatDate(workOrder.requestDate)}
                          {workOrder.workshopEntryAt && (
                            <span className="block">
                              Taller: {formatDateTime(workOrder.workshopEntryAt)}
                              {workOrder.workshopExitAt ? ` → ${formatDateTime(workOrder.workshopExitAt)}` : " → sigue en taller"}
                            </span>
                          )}
                          {impact && (impact.avgBefore != null || impact.avgAfter != null) && (
                            <span className="block font-mono">{impact.avgBefore?.toFixed(2) ?? "—"} → {impact.avgAfter?.toFixed(2) ?? "—"}</span>
                          )}
                        </p>
                      </li>
                    )
                  })}
                </ol>
              </>
            )}
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
