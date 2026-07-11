"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { WorksiteForm } from "./worksite-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { toggleWorksiteActive } from "./actions"
import { COLUMNS as WS_COLUMNS, CONTRACT } from "./catalog-contract"

interface WorksiteRow {
  id: string
  name: string
  code: string
  address: string | null
  region: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export function FaenasList({
  worksites,
  canCreateWorksites,
}: {
  worksites: WorksiteRow[]
  canCreateWorksites: boolean
}) {
  const {
    sheetOpen, editRow: editWs,
    openCreate: openNewWs, openEdit: openEditWs, closeSheet,
    toggleAction: wsToggleAction,
  } = useCatalogSheet<WorksiteRow>(toggleWorksiteActive)

  const rows = worksites as (WorksiteRow & Record<string, unknown>)[]

  return (
    <>
      <DataTable
        columns={WS_COLUMNS}
        rows={rows}
        searchKeys={CONTRACT.searchKeys}
        pageSize={20}

        emptyTitle="Sin faenas"
        emptyDescription={canCreateWorksites ? "Crea la primera faena para comenzar." : "No hay faenas dentro de tu alcance."}
        emptyAction={canCreateWorksites ? <Button size="sm" onClick={openNewWs}><Plus size={14} />Nueva faena</Button> : undefined}
        actions={
          canCreateWorksites
            ? (
                <Button size="sm" onClick={openNewWs}>
                  <Plus size={14} />Nueva faena
                </Button>
              )
            : undefined
        }
        renderMobileCard={(row) => {
          const ws = row as unknown as WorksiteRow
          return (
            <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium text-[var(--color-text)] truncate">{ws.name}</h2>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{ws.code}</p>
                </div>
                <Badge variant={ws.isActive ? "success" : "default"} dot>
                  {ws.isActive ? "Activa" : "Inactiva"}
                </Badge>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-[var(--color-text-subtle)]">Región</dt>
                  <dd className="text-[var(--color-text-muted)]">{ws.region ?? "—"}</dd>
                </div>
              </dl>

              <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                <CatalogRowActions
                  id={ws.id}
                  isActive={ws.isActive}
                  label={`faena ${ws.name}`}
                  onEdit={() => openEditWs(ws)}
                  toggleAction={wsToggleAction}
                />
              </div>
            </article>
          )
        }}
        renderRow={(row) => {
          const ws = row as unknown as WorksiteRow
          return (
            <React.Fragment key={ws.id}>
              <TableRow>
                <TableCell>
                  <span className="text-sm font-medium text-text truncate">{ws.name}</span>
                </TableCell>
                <TableCell><span className="font-mono text-xs">{ws.code}</span></TableCell>
                <TableCell className="text-sm text-text-muted">{ws.region ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={ws.isActive ? "success" : "default"} dot className="w-20 justify-center">
                    {ws.isActive ? "Activa" : "Inactiva"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 justify-end">
                    <CatalogRowActions
                      id={ws.id}
                      isActive={ws.isActive}
                      label={`faena ${ws.name}`}
                      onEdit={() => openEditWs(ws)}
                      toggleAction={wsToggleAction}
                    />
                  </div>
                </TableCell>
              </TableRow>
            </React.Fragment>
          )
        }}
      />

      <WorksiteForm
        key={editWs?.id ?? "nuevo"}
        open={sheetOpen}
        onClose={closeSheet}
        editWorksite={editWs}
      />
    </>
  )
}
