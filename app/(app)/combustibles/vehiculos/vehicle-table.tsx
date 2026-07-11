"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { TableRow, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toggleFuelVehicleActiveAction } from "../actions"
import { FUEL_VEHICLE_STATUS_LABELS, formatFuelVehicleType } from "@/lib/combustibles/validation"
import { VehicleForm, type VehicleForEdit } from "./vehicle-form"
import { COLUMNS, CONTRACT } from "./catalog-contract"

export interface VehicleRow extends VehicleForEdit {
  worksiteName: string | null
  responsibleName: string | null
  isActive: boolean
}


async function toggleVehicleActive(_prev: unknown, formData: FormData) {
  const id = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  return toggleFuelVehicleActiveAction(id, activate)
}

export function VehicleCatalogTable({ vehicles, worksites, users }: {
  vehicles: VehicleRow[]
  worksites: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
}) {
  const {
    sheetOpen: formOpen,
    editRow: editVehicle,
    openCreate,
    openEdit,
    closeSheet,
    toggleAction,
    togglePending,
  } = useCatalogSheet<VehicleRow>(toggleVehicleActive)
  const [confirmId, setConfirmId] = React.useState<string | null>(null)

  return (
    <>
      <DataTable
        columns={COLUMNS}
        rows={vehicles as unknown as Record<string, unknown>[]}
        searchKeys={CONTRACT.searchKeys}
        tableClassName="table-fixed min-w-0"
        pageSize={25}
        emptyTitle="Sin vehículos"
        emptyDescription="Registra el primer vehículo del catálogo."
        emptyAction={<Button size="sm" onClick={openCreate}><Plus size={14} />Nuevo vehículo</Button>}
        actions={<Button size="sm" onClick={openCreate}><Plus size={14} />Nuevo vehículo</Button>}
        renderRow={(row) => {
          const v = row as unknown as VehicleRow
          return (
            <TableRow key={v.id}>
              <TableCell className="font-mono font-semibold text-sm">{v.plate}</TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {formatFuelVehicleType(v.type)}
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">{v.worksiteName ?? "—"}</TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">{v.responsibleName ?? "—"}</TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {FUEL_VEHICLE_STATUS_LABELS[v.operationalStatus as keyof typeof FUEL_VEHICLE_STATUS_LABELS] ?? v.operationalStatus}
              </TableCell>
              <TableCell>
                <Badge variant={v.isActive ? "success" : "default"} dot className="w-20 justify-center">
                  {v.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 justify-end">
                  <CatalogRowActions
                    id={v.id}
                    isActive={v.isActive}
                    label={`vehículo ${v.plate}`}
                    onEdit={() => openEdit(v)}
                    toggleAction={toggleAction}
                    onDeactivateRequest={() => setConfirmId(v.id)}
                    togglePending={togglePending}
                  />
                </div>
              </TableCell>
            </TableRow>
          )
        }}
        renderMobileCard={(row) => {
          const v = row as unknown as VehicleRow
          return (
            <article key={v.id} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-[var(--color-text)]">{v.plate}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {formatFuelVehicleType(v.type)}
                  </p>
                </div>
                <Badge variant={v.isActive ? "success" : "default"} dot>{v.isActive ? "Activo" : "Inactivo"}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div><dt className="text-[var(--color-text-subtle)]">Faena</dt><dd className="text-[var(--color-text-muted)]">{v.worksiteName ?? "—"}</dd></div>
                <div><dt className="text-[var(--color-text-subtle)]">Responsable</dt><dd className="text-[var(--color-text-muted)]">{v.responsibleName ?? "—"}</dd></div>
                <div className="col-span-2">
                  <dt className="text-[var(--color-text-subtle)]">Estado operacional</dt>
                  <dd className="text-[var(--color-text-muted)]">{FUEL_VEHICLE_STATUS_LABELS[v.operationalStatus as keyof typeof FUEL_VEHICLE_STATUS_LABELS] ?? v.operationalStatus}</dd>
                </div>
              </dl>
              <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                <CatalogRowActions
                  id={v.id}
                  isActive={v.isActive}
                  label={`vehículo ${v.plate}`}
                  onEdit={() => openEdit(v)}
                  toggleAction={toggleAction}
                  onDeactivateRequest={() => setConfirmId(v.id)}
                  togglePending={togglePending}
                />
              </div>
            </article>
          )
        }}
      />

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => { if (!open) setConfirmId(null) }}
        title="¿Desactivar vehículo?"
        description="El vehículo quedará inactivo y no aparecerá en las listas de selección. Esta acción no elimina sus cargas ni registros históricos, y puede revertirse reactivándolo."
        confirmLabel="Desactivar"
        variant="warning"
        loading={togglePending}
        onConfirm={() => {
          if (!confirmId) return
          const fd = new FormData()
          fd.set("id", confirmId)
          fd.set("activate", "false")
          toggleAction(fd)
          setConfirmId(null)
        }}
      />

      <VehicleForm
        key={editVehicle?.id ?? "nuevo"}
        open={formOpen}
        onClose={closeSheet}
        worksites={worksites}
        users={users}
        editVehicle={editVehicle}
      />
    </>
  )
}
