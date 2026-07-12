"use client"

import * as React from "react"
import { DataTable } from "@/components/admin/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { setCostCenterActiveAction } from "./actions"
import { COLUMNS as CC_COLUMNS, CONTRACT } from "./catalog-contract"
import { CostCenterForm, type CostCenterRow, type WorksiteOption } from "./cost-center-form"

interface CostCenterListProps {
  costCenters: CostCenterRow[]
  worksites: WorksiteOption[]
  canCreate: boolean
}

export function CostCenterList({ costCenters, worksites, canCreate }: CostCenterListProps) {
  const {
    sheetOpen, editRow: editCc, openEdit, closeSheet, toggleAction,
  } = useCatalogSheet<CostCenterRow>(setCostCenterActiveAction)

  const rows = costCenters as (CostCenterRow & Record<string, unknown>)[]

  return (
    <>
      <DataTable
        columns={CC_COLUMNS}
        rows={rows}
        searchKeys={CONTRACT.searchKeys}
        pageSize={20}
        emptyTitle="Sin centros de costo"
        emptyDescription={canCreate ? "Crea el primer centro de costo para la organización." : "No hay centros de costo registrados."}
        renderMobileCard={(row) => {
          const cc = row as unknown as CostCenterRow
          return (
            <article key={cc.id} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-[var(--color-text-subtle)]">{cc.code}</p>
                  <h2 className="mt-0.5 truncate text-sm font-medium text-[var(--color-text)]">{cc.name}</h2>
                </div>
                <Badge variant={cc.isActive ? "success" : "default"} dot>
                  {cc.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </div>
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">{cc.worksiteName || "Sin faena asociada"}</p>
              {canCreate && (
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                  <CatalogRowActions
                    id={cc.id}
                    isActive={cc.isActive}
                    label={`centro de costo ${cc.name}`}
                    onEdit={() => openEdit(cc)}
                    toggleAction={toggleAction}
                  />
                </div>
              )}
            </article>
          )
        }}
        renderRow={(row) => {
          const cc = row as CostCenterRow
          return (
            <React.Fragment key={cc.id}>
              <TableRow>
                <TableCell className="font-mono text-xs">{cc.code}</TableCell>
                <TableCell>{cc.name}</TableCell>
                <TableCell className="text-[var(--color-text-muted)]">{cc.worksiteName || "—"}</TableCell>
                <TableCell>
                  {cc.isActive
                    ? <Badge variant="success">Activo</Badge>
                    : <Badge variant="default">Inactivo</Badge>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {canCreate && (
                      <CatalogRowActions
                        id={cc.id}
                        isActive={cc.isActive}
                        label={`centro de costo ${cc.name}`}
                        onEdit={() => openEdit(cc)}
                        toggleAction={toggleAction}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            </React.Fragment>
          )
        }}
      />
      {canCreate && (
        <CostCenterForm
          key={editCc?.id ?? "nuevo"}
          open={sheetOpen}
          onClose={closeSheet}
          editCostCenter={editCc}
          worksites={worksites}
        />
      )}
    </>
  )
}

export type { CostCenterRow, WorksiteOption }
