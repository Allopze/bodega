import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { can, requirePermission } from "@/lib/auth/can"
import { MAINTENANCE_HISTORY_LIMIT, getMaintenancePageData, getUpcomingMaintenance, getUsageMaintenanceAlerts } from "@/lib/services/maintenance"
import { MaintenanceCreateButton } from "./maintenance-create-button"
import { MaintenanceTable } from "./maintenance-table"
import { MaintenanceFilters } from "./maintenance-filters"
import { formatDate } from "@/lib/utils"
import { MAINTENANCE_STATUS_LABELS } from "@/lib/validation/maintenance"

export const metadata: Metadata = { title: "Mantenciones" }

/** El tipo se guarda como slug; la tabla lo pintaba crudo ("revision_tecnica"). */
const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  preventiva: "Preventiva",
  correctiva: "Correctiva",
  neumaticos: "Neumáticos",
  lubricacion: "Lubricación",
  revision_tecnica: "Revisión técnica",
}
const maintenanceTypeLabel = (value: string) => MAINTENANCE_TYPE_LABELS[value] ?? value

const statusLabels: Record<string, { label: string; variant: "default" | "warning" | "success" | "danger" | "outline" }> = {
  scheduled: { label: MAINTENANCE_STATUS_LABELS.scheduled, variant: "outline" },
  in_progress: { label: MAINTENANCE_STATUS_LABELS.in_progress, variant: "warning" },
  completed: { label: MAINTENANCE_STATUS_LABELS.completed, variant: "success" },
  cancelled: { label: MAINTENANCE_STATUS_LABELS.cancelled, variant: "danger" },
}

const NUMBER_FORMAT = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 })

const formatNumber = (value: number | null) =>
  value == null ? "—" : NUMBER_FORMAT.format(value)

export default async function MantencionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("mantenciones:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const vehicleId = typeof sp.vehicle === "string" ? sp.vehicle : undefined
  const worksiteId = typeof sp.faena === "string" ? sp.faena : undefined
  const status = typeof sp.status === "string" ? sp.status : undefined
  const [data, upcomingData, usageAlerts] = await Promise.all([
    getMaintenancePageData(session, { vehicleId, worksiteId, status }),
    getUpcomingMaintenance(session),
    getUsageMaintenanceAlerts(session),
  ])
  const canCreate = can(session, "mantenciones:create")
  const canEdit = can(session, "mantenciones:edit")
  const canViewCosts = can(session, "combustibles:view_costs")
  const hasActiveFilters = Boolean(vehicleId || worksiteId || status)

  // Listas de opciones compartidas por el formulario de alta y la edición por
  // fila. La faena viaja con cada opción: el centro de costo se valida en el
  // servidor contra la faena del EQUIPO, no contra el alcance del actor, así que
  // el formulario necesita el mismo eje para no ofrecer lo que será rechazado.
  const vehicleOptions = data.vehicles.map((vehicle) => ({ id: vehicle.id, plate: vehicle.plate, type: vehicle.type, worksiteId: vehicle.worksiteId }))
  const supplierOptions = data.suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))
  const costCenterOptions = data.costCenters.map((center) => ({ id: center.id, code: center.code, name: center.name, worksiteId: center.worksiteId }))

  return (
    <PageContainer>
      <PageHeader
        title="Mantenciones"
        description={canViewCosts ? "Registro operativo de servicios, costos, kilometraje, horómetro y documentos de flota." : "Registro operativo de servicios, kilometraje, horómetro y documentos de flota."}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Control operacional", href: "/" },
            { label: "Mantenciones" },
          ]} />
        }
        actions={
          <div className="flex items-center gap-2">
            {can(session, "flota:view") && <Button asChild size="sm" variant="secondary">
              <Link href="/flota">Ver flota</Link>
            </Button>}
            {canCreate && (
              <MaintenanceCreateButton
                vehicles={vehicleOptions}
                suppliers={supplierOptions}
                costCenters={costCenterOptions}
                canViewCosts={canViewCosts}
              />
            )}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <MaintenanceFilters
            vehicles={data.vehicles}
            worksites={data.worksites}
            statusLabels={statusLabels}
            current={{ vehicle: vehicleId, faena: worksiteId, status }}
          />
        </CardContent>
      </Card>

      {(upcomingData.overdue.length > 0 || upcomingData.upcoming.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Planificación preventiva</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {upcomingData.overdue.length > 0 && (
                <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-tint)] p-3 text-sm">
                  <strong className="text-[var(--color-danger-ink)]">Mantenciones vencidas:</strong>
                  {upcomingData.overdue.map((m) => (
                    <span key={m.id} className="ml-2 text-[var(--color-danger-ink)]">
                      {m.vehicle?.plate ?? m.vehicleId} ({formatDate(m.maintenanceDate)}): {maintenanceTypeLabel(m.maintenanceType)}
                    </span>
                  ))}
                </div>
              )}
              {upcomingData.upcoming.length > 0 && (
                <div className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-sm">
                  <strong className="text-[var(--color-warning-ink)]">Próximas (30 días):</strong>
                  {upcomingData.upcoming.map((m) => (
                    <span key={m.id} className="ml-2 text-[var(--color-warning-ink)]">
                      {m.vehicle?.plate ?? m.vehicleId} ({formatDate(m.maintenanceDate)}): {maintenanceTypeLabel(m.maintenanceType)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {usageAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mantención por uso</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-sm space-y-1">
              <p className="text-[var(--color-warning-ink)]">
                Equipos que acumularon uso significativo desde su última mantención completada
                (según el log operacional de combustible):
              </p>
              {usageAlerts.map((a) => (
                <p key={a.vehicleId} className="text-[var(--color-warning-ink)]">
                  {a.code ? `${a.code} · ` : ""}{a.plate}:{" "}
                  {a.possibleMeterReset
                    ? <>posible reset de medidor — verifica: lectura actual {formatNumber(a.currentReading)} al {formatDate(a.currentReadingDate)} es menor que la de la última mantención ({formatNumber(a.lastMaintenanceReading)} al {formatDate(a.lastMaintenanceDate)})</>
                    : <>+{formatNumber(a.usageSinceLastMaintenance)} {a.medidoPor === "km" ? "km" : "hr"} desde {formatDate(a.lastMaintenanceDate)} (lectura actual {formatNumber(a.currentReading)} al {formatDate(a.currentReadingDate)})</>}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial</CardTitle>
          {/* El servicio corta en 100 filas: sin este aviso la tabla se leía
              como el historial completo y los filtros como decorativos. */}
          {data.records.length >= MAINTENANCE_HISTORY_LIMIT && (
            <p className="text-xs text-[var(--color-text-muted)]">
              Mostrando las {MAINTENANCE_HISTORY_LIMIT} mantenciones más recientes. Filtra por vehículo, faena o estado para acotar el historial.
            </p>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <MaintenanceTable
            records={data.records}
            canEdit={canEdit}
            canCreate={canCreate}
            canViewCosts={canViewCosts}
            hasActiveFilters={hasActiveFilters}
            statusLabels={statusLabels}
            vehicleOptions={vehicleOptions}
            supplierOptions={supplierOptions}
            costCenterOptions={costCenterOptions}
          />
        </CardContent>
      </Card>
    </PageContainer>
  )
}
