"use client"

import * as React from "react"
import { DataTable } from "@/components/admin/data-table"
import { TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatFuelVehicleStatus } from "@/lib/combustibles/validation"
import { formatCLP, formatDate } from "@/lib/utils"
import type { getFleetOverview } from "@/lib/services/fleet"
import { FleetTableRow } from "./fleet-table-row"

type VehicleRow = Awaited<ReturnType<typeof getFleetOverview>>[number]

const NUMBER_FORMATTER = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 })
const formatNumber = (value: number) => NUMBER_FORMATTER.format(value)

export function FleetTable({ vehicles, hasAnyVehicle }: { vehicles: VehicleRow[]; hasAnyVehicle: boolean }) {
  const showCostPerDistance = vehicles.some((v) => v.costPerKm != null || v.costPerHour != null)
  const showMeterReading = vehicles.some((v) => v.lastOdometerReading != null || v.lastHourMeterReading != null)
  const showLastMaintenance = vehicles.some((v) => v.lastMaintenanceDate != null)

  const columns = React.useMemo(() => [
    { key: "plate", label: "Vehículo", sortable: true },
    { key: "worksiteName", label: "Faena", sortable: true },
    { key: "operationalStatus", label: "Estado", sortable: true },
    { key: "responsibleName", label: "Responsable", sortable: true },
    { key: "nextExpiryDate", label: "Próximo vencimiento", sortable: true },
    { key: "totalFuelAmount", label: "Combustible", sortable: true, numeric: true },
    { key: "totalMaintenanceAmount", label: "Mantenciones", sortable: true, numeric: true },
    { key: "totalOperationalCost", label: "Total", sortable: true, numeric: true },
    ...(showCostPerDistance ? [{ key: "_costPerDistance", label: "$/km·h", sortable: false, numeric: true }] : []),
    ...(showMeterReading ? [{ key: "_meterReading", label: "Km/Hr", sortable: false, numeric: true }] : []),
    ...(showLastMaintenance ? [{ key: "lastMaintenanceDate", label: "Última mantención", sortable: true }] : []),
  ], [showCostPerDistance, showMeterReading, showLastMaintenance])

  return (
    <DataTable
      caption="Vehículos de la flota"
      columns={columns}
      rows={vehicles}
      searchKeys={["plate", "brand", "model", "worksiteName", "responsibleName"]}
      tableClassName="min-w-[760px]"
      pageSize={25}
      emptyTitle={hasAnyVehicle ? "Sin coincidencias" : "Sin vehículos visibles"}
      emptyDescription={hasAnyVehicle ? "No hay vehículos que coincidan con los filtros." : "No hay vehículos visibles para tu alcance."}
      renderRow={(vehicle) => {
        return (
          <FleetTableRow key={vehicle.id} href={`/flota/${vehicle.id}`}>
            <TableCell>
              <span className="font-medium text-[var(--color-primary)]">{vehicle.plate}</span>
              <div className="text-xs text-[var(--color-text-muted)]">
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
            <TableCell>{vehicle.nextExpiryDate ? formatDate(vehicle.nextExpiryDate) : "—"}</TableCell>
            <TableCell className="text-right font-mono">{formatCLP(vehicle.totalFuelAmount)}</TableCell>
            <TableCell className="text-right font-mono">{formatCLP(vehicle.totalMaintenanceAmount)}</TableCell>
            <TableCell className="text-right font-mono font-semibold">{formatCLP(vehicle.totalOperationalCost)}</TableCell>
            {showCostPerDistance && <TableCell className="text-right font-mono text-xs text-[var(--color-text-muted)]">
              {vehicle.costPerKm != null
                ? `${formatCLP(vehicle.costPerKm)}/km`
                : vehicle.costPerHour != null
                  ? `${formatCLP(vehicle.costPerHour)}/h`
                  : "—"}
            </TableCell>}
            {showMeterReading && <TableCell className="text-right font-mono">
              {vehicle.lastOdometerReading != null
                ? `${formatNumber(vehicle.lastOdometerReading)} km`
                : vehicle.lastHourMeterReading != null
                  ? `${formatNumber(vehicle.lastHourMeterReading)} h`
                  : "—"}
            </TableCell>}
            {showLastMaintenance && <TableCell>{vehicle.lastMaintenanceDate ? formatDate(vehicle.lastMaintenanceDate) : "—"}</TableCell>}
          </FleetTableRow>
        )
      }}
    />
  )
}
