"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { PencilSimple, Plus, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { setCostCenterActiveAction } from "./actions"
import { CostCenterForm, type CostCenterRow, type WorksiteOption } from "./cost-center-form"

const CC_COLUMNS = [
  { key: "code", label: "Código", sortable: true, width: "w-40" },
  { key: "name", label: "Nombre", sortable: true },
  { key: "worksiteName", label: "Faena", sortable: true },
  { key: "isActive", label: "Estado", sortable: true, width: "w-32" },
  { key: "", label: "", sortable: false, width: "w-28" },
]

interface CostCenterListProps {
  costCenters: CostCenterRow[]
  worksites: WorksiteOption[]
  canCreate: boolean
}

export function CostCenterList({ costCenters, worksites, canCreate }: CostCenterListProps) {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [editCc, setEditCc] = React.useState<CostCenterRow | null>(null)

  const [toggleState, toggleAction] = useActionState(setCostCenterActiveAction, INITIAL_STATE)
  useEffect(() => {
    if (toggleState.message) {
      if (toggleState.ok) toast.success(toggleState.message)
      else toast.error(toggleState.message)
    }
  }, [toggleState])

  function openNew() {
    setEditCc(null)
    setSheetOpen(true)
  }
  function openEdit(cc: CostCenterRow) {
    setEditCc(cc)
    setSheetOpen(true)
  }

  const rows = costCenters as (CostCenterRow & Record<string, unknown>)[]

  return (
    <>
      <DataTable
        columns={CC_COLUMNS}
        rows={rows}
        searchKeys={["code", "name", "worksiteName", "description"]}
        pageSize={20}
        emptyTitle="Sin centros de costo"
        emptyDescription={canCreate ? "Crea el primer centro de costo para la organización." : "No hay centros de costo registrados."}
        emptyAction={canCreate ? <Button size="sm" onClick={openNew}><Plus size={14} />Nuevo centro</Button> : undefined}
        actions={canCreate ? <Button size="sm" onClick={openNew}><Plus size={14} />Nuevo centro</Button> : undefined}
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
                      <button
                        type="button"
                        onClick={() => openEdit(cc)}
                        className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                        aria-label={`Editar ${cc.name}`}
                      >
                        <PencilSimple size={15} />
                      </button>
                    )}
                    {canCreate && (
                      <form action={toggleAction}>
                        <input type="hidden" name="id" value={cc.id} />
                        <input type="hidden" name="activate" value={String(!cc.isActive)} />
                        <button
                          type="submit"
                          className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                          aria-label={cc.isActive ? "Desactivar" : "Reactivar"}
                        >
                          {cc.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                        </button>
                      </form>
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
          onClose={() => setSheetOpen(false)}
          editCostCenter={editCc}
          worksites={worksites}
        />
      )}
    </>
  )
}

export type { CostCenterRow, WorksiteOption }
