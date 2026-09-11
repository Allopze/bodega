"use client"

import * as React from "react"
import { DataTable } from "@/components/ui/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { WorkerForm } from "./worker-form"
import { MetaBadge } from "@/components/states/state-badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { toggleWorkerActive } from "./actions"
import { COLUMNS, CONTRACT } from "./catalog-contract"
import { Badge } from "@/components/ui/badge"
import type { SizeFamilyOption } from "@/app/(app)/admin/productos/product-form.types"
import type { WorkerPositionOption } from "@/app/(app)/admin/cargos/types"

interface WorksiteOption { id: string; name: string }

type WorkerRow = {
  id:          string
  rut:         string | null
  firstName:   string
  lastName:    string
  position:    string | null
  positionId:  string | null
  positionNeedsReview: boolean
  worksiteId:  string
  worksiteName: string
  isActive:    boolean
  createdAt:   string
  sizeTop:     string | null
  sizeBottom:  string | null
  sizeShoe:    string | null
  sizeGloves:  string | null
  sizeHelmet:  string | null
}

export function WorkerList({
  workers, worksites, sizeFamilies, positions,
}: {
  workers:   WorkerRow[]
  worksites: WorksiteOption[]
  sizeFamilies: SizeFamilyOption[]
  positions: WorkerPositionOption[]
}) {
  const {
    sheetOpen, editRow: editWorker,
    openEdit, closeSheet, toggleAction,
  } = useCatalogSheet<WorkerRow>(toggleWorkerActive)

  const [tab, setTab] = React.useState<"active" | "inactive">("active")
  const activeWorkers   = React.useMemo(() => workers.filter((w) => w.isActive),  [workers])
  const inactiveWorkers = React.useMemo(() => workers.filter((w) => !w.isActive), [workers])

  const renderMobileCard = (w: WorkerRow) => {
    return (
      <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-[var(--color-text)] truncate">
              {w.firstName} {w.lastName}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{w.rut ?? "—"}</p>
          </div>
          <MetaBadge meta={{ label: `${w.isActive ? "Activo" : "Inactivo"}`, variant: w.isActive ? "success" : "default" }} dot />
        </div>
  
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-[var(--color-text-subtle)]">Cargo</dt>
            <dd className="text-[var(--color-text-muted)] truncate">{w.position ?? "—"}</dd>
            {w.positionNeedsReview && <Badge variant="warning" size="sm" className="mt-1">Por revisar</Badge>}
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
  }

  const renderRow = (w: WorkerRow) => {
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
          <span className="inline-flex items-center gap-1.5">
            {w.position ?? "—"}
            {w.positionNeedsReview && <Badge variant="warning" size="sm">Por revisar</Badge>}
          </span>
        </TableCell>
        <TableCell className="text-sm text-[var(--color-text-muted)]">
          {w.worksiteName}
        </TableCell>
        <TableCell>
          <MetaBadge meta={{ label: `${w.isActive ? "Activo" : "Inactivo"}`, variant: w.isActive ? "success" : "default" }} dot className="w-20 justify-center" />
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
  }

  return (
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "inactive")}>
        <TabsList className="mb-3">
          <TabsTrigger value="active">
            Activos
            <span className="ml-1.5 text-xs text-text-subtle">{activeWorkers.length}</span>
          </TabsTrigger>
          <TabsTrigger value="inactive">
            Inactivos
            <span className="ml-1.5 text-xs text-text-subtle">{inactiveWorkers.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <DataTable
            caption="Trabajadores activos"
            columns={COLUMNS}
            rows={activeWorkers}
            searchKeys={CONTRACT.searchKeys as (keyof WorkerRow)[]}
            pageSize={25}
            emptyTitle="Sin trabajadores activos"
            emptyDescription="Registra el primer trabajador para gestionar entregas de EPP."
            renderMobileCard={renderMobileCard}
            renderRow={renderRow}
          />
        </TabsContent>

        <TabsContent value="inactive">
          <DataTable
            caption="Trabajadores inactivos"
            columns={COLUMNS}
            rows={inactiveWorkers}
            searchKeys={CONTRACT.searchKeys as (keyof WorkerRow)[]}
            pageSize={25}
            emptyTitle="Sin trabajadores inactivos"
            emptyDescription="Nadie dado de baja. Su historial de entregas y capacitaciones se conserva al desactivarlos."
            renderMobileCard={renderMobileCard}
            renderRow={renderRow}
          />
        </TabsContent>
      </Tabs>

      {/* `key` por trabajador: el formulario guarda cargo, faena y tallas en
          estado local y nunca se desmonta, así que sin esto editar a alguien
          después de otro arrastraba los valores del anterior. */}
      <WorkerForm
        key={editWorker?.id ?? "nuevo"}
        open={sheetOpen}
        onClose={closeSheet}
        editWorker={editWorker}
        worksites={worksites}
        sizeFamilies={sizeFamilies}
        positions={positions}
      />
    </>
  )
}
