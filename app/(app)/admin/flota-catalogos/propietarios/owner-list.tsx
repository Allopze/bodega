"use client"

import * as React from "react"
import { DataTable } from "@/components/ui/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { MetaBadge } from "@/components/states/state-badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { FLEET_OWNER_KIND_LABELS } from "@/lib/fleet/fleet-owner-kinds"
import { setFleetOwnerActiveAction } from "./actions"
import { COLUMNS, CONTRACT } from "./catalog-contract"
import { OwnerForm, type OwnerRow } from "./owner-form"

function KindBadge({ kind }: { kind: OwnerRow["kind"] }) {
  return <MetaBadge meta={{ label: FLEET_OWNER_KIND_LABELS[kind] ?? kind, variant: "default" }} />
}

function vehiclesText(count: number) {
  return count > 0 ? `${count} equipo${count === 1 ? "" : "s"}` : "Sin equipos"
}

export function OwnerList({ rows: owners }: { rows: OwnerRow[] }) {
  const { sheetOpen, editRow, openEdit, closeSheet, toggleAction } = useCatalogSheet<OwnerRow>(setFleetOwnerActiveAction)

  const [confirmRow, setConfirmRow] = React.useState<OwnerRow | null>(null)
  const toggleFormRef = React.useRef<HTMLFormElement>(null)

  const rows = owners as (OwnerRow & Record<string, unknown>)[]

  function submitToggle(id: string, activate: boolean) {
    const form = toggleFormRef.current
    if (!form) return
    ;(form.elements.namedItem("id") as HTMLInputElement).value = id
    ;(form.elements.namedItem("activate") as HTMLInputElement).value = String(activate)
    form.requestSubmit()
  }

  // Desactivar una empresa sólo la saca del selector de altas nuevas: los equipos que ya
  // la tienen la conservan. Por eso se avisa sólo cuando hay alguno; sin equipos el toggle
  // es directo. Reactivar nunca pregunta.
  function requestDeactivate(row: OwnerRow) {
    if (row.vehicleCount > 0) { setConfirmRow(row); return }
    submitToggle(row.id, false)
  }

  return (
    <>
      <form ref={toggleFormRef} action={toggleAction} className="hidden">
        <input type="hidden" name="id" />
        <input type="hidden" name="activate" />
      </form>

      <DataTable
        caption="Propietarios de flota"
        columns={COLUMNS}
        rows={rows}
        searchKeys={CONTRACT.searchKeys}
        pageSize={25}
        emptyTitle="Sin empresas propietarias"
        emptyDescription="Crea la primera con «Nueva empresa», o agrégala al asignar el propietario de un equipo en su ficha."
        renderMobileCard={(row) => {
          const o = row as unknown as OwnerRow
          return (
            <article key={o.id} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 title={o.name} className="truncate text-sm font-medium text-[var(--color-text)]">{o.name}</h2>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{FLEET_OWNER_KIND_LABELS[o.kind] ?? o.kind}</p>
                </div>
                <MetaBadge meta={{ label: o.isActive ? "Activo" : "Inactivo", variant: o.isActive ? "success" : "default" }} dot />
              </div>
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">{vehiclesText(o.vehicleCount)}</p>
              <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                <CatalogRowActions
                  id={o.id}
                  isActive={o.isActive}
                  label={`empresa ${o.name}`}
                  onEdit={() => openEdit(o)}
                  toggleAction={toggleAction}
                  onDeactivateRequest={() => requestDeactivate(o)}
                />
              </div>
            </article>
          )
        }}
        renderRow={(row) => {
          const o = row as OwnerRow
          return (
            <TableRow key={o.id}>
              <TableCell className="font-medium">{o.name}</TableCell>
              <TableCell><KindBadge kind={o.kind} /></TableCell>
              <TableCell>
                {o.vehicleCount > 0
                  ? <span className="font-mono tabular-nums">{o.vehicleCount}</span>
                  : <span className="text-xs text-[var(--color-text-subtle)]">Ninguno</span>}
              </TableCell>
              <TableCell>
                <MetaBadge meta={{ label: o.isActive ? "Activo" : "Inactivo", variant: o.isActive ? "success" : "default" }} />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <CatalogRowActions
                    id={o.id}
                    isActive={o.isActive}
                    label={`empresa ${o.name}`}
                    onEdit={() => openEdit(o)}
                    toggleAction={toggleAction}
                    onDeactivateRequest={() => requestDeactivate(o)}
                  />
                </div>
              </TableCell>
            </TableRow>
          )
        }}
      />

      <ConfirmDialog
        open={confirmRow !== null}
        onOpenChange={(value) => { if (!value) setConfirmRow(null) }}
        title="Desactivar empresa propietaria"
        description={confirmRow
          ? `«${confirmRow.name}» dejará de ofrecerse al asignar propietario. ${confirmRow.vehicleCount === 1 ? "El equipo que ya la tiene la conserva" : `Los ${confirmRow.vehicleCount} equipos que ya la tienen la conservan`} sin cambios.`
          : ""}
        confirmLabel="Desactivar"
        variant="warning"
        onConfirm={() => {
          if (confirmRow) submitToggle(confirmRow.id, false)
          setConfirmRow(null)
        }}
      />

      <OwnerForm
        key={editRow?.id ?? "nueva"}
        open={sheetOpen}
        onClose={closeSheet}
        editRow={editRow}
      />
    </>
  )
}
