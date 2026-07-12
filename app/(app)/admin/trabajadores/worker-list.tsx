"use client"

import * as React from "react"
import { DataTable } from "@/components/admin/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { WorkerForm } from "./worker-form"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { toggleWorkerActive } from "./actions"
import { COLUMNS, CONTRACT } from "./catalog-contract"

interface WorksiteOption { id: string; name: string }

interface WorkerRow {
  id:          string
  rut:         string | null
  firstName:   string
  lastName:    string
  position:    string | null
  worksiteId:  string
  worksiteName: string
  isActive:    boolean
  createdAt:   string
}

export function WorkerList({
  workers, worksites,
}: {
  workers:   WorkerRow[]
  worksites: WorksiteOption[]
}) {
  const {
    sheetOpen, editRow: editWorker,
    openCreate, openEdit, closeSheet, toggleAction,
  } = useCatalogSheet<WorkerRow>(toggleWorkerActive)

  return (
    <>
      <DataTable
        columns={COLUMNS}
        rows={workers as unknown as Record<string, unknown>[]}
        searchKeys={CONTRACT.searchKeys}
        pageSize={25}

        emptyTitle="Sin trabajadores"
        emptyDescription="Registra el primer trabajador para gestionar entregas de EPP."
        renderMobileCard={(row) => {
          const w = row as unknown as WorkerRow
          return (
            <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium text-[var(--color-text)] truncate">
                    {w.firstName} {w.lastName}
                  </h2>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{w.rut ?? "—"}</p>
                </div>
                <Badge variant={w.isActive ? "success" : "default"} dot>
                  {w.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-[var(--color-text-subtle)]">Cargo</dt>
                  <dd className="text-[var(--color-text-muted)] truncate">{w.position ?? "—"}</dd>
                </div>
                <div className="text-right">
                  <dt className="text-[var(--color-text-subtle)]">Faena</dt>
                  <dd className="text-[var(--color-text-muted)] truncate">{w.worksiteName}</dd>
                </div>
              </dl>

              <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                <CatalogRowActions
                  id={w.id}
                  isActive={w.isActive}
                  label={`trabajador ${w.firstName} ${w.lastName}`}
                  onEdit={() => openEdit(w)}
                  toggleAction={toggleAction}
                />
              </div>
            </article>
          )
        }}
        renderRow={(row) => {
          const w = row as unknown as WorkerRow
          return (
            <TableRow key={w.id}>
              <TableCell>
                <p className="text-sm font-medium text-[var(--color-text)]">
                  {w.firstName} {w.lastName}
                </p>
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs text-[var(--color-text-muted)]">
                  {w.rut ?? "—"}
                </span>
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {w.position ?? "—"}
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {w.worksiteName}
              </TableCell>
              <TableCell>
                <Badge variant={w.isActive ? "success" : "default"} dot className="w-20 justify-center">
                  {w.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 justify-end">
                  <CatalogRowActions
                    id={w.id}
                    isActive={w.isActive}
                    label={`trabajador ${w.firstName} ${w.lastName}`}
                    onEdit={() => openEdit(w)}
                    toggleAction={toggleAction}
                  />
                </div>
              </TableCell>
            </TableRow>
          )
        }}
      />
      <WorkerForm
        open={sheetOpen}
        onClose={closeSheet}
        editWorker={editWorker}
        worksites={worksites}
      />
    </>
  )
}
