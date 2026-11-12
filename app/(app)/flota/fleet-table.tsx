"use client"

import * as React from "react"
import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { ExpiryStatus } from "@/components/ui/expiry-status"
import { TableCell } from "@/components/ui/table"
import { MetaBadge } from "@/components/states/state-badge"
import { formatFuelVehicleStatus } from "@/lib/combustibles/validation"
import { expiryState } from "@/lib/expiry"
import { formatCLP } from "@/lib/utils"
import type { getFleetOverview } from "@/lib/services/fleet"
import { fleetExpirySubject } from "./fleet-expiry-subject"
import { FleetMeterReading } from "./fleet-meter-reading"
import { FleetTableRow } from "./fleet-table-row"
import { Button } from "@/components/ui/button"

type VehicleRow = Awaited<ReturnType<typeof getFleetOverview>>[number]

/** Gasto del proveedor por km o por hora, con un decimal: no es un monto CLP entero. */
function formatUnitCost(value: number | null, label: string | null): string {
  if (value == null || label == null) return "—"
  const unit = label === "CLP/km" ? "km" : "h"
  return `$${value.toLocaleString("es-CL", { maximumFractionDigits: 1 })}/${unit}`
}

function meterSourceLabel(source: string | null): string | undefined {
  return source === "copec_tct"
    ? "Lectura Copec"
    : source === "gps_wialon"
      ? "Lectura GPS Wialon"
      : source === "gps_onway"
        ? "Lectura GPS OnWay"
        : undefined
}

/**
 * «Próximo vencimiento»: el documento, su estado y cuánto falta, no solo una fecha. Sin ninguna fecha
 * registrada dice lo que falta con texto apagado y sin pastilla: con pastilla, una flota recién cargada
 * pintaría una columna entera de «Sin fecha».
 */
function NextExpiry({ vehicle, today, warningDays }: { vehicle: VehicleRow; today: string; warningDays: number }) {
  if (!vehicle.nextExpiryDate) {
    return <span className="text-xs text-[var(--color-text-subtle)]">Sin fecha registrada</span>
  }
  return (
    <ExpiryStatus
      status={expiryState(vehicle.nextExpiryDate, today, warningDays)}
      warningDays={warningDays}
      subject={fleetExpirySubject(vehicle.nextExpiryDocumentType)}
    />
  )
}

export function FleetTable({ vehicles, hasAnyVehicle, canViewCosts, canViewFuel, today, warningDays }: {
  vehicles: VehicleRow[]
  hasAnyVehicle: boolean
  canViewCosts: boolean
  canViewFuel: boolean
  /** Hoy en Chile (`todayInChile()` del servidor) y la ventana de aviso de los ajustes de flota. */
  today: string
  warningDays: number
}) {
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
    // Ratio de dos unidades distintas (CLP/km y CLP/h): ordenarlo por el número
    // crudo compararía magnitudes que no lo son.
    ...(canViewCosts && canViewFuel ? [{ key: "fuelCostPerUnit", label: "Costo por km/h", sortable: false, numeric: true }] : []),
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
            <div className="col-span-2"><dt className="text-[var(--color-text-subtle)]">Próximo vencimiento</dt><dd className="mt-0.5"><NextExpiry vehicle={vehicle} today={today} warningDays={warningDays} /></dd></div>
            {canViewCosts && canViewFuel && (
              <div><dt className="text-[var(--color-text-subtle)]">Costo por km/h</dt><dd className="font-mono">{formatUnitCost(vehicle.fuelCostPerUnit, vehicle.fuelCostPerUnitLabel)}</dd></div>
            )}
            {vehicle.openWorkOrders != null && <div><dt className="text-[var(--color-text-subtle)]">OT abiertas</dt><dd>{vehicle.openWorkOrders}{vehicle.inWorkshopNow ? " · en taller" : ""}</dd></div>}
            {/* P-9: la misma celda que la columna «Km/Hr» de la tabla (valor y aviso de lectura objetada), con la misma condición de columna. */}
            {showMeterReading && <div><dt className="text-[var(--color-text-subtle)]">Km/Hr</dt><dd className="font-mono"><FleetMeterReading vehicle={vehicle} /></dd></div>}
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
            <TableCell><NextExpiry vehicle={vehicle} today={today} warningDays={warningDays} /></TableCell>
            {canViewCosts && canViewFuel && <TableCell className="text-right font-mono">{formatCLP(vehicle.totalFuelAmount ?? 0)}</TableCell>}
            {canViewCosts && canViewFuel && (
              <TableCell
                className="text-right font-mono"
                title={[
                  meterSourceLabel(vehicle.meterSource),
                  vehicle.meterSeriesIncomplete ? "El recorrido es una cota inferior: parte de la serie se descartó por lecturas inválidas." : null,
                  vehicle.meterSeriesCovered === false ? "Costo por km/h no calculado: la serie no cubre los 12 meses." : null,
                ].filter(Boolean).join(" ") || undefined}
              >
                {formatUnitCost(vehicle.fuelCostPerUnit, vehicle.fuelCostPerUnitLabel)}
              </TableCell>
            )}
            {showWorkOrders && <TableCell className="text-right font-mono">
              {vehicle.openWorkOrders ?? 0}
              {vehicle.inWorkshopNow && <span className="ml-1 font-sans text-xs text-[var(--color-warning-ink)]">en taller</span>}
            </TableCell>}
            {showMeterReading && <TableCell className="text-right font-mono"><FleetMeterReading vehicle={vehicle} /></TableCell>}
          </FleetTableRow>
        )
      }}
    />
  )
}
