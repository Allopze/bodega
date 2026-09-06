"use client"

import * as React from "react"
import { DataTable } from "@/components/ui/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { TableCell, TableRow } from "@/components/ui/table"
import { Plus } from "@phosphor-icons/react"
import { toggleFuelSupplierActive } from "../actions"
import { CONTRACT, COLUMNS } from "./catalog-contract"
import { FuelSupplierForm, type FuelSupplierRow, type GeneralSupplierOption } from "./supplier-form"

export function FuelSupplierList({ suppliers, generalSuppliers }: { suppliers: FuelSupplierRow[]; generalSuppliers: GeneralSupplierOption[] }) {
  const {
    sheetOpen, editRow, openCreate, openEdit, closeSheet, toggleAction, togglePending,
  } = useCatalogSheet<FuelSupplierRow>(toggleFuelSupplierActive)
  const [confirmId, setConfirmId] = React.useState<string | null>(null)

  return (
    <>
      <DataTable
        caption="Proveedores de combustible"
        columns={COLUMNS}
        rows={suppliers}
        searchKeys={CONTRACT.searchKeys as (keyof FuelSupplierRow)[]}
        pageSize={25}
        emptyTitle="Sin proveedores de combustible"
        emptyDescription="Registra el primer proveedor para comenzar."
        emptyAction={<Button size="sm" onClick={openCreate}><Plus size={14} />Nuevo proveedor</Button>}
        actions={<Button size="sm" onClick={openCreate}><Plus size={14} />Nuevo proveedor</Button>}
        renderMobileCard={(supplier) => {
          return (
            <article key={supplier.id} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 title={supplier.name} className="truncate text-sm font-medium text-[var(--color-text)]">{supplier.name}</h2>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{supplier.rut ?? "—"}</p>
                </div>
                <MetaBadge meta={{ label: `${supplier.isActive ? "Activo" : "Inactivo"}`, variant: supplier.isActive ? "success" : "default" }} dot />
              </div>
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">{supplier.contactName ?? "Sin contacto"}</p>
              <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                <CatalogRowActions
                  id={supplier.id}
                  isActive={supplier.isActive}
                  label={`proveedor de combustible ${supplier.name}`}
                  onEdit={() => openEdit(supplier)}
                  toggleAction={toggleAction}
                  onDeactivateRequest={() => setConfirmId(supplier.id)}
                  togglePending={togglePending}
                />
              </div>
            </article>
          )
        }}
        renderRow={(supplier) => {
          return (
            <TableRow key={supplier.id}>
              <TableCell className="font-medium">{supplier.name}</TableCell>
              <TableCell className="font-mono text-xs">{supplier.rut ?? "—"}</TableCell>
              <TableCell>{supplier.contactName ?? "—"}</TableCell>
              <TableCell>{supplier.contactPhone ?? "—"}</TableCell>
              <TableCell>{supplier.contactEmail ?? "—"}</TableCell>
              <TableCell><MetaBadge meta={{ label: `${supplier.isActive ? "Activo" : "Inactivo"}`, variant: supplier.isActive ? "success" : "default" }} dot /></TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <CatalogRowActions
                    id={supplier.id}
                    isActive={supplier.isActive}
                    label={`proveedor de combustible ${supplier.name}`}
                    onEdit={() => openEdit(supplier)}
                    toggleAction={toggleAction}
                    onDeactivateRequest={() => setConfirmId(supplier.id)}
                    togglePending={togglePending}
                  />
                </div>
              </TableCell>
            </TableRow>
          )
        }}
      />

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => { if (!open) setConfirmId(null) }}
        title="¿Desactivar proveedor?"
        description="El proveedor quedará inactivo para nuevas cargas, pero conservará sus relaciones financieras e historia."
        confirmLabel="Desactivar"
        variant="warning"
        loading={togglePending}
        onConfirm={() => {
          if (!confirmId) return
          const formData = new FormData()
          formData.set("id", confirmId)
          formData.set("activate", "false")
          toggleAction(formData)
          setConfirmId(null)
        }}
      />

      <FuelSupplierForm
        key={editRow?.id ?? "nuevo"}
        open={sheetOpen}
        onClose={closeSheet}
        editSupplier={editRow}
        generalSuppliers={generalSuppliers}
      />
    </>
  )
}
