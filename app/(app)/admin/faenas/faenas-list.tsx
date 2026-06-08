"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { toast } from "sonner"
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
                  <Badge variant={ws.isActive ? "success" : "default"} dot>
                    {ws.isActive ? "Activa" : "Inactiva"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => openEditWs(ws)} className="p-1.5 rounded-sm text-text-subtle hover:text-text hover:bg-surface-2 transition-colors duration-(--duration-fast) active:scale-[0.97]" title="Editar">
                      <PencilSimple size={14} />
                    </button>
                    <form action={wsToggleAction}>
                      <input type="hidden" name="id"       value={ws.id} />
                      <input type="hidden" name="activate" value={String(!ws.isActive)} />
                      <button type="submit" className="p-1.5 rounded-sm text-text-subtle hover:text-text hover:bg-surface-2 transition-colors duration-(--duration-fast) active:scale-[0.97]" title={ws.isActive ? "Desactivar" : "Activar"}>
                        {ws.isActive ? <ToggleRight size={14} className="text-primary" /> : <ToggleLeft size={14} />}
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
