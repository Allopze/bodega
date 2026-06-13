"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { toast } from "@/lib/toast"
import { Plus, PencilSimple, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { WorksiteForm } from "./worksite-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { toggleWorksiteActive } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"

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

const WS_COLUMNS = [
  { key: "name",   label: "Faena",    sortable: true  },
  { key: "code",   label: "Código",   sortable: true, width: "w-32" },
  { key: "region", label: "Región",   sortable: true  },
  { key: "isActive", label: "Estado", sortable: true  },
  { key: "",       label: "",         sortable: false, width: "w-28" },
]

export function FaenasList({ worksites }: { worksites: WorksiteRow[] }) {
  const [wsSheetOpen,  setWsSheetOpen]  = React.useState(false)
  const [editWs,       setEditWs]       = React.useState<WorksiteRow | null>(null)

  const [wsToggleState, wsToggleAction] = useActionState(toggleWorksiteActive, INITIAL_STATE)

  useEffect(() => {
    if (wsToggleState.message) {
      if (wsToggleState.ok) toast.success(wsToggleState.message)
      else toast.error(wsToggleState.message)
    }
  }, [wsToggleState])

  function openNewWs()     { setEditWs(null);  setWsSheetOpen(true) }
  function openEditWs(ws: WorksiteRow) { setEditWs(ws); setWsSheetOpen(true) }

  const rows = worksites as (WorksiteRow & Record<string, unknown>)[]

  return (
    <>
      <DataTable
        columns={WS_COLUMNS}
        rows={rows}
        searchKeys={["name", "code", "region"]}
        pageSize={20}
        searchPlaceholder="Buscar faena..."
        emptyTitle="Sin faenas"
        emptyDescription="Crea la primera faena para comenzar."
        emptyAction={<Button size="sm" onClick={openNewWs}><Plus size={14} />Nueva faena</Button>}
        actions={
          <Button size="sm" onClick={openNewWs}>
            <Plus size={14} />Nueva faena
          </Button>
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
                <button onClick={() => openEditWs(ws)} className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] active:scale-[0.97]" title="Editar">
                  <PencilSimple size={16} />
                </button>
                <form action={wsToggleAction}>
                  <input type="hidden" name="id" value={ws.id} />
                  <input type="hidden" name="activate" value={String(!ws.isActive)} />
                  <button type="submit" className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] active:scale-[0.97]" title={ws.isActive ? "Desactivar" : "Activar"}>
                    {ws.isActive ? <ToggleRight size={20} className="text-[var(--color-primary)]" /> : <ToggleLeft size={20} />}
                  </button>
                </form>
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
                    <button onClick={() => openEditWs(ws)} className="h-8 w-8 flex items-center justify-center rounded-sm text-text-subtle hover:text-text hover:bg-surface-2 transition-colors duration-(--duration-fast) active:scale-[0.97]" title="Editar">
                      <PencilSimple size={16} />
                    </button>
                    <form action={wsToggleAction}>
                      <input type="hidden" name="id"       value={ws.id} />
                      <input type="hidden" name="activate" value={String(!ws.isActive)} />
                      <button type="submit" className="h-8 w-8 flex items-center justify-center rounded-sm text-text-subtle hover:text-text hover:bg-surface-2 transition-colors duration-(--duration-fast) active:scale-[0.97]" title={ws.isActive ? "Desactivar" : "Activar"}>
                        {ws.isActive ? <ToggleRight size={20} className="text-primary" /> : <ToggleLeft size={20} />}
                      </button>
                    </form>
                  </div>
                </TableCell>
              </TableRow>
            </React.Fragment>
          )
        }}
      />

      <WorksiteForm
        open={wsSheetOpen}
        onClose={() => setWsSheetOpen(false)}
        editWorksite={editWs}
      />
    </>
  )
}
