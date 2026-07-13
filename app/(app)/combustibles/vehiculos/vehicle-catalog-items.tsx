"use client"

import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { Badge } from "@/components/ui/badge"
import { TableCell, TableRow } from "@/components/ui/table"
import { FUEL_VEHICLE_STATUS_LABELS } from "@/lib/combustibles/validation"
import type { VehicleForEdit } from "./vehicle-form"

export interface VehicleRow extends VehicleForEdit {
  equipmentTypeName: string
  usualFuelSupplierName: string | null
  worksiteName: string | null
  responsibleName: string | null
  isActive: boolean
}
interface ItemProps {
  vehicle: VehicleRow
  selected: boolean
  onSelect: (id: string) => void
  onEdit: (vehicle: VehicleRow) => void
  onDeactivate: (id: string) => void
  toggleAction: (formData: FormData) => void
  togglePending: boolean
}

function operationalStatus(vehicle: VehicleRow) {
  return FUEL_VEHICLE_STATUS_LABELS[vehicle.operationalStatus as keyof typeof FUEL_VEHICLE_STATUS_LABELS] ?? vehicle.operationalStatus
}

export function VehicleDesktopRow({ vehicle, selected, onSelect, onEdit, onDeactivate, toggleAction, togglePending }: ItemProps) {
  return <TableRow key={vehicle.id}>
    <TableCell><input type="checkbox" checked={selected} onChange={() => onSelect(vehicle.id)} onClick={(event) => event.stopPropagation()} className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]" aria-label={`Seleccionar ${vehicle.plate}`} /></TableCell>
    <TableCell className="font-mono text-sm font-semibold">{vehicle.plate}</TableCell>
    <TableCell className="text-sm text-[var(--color-text-muted)]">{vehicle.equipmentTypeName}</TableCell>
    <TableCell className="text-sm text-[var(--color-text-muted)]">{vehicle.worksiteName ?? "—"}</TableCell>
    <TableCell className="text-sm text-[var(--color-text-muted)]">{vehicle.responsibleName ?? "—"}</TableCell>
    <TableCell className="text-sm text-[var(--color-text-muted)]">{operationalStatus(vehicle)}</TableCell>
    <TableCell><Badge variant={vehicle.isActive ? "success" : "default"} dot className="w-20 justify-center">{vehicle.isActive ? "Activo" : "Inactivo"}</Badge></TableCell>
    <TableCell><div className="flex items-center justify-end gap-2"><CatalogRowActions id={vehicle.id} isActive={vehicle.isActive} label={`vehículo ${vehicle.plate}`} onEdit={() => onEdit(vehicle)} toggleAction={toggleAction} onDeactivateRequest={() => onDeactivate(vehicle.id)} togglePending={togglePending} /></div></TableCell>
  </TableRow>
}

export function VehicleMobileCard({ vehicle, selected, onSelect, onEdit, onDeactivate, toggleAction, togglePending }: ItemProps) {
  return <article key={vehicle.id} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
    <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={selected} onChange={() => onSelect(vehicle.id)} className="h-4 w-4 shrink-0 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]" aria-label={`Seleccionar ${vehicle.plate}`} /><div><p className="font-mono text-sm font-semibold text-[var(--color-text)]">{vehicle.plate}</p><p className="text-xs text-[var(--color-text-muted)]">{vehicle.equipmentTypeName}</p></div></div><Badge variant={vehicle.isActive ? "success" : "default"} dot className="shrink-0">{vehicle.isActive ? "Activo" : "Inactivo"}</Badge></div>
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-[var(--color-text-subtle)]">Faena</dt><dd className="text-[var(--color-text-muted)]">{vehicle.worksiteName ?? "—"}</dd></div><div><dt className="text-[var(--color-text-subtle)]">Responsable</dt><dd className="text-[var(--color-text-muted)]">{vehicle.responsibleName ?? "—"}</dd></div><div className="col-span-2"><dt className="text-[var(--color-text-subtle)]">Estado operacional</dt><dd className="text-[var(--color-text-muted)]">{operationalStatus(vehicle)}</dd></div></dl>
    <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2"><CatalogRowActions id={vehicle.id} isActive={vehicle.isActive} label={`vehículo ${vehicle.plate}`} onEdit={() => onEdit(vehicle)} toggleAction={toggleAction} onDeactivateRequest={() => onDeactivate(vehicle.id)} togglePending={togglePending} /></div>
  </article>
}
