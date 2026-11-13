import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MetaBadge, StateBadge } from "@/components/states/state-badge"
import { VehiclePurchasesCard } from "@/components/fleet/vehicle-purchases-card"
import { Button } from "@/components/ui/button"
import { can, requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { getFleetVehicleDetail } from "@/lib/services/fleet"
import { hasMaintenanceProfile } from "@/lib/services/mantencion/equipment"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { FUEL_PERFORMANCE_UNIT_LABELS, VEHICLE_EXPIRY_FIELDS } from "@/lib/combustibles/validation"
import { CANONICAL_FIELD_LABEL, expiringDocuments } from "@/lib/validation/fleet-documents"
import { formatDate, formatDateTime, formatQty, todayInChile } from "@/lib/utils"
import { OT_STATUS_LABELS, OT_STATUS_TONES } from "@/lib/mantencion/work-order-states"
import { FleetDocumentUpload, FleetDocumentsPanel } from "./fleet-documents-panel"
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
  // La ficha de Mantención existe sólo si el vehículo ya fue incorporado (tiene perfil).
  const canViewMaintenance = can(session, "mant:records:view_worksite") || can(session, "mant:records:view_all") || can(session, "mant:equipment:manage")
  const maintenanceHref = canViewMaintenance && await hasMaintenanceProfile(vehicle.id) ? `/mantencion/equipos/${encodeURIComponent(vehicle.id)}` : null

  return (
    <PageContainer>
      <PageHeader
        // El código interno es el nombre con que se conoce el vehículo en el resto del área; la patente va a su lado.
        title={vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.plate}
        description={[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.equipmentType?.name || vehicle.type}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Control operacional", href: "/control-operacional" },
            { label: "Vehículos", href: "/flota" },
            { label: vehicle.code ?? vehicle.plate },
          ]} />
        }
        actions={
          <div className="flex justify-end gap-2">
            {can(session, "combustibles:view") && <Button asChild size="sm" variant="secondary">
              <Link href={fuelEquipmentHref(vehicle.id)}>Combustible</Link>
            </Button>}
            {maintenanceHref && <Button asChild size="sm" variant="secondary">
              <Link href={maintenanceHref}>Ficha de mantención</Link>
            </Button>}
            {detail.recentWorkOrders && <Button asChild size="sm" variant="secondary">
              <Link href={`/mantencion/ot?equipo=${vehicle.id}&estado=abiertas`}>Ver órdenes de trabajo</Link>
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
            {/* Un vehículo dado de baja es «Inactivo» sea cual sea su último estado operativo; el catálogo no necesita una fila aparte. */}
            <Fact label="Estado" value={<StateBadge entity="fleet" state={vehicle.isActive ? vehicle.operationalStatus : "inactivo"} />} />
            <Fact label="Notas" value={vehicle.notes ?? "—"} />
          </CardContent>
        </Card>

        {/* Vencimientos, seguro y archivos en una sola tarjeta: eran tres, con «Próximo vencimiento» dicho dos veces. */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle as="h2" className="text-base">Documentos</CardTitle>
            {can(session, "flota:manage_documents") && <FleetDocumentUpload vehicleId={vehicle.id} />}
          </CardHeader>
          <CardContent className="space-y-6">
            <section aria-labelledby="documentos-vencimientos" className="space-y-3">
              <h3 id="documentos-vencimientos" className="text-eyebrow">Vencimientos</h3>
              <VehicleExpiries
                vehicleId={vehicle.id}
                vehicleLabel={vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.plate}
                rows={expiryRows}
                today={todayInChile()}
                warningDays={warningDays}
                canEdit={canEditExpiries}
              />
              <div className="text-sm">
                <Fact label="Póliza del seguro" value={vehicle.insurancePolicyNumber ?? "—"} />
              </div>
            </section>
            <section aria-labelledby="documentos-archivos" className="space-y-3">
              <h3 id="documentos-archivos" className="text-eyebrow">Archivos</h3>
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
            </section>
          </CardContent>
        </Card>
      </div>

      {(detail.currentReading || detail.providerReading || detail.topOperators.length > 0) && (
        <Card>
          <CardHeader><CardTitle as="h2" className="text-base">Uso operacional</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-3 text-sm">
              {detail.providerReading ? (
                <>
                  <Fact
                    label="Última lectura del proveedor (Copec)"
                    value={
                      detail.providerReading.odometer != null
                        ? formatQty(detail.providerReading.odometer, "km", { maximumFractionDigits: 1 })
                        : detail.providerReading.hourMeter != null
                          ? formatQty(detail.providerReading.hourMeter, "h", { maximumFractionDigits: 1 })
                          : "—"
                    }
                  />
                  <Fact label="Fecha de lectura del proveedor" value={formatDateTime(detail.providerReading.occurredAt)} />
                </>
              ) : (
                <Fact label="Última lectura del proveedor (Copec)" value="Sin lecturas" />
              )}
              {detail.currentReading ? (
                <>
                  {/* La lista de Vehículos usa la lectura del proveedor
                      (Copec); ésta es la del log operacional de cargas. Misma
                      etiqueta sin aclarar la fuente hacía que dos pantallas
                      mostraran cifras distintas del mismo equipo. */}
                  <Fact
                    label="Última lectura (log de cargas)"
                    value={
                      detail.currentReading.horometro != null
                        ? formatQty(Number(detail.currentReading.horometro), detail.currentReading.medidoPor === "hora" ? "h" : detail.currentReading.medidoPor === "km" ? "km" : undefined, { maximumFractionDigits: 1 })
                        : "—"
                    }
                  />
                  <Fact label="Fecha de lectura" value={formatDate(detail.currentReading.fecha)} />
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
                  <StateBadge entity="fleet" state={interval.status} />
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
                <Link href={`/mantencion/ot?equipo=${vehicle.id}&estado=abiertas`} className="text-[var(--color-primary-ink)] underline underline-offset-4">Órdenes de trabajo</Link>.
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
                            <span className="block font-mono">{formatPerformanceAvg(impact.avgBefore, vehicle.performanceUnit)} → {formatPerformanceAvg(impact.avgAfter, vehicle.performanceUnit, true)}</span>
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

      {detail.recentPurchases && (
        <VehiclePurchasesCard
          records={detail.recentPurchases}
          canOpenRequests={can(session, "repuestos:view_all")}
          // Esta tarjeta sólo se dibuja con `purchasing:view`, que es lo que abre la OC.
          canOpenOrders
          // La ficha del repuesto de catálogo es del catálogo (`repuestos:catalog`), no de las compras.
          canOpenSpareParts={can(session, "repuestos:catalog")}
          // Un equipo dado de baja no admite solicitudes nuevas (el formulario lo rechazaría).
          newRequestHref={can(session, "repuestos:create") && vehicle.isActive ? `/solicitudes/nueva?tipo=repuestos&vehiculo=${vehicle.id}` : null}
        />
      )}

    </PageContainer>
  )
}

/** Rendimiento con coma decimal y la unidad del equipo; la unidad va sólo al final del par «antes → después». */
function formatPerformanceAvg(value: number | null | undefined, performanceUnit: string, withUnit = false): string {
  if (value == null) return "—"
  const unit = performanceUnit === "km_per_liter" ? "km/L" : performanceUnit === "liters_per_hour" ? "L/h" : undefined
  return formatQty(value, withUnit ? unit : undefined, { maximumFractionDigits: 2 })
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
