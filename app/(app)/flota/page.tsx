import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requirePermission } from "@/lib/auth/can"
import { getFleetOverview } from "@/lib/services/fleet"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { formatFuelVehicleStatus } from "@/lib/combustibles/validation"
import { FleetFilters } from "./fleet-filters"
import { FleetTableRow } from "./fleet-table-row"

export const metadata: Metadata = { title: "Flota" }

const CLP_FORMATTER = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 })
const NUMBER_FORMATTER = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 })
const formatCLP = (value: number) => CLP_FORMATTER.format(value)
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
  const now = new Date()
  const warningWindowEnd = new Date(now.getTime() + warningDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Client-side filtering after server fetch
  let filteredVehicles = vehicles
  if (filterEstado) {
    filteredVehicles = filteredVehicles.filter((v) => v.operationalStatus === filterEstado)
  }
  if (filterResponsable) {
    filteredVehicles = filteredVehicles.filter((v) => v.responsibleName === filterResponsable)
  }
  if (filterVencimiento) {
    const nowStr = now.toISOString().slice(0, 10)
    if (filterVencimiento === "vencidos") {
      filteredVehicles = filteredVehicles.filter((v) => v.nextExpiryDate && v.nextExpiryDate < nowStr)
    } else if (filterVencimiento === "proximos") {
      filteredVehicles = filteredVehicles.filter((v) => v.nextExpiryDate && v.nextExpiryDate >= nowStr && v.nextExpiryDate <= warningWindowEnd)
    } else if (filterVencimiento === "al-dia") {
      filteredVehicles = filteredVehicles.filter((v) => !v.nextExpiryDate || v.nextExpiryDate >= warningWindowEnd)
    }
  }

  // Extract unique filter options from vehicles
  const operationalStatuses = [...new Set(vehicles.flatMap((v) => v.operationalStatus ? [v.operationalStatus] : []))]
  const responsibleUsers = [...new Map(
    vehicles.filter((v) => v.responsibleName).map((v) => [v.responsibleName, { id: v.responsibleName!, name: v.responsibleName! }])
  ).values()]

  const active = vehicles.filter((vehicle) => vehicle.isActive).length
  const totalCost = vehicles.reduce((sum, vehicle) => sum + vehicle.totalOperationalCost, 0)
  const totalLiters = vehicles.reduce((sum, vehicle) => sum + vehicle.totalLiters, 0)
  const maintenanceCount = vehicles.reduce((sum, vehicle) => sum + vehicle.maintenanceCount, 0)

  const expiredVehicles = vehicles.filter((vehicle) => vehicle.nextExpiryDate && vehicle.nextExpiryDate < now.toISOString().slice(0, 10))
  const expiringSoon = vehicles.filter((vehicle) =>
    vehicle.nextExpiryDate &&
    vehicle.nextExpiryDate >= now.toISOString().slice(0, 10) &&
    vehicle.nextExpiryDate <= warningWindowEnd,
  )
  const showCostPerDistance = filteredVehicles.some((vehicle) => vehicle.costPerKm != null || vehicle.costPerHour != null)
  const showMeterReading = filteredVehicles.some((vehicle) => vehicle.lastOdometerReading != null || vehicle.lastHourMeterReading != null)
  const showLastMaintenance = filteredVehicles.some((vehicle) => vehicle.lastMaintenanceDate != null)
  const visibleColumnCount = 8 + Number(showCostPerDistance) + Number(showMeterReading) + Number(showLastMaintenance)
  const summaryStats: SummaryStat[] = [
    { key: "active", label: "Vehículos activos", value: active },
    { key: "cost", label: "Costo operacional", value: formatCLP(totalCost) },
    { key: "liters", label: "Litros registrados", value: formatNumber(totalLiters) },
    { key: "maintenance", label: "Mantenciones", value: maintenanceCount },
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
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Vehículo</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Próximo vencimiento</TableHead>
                <TableHead className="text-right">Combustible</TableHead>
                <TableHead className="text-right">Mantenciones</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {showCostPerDistance && <TableHead className="text-right">$/km·h</TableHead>}
                {showMeterReading && <TableHead className="text-right">Km/Hr</TableHead>}
                {showLastMaintenance && <TableHead>Última mantención</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumnCount} className="py-8 text-center text-muted-foreground">
                    No hay vehículos visibles para tu alcance.
                  </TableCell>
                </TableRow>
              ) : filteredVehicles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumnCount} className="py-8 text-center text-muted-foreground">
                    No hay vehículos que coincidan con los filtros.
                  </TableCell>
                </TableRow>
              ) : filteredVehicles.map((vehicle) => (
                <FleetTableRow key={vehicle.id} href={`/flota/${vehicle.id}`}>
                  <TableCell>
                    <span className="font-medium text-[var(--color-primary)]">{vehicle.plate}</span>
                    <div className="text-xs text-muted-foreground">
                      {[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.type}
                    </div>
                  </TableCell>
                  <TableCell>{vehicle.worksiteName}</TableCell>
                  <TableCell>
                    <Badge variant={vehicle.isActive && vehicle.operationalStatus === "operativo" ? "success" : "outline"}>
                      {vehicle.isActive ? formatFuelVehicleStatus(vehicle.operationalStatus) : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell>{vehicle.responsibleName ?? "—"}</TableCell>
                  <TableCell>{vehicle.nextExpiryDate ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatCLP(vehicle.totalFuelAmount)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCLP(vehicle.totalMaintenanceAmount)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatCLP(vehicle.totalOperationalCost)}</TableCell>
                  {showCostPerDistance && <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {vehicle.costPerKm != null
                      ? `${formatCLP(vehicle.costPerKm)}/km`
                      : vehicle.costPerHour != null
                        ? `${formatCLP(vehicle.costPerHour)}/h`
                        : "—"}
                  </TableCell>}
                  {showMeterReading && <TableCell className="text-right font-mono">
                    {vehicle.lastOdometerReading != null
                      ? formatNumber(vehicle.lastOdometerReading)
                      : vehicle.lastHourMeterReading != null
                        ? `${formatNumber(vehicle.lastHourMeterReading)} h`
                        : "—"}
                  </TableCell>}
                  {showLastMaintenance && <TableCell>{vehicle.lastMaintenanceDate ?? "—"}</TableCell>}
                </FleetTableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
