import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { Button } from "@/components/ui/button"
import { requirePermission } from "@/lib/auth/can"
import { getFleetOverview } from "@/lib/services/fleet"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { addDaysToPlainDate, formatCLP, todayInChile } from "@/lib/utils"
import { FleetFilters } from "./fleet-filters"
import { FleetTable } from "./fleet-table"

export const metadata: Metadata = { title: "Flota" }

const NUMBER_FORMATTER = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 })
const formatNumber = (value: number) => NUMBER_FORMATTER.format(value)

export default async function FlotaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("flota:view") }
  catch { redirect("/forbidden") }

  const [vehicles, fleetSettings] = await Promise.all([
    getFleetOverview(session),
    getFleetAdminSettings(),
  ])
  const sp = await searchParams
  const filterEstado = typeof sp.estado === "string" ? sp.estado : undefined
  const filterResponsable = typeof sp.responsable === "string" ? sp.responsable : undefined
  const filterVencimiento = typeof sp.vencimiento === "string" ? sp.vencimiento : undefined

  const warningDays = fleetSettings.warningDays
  // Las columnas de vencimiento son fechas civiles chilenas: medirlas con
  // `toISOString()` (siempre UTC) adelantaba el corte del día y marcaba como
  // vencido, entre las 20:00 y la medianoche, lo que vence hoy.
  const today = todayInChile()
  const warningWindowEnd = addDaysToPlainDate(today, warningDays)

  // Client-side filtering after server fetch
  let filteredVehicles = vehicles
  if (filterEstado) {
    filteredVehicles = filteredVehicles.filter((v) => v.operationalStatus === filterEstado)
  }
  if (filterResponsable) {
    filteredVehicles = filteredVehicles.filter((v) => v.responsibleName === filterResponsable)
  }
  if (filterVencimiento) {
    if (filterVencimiento === "vencidos") {
      filteredVehicles = filteredVehicles.filter((v) => v.nextExpiryDate && v.nextExpiryDate < today)
    } else if (filterVencimiento === "proximos") {
      filteredVehicles = filteredVehicles.filter((v) => v.nextExpiryDate && v.nextExpiryDate >= today && v.nextExpiryDate <= warningWindowEnd)
    } else if (filterVencimiento === "al-dia") {
      // `>` y no `>=`: con `>=` el vehículo que vence justo el último día de la
      // ventana caía a la vez en "Próximos a vencer" y en "Al día".
      filteredVehicles = filteredVehicles.filter((v) => !v.nextExpiryDate || v.nextExpiryDate > warningWindowEnd)
    }
  }

  // Extract unique filter options from vehicles
  const operationalStatuses = [...new Set(vehicles.flatMap((v) => v.operationalStatus ? [v.operationalStatus] : []))]
  const responsibleUsers = [...new Map(
    vehicles.filter((v) => v.responsibleName).map((v) => [v.responsibleName, { id: v.responsibleName!, name: v.responsibleName! }])
  ).values()]

  // Sobre el conjunto filtrado, no sobre el total: con un filtro activo la fila
  // de cifras contradecía a la tabla que tiene debajo.
  const active = filteredVehicles.filter((vehicle) => vehicle.isActive).length
  const totalCost = filteredVehicles.reduce((sum, vehicle) => sum + vehicle.totalOperationalCost, 0)
  const totalLiters = filteredVehicles.reduce((sum, vehicle) => sum + vehicle.totalLiters, 0)
  const maintenanceCount = filteredVehicles.reduce((sum, vehicle) => sum + vehicle.maintenanceCount, 0)

  const expiredVehicles = filteredVehicles.filter((vehicle) => vehicle.nextExpiryDate && vehicle.nextExpiryDate < today)
  const expiringSoon = filteredVehicles.filter((vehicle) =>
    vehicle.nextExpiryDate &&
    vehicle.nextExpiryDate >= today &&
    vehicle.nextExpiryDate <= warningWindowEnd,
  )
  // El servicio agrega combustible y mantenciones de los últimos 12 meses
  // (lib/services/fleet.ts): la etiqueta lo dice para que la cifra no se lea
  // como el histórico completo del vehículo.
  const summaryStats: SummaryStat[] = [
    { key: "active", label: "Vehículos activos", value: active },
    { key: "cost", label: "Costo operacional (12 meses)", value: formatCLP(totalCost) },
    { key: "liters", label: "Litros registrados (12 meses)", value: formatNumber(totalLiters) },
    { key: "maintenance", label: "Mantenciones (12 meses)", value: maintenanceCount },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Flota"
        description="Catálogo operativo de vehículos con costo de combustible, mantenciones e imputaciones."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Control operacional", href: "/" },
            { label: "Flota" },
          ]} />
        }
        headerActions={
          <Button asChild size="sm" variant="secondary">
            <Link href="/admin/flota-catalogos/vehiculos">Gestionar vehículos</Link>
          </Button>
        }
      />

      <SummaryBar stats={summaryStats} />

      {(expiredVehicles.length > 0 || expiringSoon.length > 0) && (
        <div className="flex flex-col gap-2">
          {expiredVehicles.length > 0 && (
            <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-tint)] p-3 text-sm text-[var(--color-danger-ink)]">
              <strong>Documentos vencidos:</strong>{" "}
              {expiredVehicles.map((v) => v.plate).join(", ")}
            </div>
          )}
          {expiringSoon.length > 0 && (
            <div className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
              <strong>Próximos a vencer ({warningDays} días):</strong>{" "}
              {expiringSoon.map((v) => v.plate).join(", ")}
            </div>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros avanzados</CardTitle>
        </CardHeader>
        <CardContent>
          <FleetFilters
            operationalStatuses={operationalStatuses}
            responsibleUsers={responsibleUsers}
            current={{ estado: filterEstado, responsable: filterResponsable, vencimiento: filterVencimiento }}
            warningDays={warningDays}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vehículos</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <FleetTable vehicles={filteredVehicles} hasAnyVehicle={vehicles.length > 0} />
        </CardContent>
      </Card>
    </PageContainer>
  )
}
