"use client"

import * as React from "react"
import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { TableCell } from "@/components/ui/table"
import { MetaBadge } from "@/components/states/state-badge"
import { formatFuelVehicleStatus } from "@/lib/combustibles/validation"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"
import type { getFleetOverview } from "@/lib/services/fleet"
import { FleetTableRow } from "./fleet-table-row"
import { Button } from "@/components/ui/button"

type VehicleRow = Awaited<ReturnType<typeof getFleetOverview>>[number]

const formatNumber = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 1 })

export function FleetTable({ vehicles, hasAnyVehicle, canViewCosts, canViewFuel }: { vehicles: VehicleRow[]; hasAnyVehicle: boolean; canViewCosts: boolean; canViewFuel: boolean }) {
  // `openWorkOrders` es null sin `mant:ot:view_*`: sin la capacidad no hay columna, no un 0 engañoso.
  const showWorkOrders = vehicles.some((v) => v.openWorkOrders != null)
  const showMeterReading = canViewFuel && vehicles.some((v) => v.lastOdometerReading != null || v.lastHourMeterReading != null)

  const columns = React.useMemo(() => [
    { key: "plate", label: "Vehículo", sortable: true },
    { key: "worksiteName", label: "Faena", sortable: true },
    { key: "operationalStatus", label: "Estado", sortable: true },
    { key: "responsibleName", label: "Responsable", sortable: true },
    { key: "nextExpiryDate", label: "Próximo vencimiento", sortable: true },
    ...(canViewCosts && canViewFuel ? [{ key: "totalFuelAmount", label: "Combustible", sortable: true, numeric: true }] : []),
    ...(showWorkOrders ? [{ key: "openWorkOrders", label: "OT abiertas", sortable: true, numeric: true }] : []),
    ...(showMeterReading ? [{ key: "_meterReading", label: "Km/Hr", sortable: false, numeric: true }] : []),
  ], [canViewCosts, canViewFuel, showWorkOrders, showMeterReading])

  return (
    <DataTable
      caption="Vehículos de la flota"
      columns={columns}
      rows={vehicles}
      searchKeys={["plate", "brand", "model", "worksiteName", "responsibleName"]}
      disableInternalSearch
      tableClassName="min-w-[760px]"
      pageSize={25}
      emptyTitle={hasAnyVehicle ? "Sin coincidencias" : "Sin vehículos visibles"}
      emptyDescription={hasAnyVehicle ? "No hay vehículos que coincidan con los filtros." : "No hay vehículos visibles para tu alcance."}
      renderMobileCard={(vehicle) => (
        <article className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-[var(--color-text)]">{vehicle.plate}</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                {[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.type}
              </p>
            </div>
            <MetaBadge meta={{ label: vehicle.isActive ? formatFuelVehicleStatus(vehicle.operationalStatus) : "Inactivo", variant: vehicle.isActive && vehicle.operationalStatus === "operativo" ? "success" : "outline" }} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div><dt className="text-[var(--color-text-subtle)]">Faena</dt><dd>{vehicle.worksiteName}</dd></div>
            <div><dt className="text-[var(--color-text-subtle)]">Responsable</dt><dd>{vehicle.responsibleName ?? "—"}</dd></div>
            <div><dt className="text-[var(--color-text-subtle)]">Vencimiento</dt><dd>{vehicle.nextExpiryDate ? formatDate(vehicle.nextExpiryDate) : "—"}</dd></div>
            {vehicle.openWorkOrders != null && <div><dt className="text-[var(--color-text-subtle)]">OT abiertas</dt><dd>{vehicle.openWorkOrders}{vehicle.inWorkshopNow ? " · en taller" : ""}</dd></div>}
          </dl>
          <Button asChild size="sm" variant="secondary" className="mt-3 w-full">
            <Link href={`/flota/${vehicle.id}`}>Ver ficha del equipo</Link>
          </Button>
        </article>
      )}
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
              <MetaBadge meta={{ label: vehicle.isActive ? formatFuelVehicleStatus(vehicle.operationalStatus) : "Inactivo", variant: vehicle.isActive && vehicle.operationalStatus === "operativo" ? "success" : "outline" }} />
            </TableCell>
            <TableCell>{vehicle.responsibleName ?? "—"}</TableCell>
            <TableCell>{vehicle.nextExpiryDate ? formatDate(vehicle.nextExpiryDate) : "—"}</TableCell>
            {canViewCosts && canViewFuel && <TableCell className="text-right font-mono">{formatCLP(vehicle.totalFuelAmount ?? 0)}</TableCell>}
            {showWorkOrders && <TableCell className="text-right font-mono">
              {vehicle.openWorkOrders ?? 0}
              {vehicle.inWorkshopNow && <span className="ml-1 font-sans text-xs text-[var(--color-warning-ink)]">en taller</span>}
            </TableCell>}
            {showMeterReading && <TableCell className="text-right font-mono">
              {vehicle.lastOdometerReading != null
                ? `${formatNumber(vehicle.lastOdometerReading)} km`
                : vehicle.lastHourMeterReading != null
                  ? `${formatNumber(vehicle.lastHourMeterReading)} h`
                  : "—"}
            </TableCell>}
          </FleetTableRow>
        )
      }}
    />
  )
}
