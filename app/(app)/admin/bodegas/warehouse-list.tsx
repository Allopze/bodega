"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { toast } from "sonner"
import { Plus, PencilSimple, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { WarehouseForm } from "./warehouse-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { toggleWarehouseActive } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"

interface WarehouseRow {
  id: string; name: string; code: string; type: string
  worksiteId: string | null; worksiteName: string | null
  address: string | null; notes: string | null; isActive: boolean; createdAt: string
}
interface Worksite { id: string; name: string }

const TYPE_LABELS: Record<string, string> = {
  central:  "Central",
  worksite: "Faena",
  transit:  "Tránsito",
}

const COLUMNS = [
  { key: "name",         label: "Bodega",   sortable: true  },
  { key: "code",         label: "Código",   sortable: true, width: "w-32" },
  { key: "type",         label: "Tipo",     sortable: true, width: "w-24" },
  { key: "worksiteName", label: "Faena",    sortable: true  },
  { key: "isActive",     label: "Estado",   sortable: true, width: "w-24" },
  { key: "",             label: "",         sortable: false, width: "w-16" },
]

export function WarehouseList({ warehouses, worksites }: { warehouses: WarehouseRow[]; worksites: Worksite[] }) {
  const [sheetOpen,      setSheetOpen]     = React.useState(false)
  const [editWarehouse,  setEditWarehouse] = React.useState<WarehouseRow | null>(null)
  const [toggleState,    toggleAction]     = useActionState(toggleWarehouseActive, INITIAL_STATE)

  useEffect(() => {
    if (toggleState.message) {
      if (toggleState.ok) toast.success(toggleState.message)
      else toast.error(toggleState.message)
    }
  }, [toggleState])

  function openCreate()              { setEditWarehouse(null); setSheetOpen(true) }
  function openEdit(w: WarehouseRow) { setEditWarehouse(w);   setSheetOpen(true) }

  return (
    <>
      <DataTable
        columns={COLUMNS}
        rows={warehouses as unknown as Record<string, unknown>[]}
        searchKeys={["name", "code", "worksiteName"]}
        pageSize={20}
        searchPlaceholder="Buscar bodega..."
        emptyTitle="Sin bodegas"
        emptyDescription="Registra la primera bodega para comenzar."
        emptyAction={<Button size="sm" onClick={openCreate}><Plus size={14} />Nueva bodega</Button>}
        actions={<Button size="sm" onClick={openCreate}><Plus size={14} />Nueva bodega</Button>}
        renderRow={(row) => {
          const w = row as unknown as WarehouseRow
          return (
            <TableRow key={w.id}>
              <TableCell>
                <p className="text-sm font-medium text-text">{w.name}</p>
              </TableCell>
              <TableCell><span className="font-mono text-xs">{w.code}</span></TableCell>
              <TableCell>
                <Badge variant="default" size="sm">{TYPE_LABELS[w.type] ?? w.type}</Badge>
              </TableCell>
              <TableCell className="text-sm text-text-muted">
                {w.worksiteName ?? "—"}
              </TableCell>
              <TableCell>
                <Badge variant={w.isActive ? "success" : "default"} dot>
                  {w.isActive ? "Activa" : "Inactiva"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1 justify-end">
                  <button onClick={() => openEdit(w)} className="p-1.5 rounded-sm text-text-subtle hover:text-text hover:bg-surface-2 transition-colors duration-fast active:scale-[0.97]" title="Editar">
                    <PencilSimple size={14} />
                  </button>
                  <form action={toggleAction}>
                    <input type="hidden" name="id"       value={w.id} />
                    <input type="hidden" name="activate" value={String(!w.isActive)} />
                    <button type="submit" className="p-1.5 rounded-sm text-text-subtle hover:text-text hover:bg-surface-2 transition-colors duration-fast active:scale-[0.97]" title={w.isActive ? "Desactivar" : "Activar"}>
                      {w.isActive ? <ToggleRight size={14} className="text-primary" /> : <ToggleLeft size={14} />}
                    </button>
                  </form>
                </div>
              </TableCell>
            </TableRow>
          )
        }}
      />
      <WarehouseForm
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editWarehouse={editWarehouse}
        worksites={worksites}
      />
    </>
  )
}
