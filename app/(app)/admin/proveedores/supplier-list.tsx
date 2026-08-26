"use client"

import * as React from "react"
import { DataTable } from "@/components/ui/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { SupplierForm } from "./supplier-form"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { toggleSupplierActive } from "./actions"
import { COLUMNS, CONTRACT } from "./catalog-contract"

type SupplierRow = {
  id: string; name: string; rut: string | null; contactName: string | null
  businessActivity: string | null
  email: string | null; phone: string | null; address: string | null
  commune: string | null; city: string | null
  paymentTerms: string | null; notes: string | null
  isActive: boolean; createdAt: string
}

export function SupplierList({ suppliers }: { suppliers: SupplierRow[] }) {
  const {
    sheetOpen, editRow: editSupplier, openEdit, closeSheet, toggleAction,
  } = useCatalogSheet<SupplierRow>(toggleSupplierActive)

  return (
    <>
      <DataTable
        caption="Proveedores"
        columns={COLUMNS}
        rows={suppliers}
        searchKeys={CONTRACT.searchKeys as (keyof SupplierRow)[]}
        pageSize={25}

        emptyTitle="Sin proveedores"
        emptyDescription="Registra el primer proveedor para comenzar."
        renderMobileCard={(s) => {
          return (
            <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 title={s.name} className="text-sm font-medium text-[var(--color-text)] truncate">{s.name}</h2>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{s.rut ?? "—"}</p>
                </div>
                <Badge variant={s.isActive ? "success" : "default"} dot>
                  {s.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-[var(--color-text-subtle)]">Giro</dt>
                  <dd className="text-[var(--color-text-muted)] truncate">{s.businessActivity ?? "—"}</dd>
                </div>
                <div className="text-right">
                  <dt className="text-[var(--color-text-subtle)]">Pago</dt>
                  <dd className="text-[var(--color-text-muted)]">{s.paymentTerms ?? "—"}</dd>
                </div>
                {s.phone && (
                  <div className="col-span-2">
                    <dt className="text-[var(--color-text-subtle)]">Teléfono</dt>
                    <dd className="font-mono text-[var(--color-text-muted)]">{s.phone}</dd>
                  </div>
                )}
              </dl>

              <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                <CatalogRowActions
                  id={s.id}
                  isActive={s.isActive}
                  label={`proveedor ${s.name}`}
                  onEdit={() => openEdit(s)}
                  toggleAction={toggleAction}
                />
              </div>
            </article>
          )
        }}
        renderRow={(s) => {
          return (
            <TableRow key={s.id}>
              <TableCell>
                <p className="text-sm font-medium text-[var(--color-text)]">{s.name}</p>
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs text-[var(--color-text-muted)]">{s.rut ?? "—"}</span>
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {s.businessActivity ?? "—"}
                {(s.commune || s.city) && <span className="block text-xs">{[s.commune, s.city].filter(Boolean).join(", ")}</span>}
              </TableCell>
              <TableCell className="text-xs text-[var(--color-text-muted)]">{s.paymentTerms ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={s.isActive ? "success" : "default"} dot className="w-20 justify-center">
                  {s.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 justify-end">
                  <CatalogRowActions
                    id={s.id}
                    isActive={s.isActive}
                    label={`proveedor ${s.name}`}
                    onEdit={() => openEdit(s)}
                    toggleAction={toggleAction}
                  />
                </div>
              </TableCell>
            </TableRow>
          )
        }}
      />
      <SupplierForm open={sheetOpen} onClose={closeSheet} editSupplier={editSupplier} />
    </>
  )
}
