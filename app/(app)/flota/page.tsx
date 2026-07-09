import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requirePermission } from "@/lib/auth/can"
import { getFleetOverview } from "@/lib/services/fleet"
import { FleetFilters } from "./fleet-filters"

export const metadata: Metadata = { title: "Flota" }

const formatCLP = (value: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value)

const formatNumber = (value: number) =>
  new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value)

export default async function FlotaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("flota:view") }
  catch { redirect("/forbidden") }

  const vehicles = await getFleetOverview(session)
  const sp = await searchParams
  const filterEstado = typeof sp.estado === "string" ? sp.estado : undefined
  const filterResponsable = typeof sp.responsable === "string" ? sp.responsable : undefined
  const filterVencimiento = typeof sp.vencimiento === "string" ? sp.vencimiento : undefined

  const now = new Date()
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

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
      filteredVehicles = filteredVehicles.filter((v) => v.nextExpiryDate && v.nextExpiryDate >= nowStr && v.nextExpiryDate <= thirtyDays)
    } else if (filterVencimiento === "al-dia") {
      filteredVehicles = filteredVehicles.filter((v) => !v.nextExpiryDate || v.nextExpiryDate >= thirtyDays)
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
    vehicle.nextExpiryDate <= thirtyDays,
  )

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
            <Link href="/combustibles/vehiculos">Gestionar vehículos</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric title="Vehículos activos" value={active} />
        <Metric title="Costo operacional" value={formatCLP(totalCost)} />
        <Metric title="Litros registrados" value={formatNumber(totalLiters)} />
        <Metric title="Mantenciones" value={maintenanceCount} />
      </div>

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
              <strong>Próximos a vencer (30 días):</strong>{" "}
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
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vehículos</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[980px]">
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
                <TableHead className="text-right">Km/Hr</TableHead>
                <TableHead>Última mantención</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                    No hay vehículos visibles para tu alcance.
                  </TableCell>
                </TableRow>
              ) : filteredVehicles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                    No hay vehículos que coincidan con los filtros.
                  </TableCell>
                </TableRow>
              ) : filteredVehicles.map((vehicle) => (
                <TableRow key={vehicle.id}>
                  <TableCell>
                    <Link href={`/flota/${vehicle.id}`} className="font-medium text-[var(--color-primary)] underline-offset-2 hover:underline">
                      {vehicle.plate}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.type}
                    </div>
                  </TableCell>
                  <TableCell>{vehicle.worksiteName}</TableCell>
                  <TableCell>
                    <Badge variant={vehicle.isActive && vehicle.operationalStatus === "operativo" ? "success" : "outline"}>
                      {vehicle.isActive ? vehicle.operationalStatus : "inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell>{vehicle.responsibleName ?? "—"}</TableCell>
                  <TableCell>{vehicle.nextExpiryDate ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatCLP(vehicle.totalFuelAmount)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCLP(vehicle.totalMaintenanceAmount)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatCLP(vehicle.totalOperationalCost)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {vehicle.lastOdometerReading != null
                      ? formatNumber(vehicle.lastOdometerReading)
                      : vehicle.lastHourMeterReading != null
                        ? `${formatNumber(vehicle.lastHourMeterReading)} h`
                        : "—"}
                  </TableCell>
                  <TableCell>{vehicle.lastMaintenanceDate ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/combustibles?vehicle=${vehicle.id}`}>Combustible</Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/mantenciones?vehicle=${vehicle.id}`}>Mantenciones</Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/flota/${vehicle.id}`}>Detalle</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageContainer>
  )
}

function Metric({ title, value }: { title: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  )
}
