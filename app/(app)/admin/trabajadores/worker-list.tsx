"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { toast } from "@/lib/toast"
import { Plus, PencilSimple, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { WorkerForm } from "./worker-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { toggleWorkerActive } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"

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

const COLUMNS = [
  { key: "name",         label: "Trabajador",    sortable: true  },
  { key: "rut",          label: "RUT",           sortable: true,  width: "w-32" },
  { key: "position",     label: "Cargo",         sortable: true  },
  { key: "worksiteName", label: "Faena",         sortable: true  },
  { key: "isActive",     label: "Estado",        sortable: true,  width: "w-24" },
  { key: "",             label: "",              sortable: false, width: "w-16" },
]

export function WorkerList({
  workers, worksites,
}: {
  workers:   WorkerRow[]
  worksites: WorksiteOption[]
}) {
  const [sheetOpen,  setSheetOpen]  = React.useState(false)
  const [editWorker, setEditWorker] = React.useState<WorkerRow | null>(null)
  const [toggleState, toggleAction] = useActionState(toggleWorkerActive, INITIAL_STATE)

  useEffect(() => {
    if (toggleState.message) {
      if (toggleState.ok) toast.success(toggleState.message)
      else toast.error(toggleState.message)
    }
  }, [toggleState])

  function openCreate()             { setEditWorker(null); setSheetOpen(true) }
  function openEdit(w: WorkerRow)   { setEditWorker(w);    setSheetOpen(true) }

  return (
    <>
      <DataTable
        columns={COLUMNS}
        rows={workers as unknown as Record<string, unknown>[]}
        searchKeys={["firstName", "lastName", "rut", "position", "worksiteName"]}
        pageSize={25}
        searchPlaceholder="Buscar trabajador, RUT o cargo..."
        emptyTitle="Sin trabajadores"
        emptyDescription="Registra el primer trabajador para gestionar entregas de EPP."
        emptyAction={<Button size="sm" onClick={openCreate}><Plus size={14} />Nuevo trabajador</Button>}
        actions={<Button size="sm" onClick={openCreate}><Plus size={14} />Nuevo trabajador</Button>}
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
                <button onClick={() => openEdit(w)} className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)]" title="Editar" aria-label="Editar trabajador">
                  <PencilSimple size={16} />
                </button>
                <form action={toggleAction}>
                  <input type="hidden" name="id" value={w.id} />
                  <input type="hidden" name="activate" value={String(!w.isActive)} />
                  <button type="submit" className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)]" title={w.isActive ? "Desactivar" : "Activar"}>
                    {w.isActive ? <ToggleRight size={20} className="text-[var(--color-primary)]" /> : <ToggleLeft size={20} />}
                  </button>
                </form>
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
                  <button
                    onClick={() => openEdit(w)}
                    className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)]"
                    title="Editar"
                  >
                    <PencilSimple size={16} />
                  </button>
                  <form action={toggleAction}>
                    <input type="hidden" name="id"       value={w.id} />
                    <input type="hidden" name="activate" value={String(!w.isActive)} />
                    <button
                      type="submit"
                      className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)]"
                      title={w.isActive ? "Desactivar" : "Activar"}
                    >
                      {w.isActive
                        ? <ToggleRight size={20} className="text-[var(--color-primary)]" />
                        : <ToggleLeft  size={20} />}
                    </button>
                  </form>
                </div>
              </TableCell>
            </TableRow>
          )
        }}
      />
      <WorkerForm
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editWorker={editWorker}
        worksites={worksites}
      />
    </>
  )
}
