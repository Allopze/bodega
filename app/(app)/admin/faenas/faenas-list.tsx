"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { toast } from "sonner"
import { Plus, PencilSimple, ToggleLeft, ToggleRight, CaretDown, CaretRight } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { WorksiteForm } from "./worksite-form"
import { CostCenterForm } from "./cost-center-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { toggleWorksiteActive, toggleCostCenterActive } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"

interface CostCenterRow { id: string; name: string; code: string; worksiteId: string; isActive: boolean; createdAt: string }
interface WorksiteRow   { id: string; name: string; code: string; address: string | null; region: string | null; isActive: boolean; createdAt: string; updatedAt: string; costCenters: CostCenterRow[] }

const WS_COLUMNS = [
  { key: "name",   label: "Faena",    sortable: true  },
  { key: "code",   label: "Código",   sortable: true, width: "w-32" },
  { key: "region", label: "Región",   sortable: true  },
  { key: "costCenters", label: "CC",  sortable: false, numeric: true, width: "w-16" },
  { key: "isActive", label: "Estado", sortable: true  },
  { key: "",       label: "",         sortable: false, width: "w-28" },
]

export function FaenasList({ worksites, costCenters }: { worksites: WorksiteRow[]; costCenters: CostCenterRow[] }) {
  const [wsSheetOpen,  setWsSheetOpen]  = React.useState(false)
  const [ccSheetOpen,  setCcSheetOpen]  = React.useState(false)
  const [editWs,       setEditWs]       = React.useState<WorksiteRow | null>(null)
  const [editCc,       setEditCc]       = React.useState<CostCenterRow | null>(null)
  const [expandedWs,   setExpandedWs]   = React.useState<string | null>(null)
  const [ccParentWsId, setCcParentWsId] = React.useState<string>("")

  const [wsToggleState, wsToggleAction] = useActionState(toggleWorksiteActive, INITIAL_STATE)
  const [ccToggleState, ccToggleAction] = useActionState(toggleCostCenterActive, INITIAL_STATE)

  useEffect(() => {
    if (wsToggleState.message) {
      if (wsToggleState.ok) toast.success(wsToggleState.message)
      else toast.error(wsToggleState.message)
    }
  }, [wsToggleState])

  useEffect(() => {
    if (ccToggleState.message) {
      if (ccToggleState.ok) toast.success(ccToggleState.message)
      else toast.error(ccToggleState.message)
    }
  }, [ccToggleState])

  function openNewWs()     { setEditWs(null);  setWsSheetOpen(true) }
  function openEditWs(ws: WorksiteRow) { setEditWs(ws); setWsSheetOpen(true) }
  function openNewCc(wsId: string)     { setEditCc(null); setCcParentWsId(wsId); setCcSheetOpen(true) }
  function openEditCc(cc: CostCenterRow) { setEditCc(cc); setCcParentWsId(cc.worksiteId); setCcSheetOpen(true) }

  const rows = worksites.map((ws) => ({
    ...ws,
    costCenters: costCenters.filter((cc) => cc.worksiteId === ws.id),
  })) as (WorksiteRow & Record<string, unknown>)[]

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
          const ws = row as unknown as WorksiteRow & { costCenters: CostCenterRow[] }
          const isExpanded = expandedWs === ws.id
          return (
            <React.Fragment key={ws.id}>
              <TableRow>
                {/* Name with expand toggle */}
                <TableCell>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button
                      onClick={() => setExpandedWs(isExpanded ? null : ws.id)}
                    className="shrink-0 p-0.5 rounded text-text-subtle hover:text-text transition-colors duration-(--duration-fast)"
                      aria-label={isExpanded ? "Contraer" : "Expandir centros de costo"}
                    >
                      {isExpanded ? <CaretDown size={13} /> : <CaretRight size={13} />}
                    </button>
                    <span className="text-sm font-medium text-text truncate">{ws.name}</span>
                  </div>
                </TableCell>
                <TableCell><span className="font-mono text-xs">{ws.code}</span></TableCell>
                <TableCell className="text-sm text-text-muted">{ws.region ?? "—"}</TableCell>
                <TableCell className="text-right font-mono text-xs text-text-muted">
                  {ws.costCenters.length}
                </TableCell>
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
                    <button onClick={() => openNewCc(ws.id)} className="p-1.5 rounded-sm text-text-subtle hover:text-text hover:bg-surface-2 transition-colors duration-(--duration-fast) active:scale-[0.97]" title="Nuevo CC">
                      <Plus size={14} />
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

              {/* Expanded cost centers */}
              {isExpanded && ws.costCenters.map((cc) => (
                <TableRow key={cc.id} className="bg-surface-2">
                  <TableCell className="pl-8">
                    <span className="text-xs text-text-muted">{cc.name}</span>
                  </TableCell>
                  <TableCell><span className="font-mono text-xs text-text-subtle">{cc.code}</span></TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell>
                    <Badge variant={cc.isActive ? "success" : "default"} dot size="sm">
                      {cc.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEditCc(cc)} className="p-1.5 rounded-sm text-text-subtle hover:text-text hover:bg-border transition-colors duration-(--duration-fast) active:scale-[0.97]" title="Editar CC">
                        <PencilSimple size={13} />
                      </button>
                      <form action={ccToggleAction}>
                        <input type="hidden" name="id"       value={cc.id} />
                        <input type="hidden" name="activate" value={String(!cc.isActive)} />
                        <button type="submit" className="p-1.5 rounded-sm text-text-subtle hover:text-text hover:bg-border transition-colors duration-(--duration-fast) active:scale-[0.97]" title={cc.isActive ? "Desactivar" : "Activar"}>
                          {cc.isActive ? <ToggleRight size={13} className="text-primary" /> : <ToggleLeft size={13} />}
                        </button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {isExpanded && ws.costCenters.length === 0 && (
                <TableRow className="bg-surface-2">
                  <TableCell colSpan={6} className="pl-8 py-2 text-xs text-text-subtle">
                    Sin centros de costo — <button type="button" onClick={() => openNewCc(ws.id)} className="text-primary hover:underline">agregar</button>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          )
        }}
      />

      <WorksiteForm
        open={wsSheetOpen}
        onClose={() => setWsSheetOpen(false)}
        editWorksite={editWs}
      />
      <CostCenterForm
        open={ccSheetOpen}
        onClose={() => setCcSheetOpen(false)}
        editCostCenter={editCc}
        worksites={worksites.map((w) => ({ id: w.id, name: w.name }))}
        defaultWorksiteId={ccParentWsId}
      />
    </>
  )
}
