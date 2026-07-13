"use client"

import * as React from "react"
import { DataTable } from "@/components/admin/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/lib/toast"
import { toggleFuelVehicleActiveAction, bulkToggleFuelVehicleActiveAction } from "../actions"
import { VehicleForm } from "./vehicle-form"
import { VehicleDesktopRow, VehicleMobileCard, type VehicleRow } from "./vehicle-catalog-items"
import { COLUMNS, CONTRACT } from "./catalog-contract"

async function toggleVehicleActive(_prev: unknown, formData: FormData) {
  const id = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  return toggleFuelVehicleActiveAction(id, activate)
}

export function VehicleCatalogTable({ vehicles, worksites, users, equipmentTypes, suppliers, products }: {
  vehicles: VehicleRow[]
  worksites: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
  equipmentTypes: Array<{ id: string; name: string; category: string; defaultMeterType: string; defaultPerformanceUnit: string; isActive: boolean }>
  suppliers: Array<{ id: string; name: string }>
  products: Array<{ id: string; name: string; unit: string; isActive: boolean }>
}) {
  const {
    sheetOpen: formOpen,
    editRow: editVehicle,
    openEdit,
    closeSheet,
    toggleAction,
    togglePending,
  } = useCatalogSheet<VehicleRow>(toggleVehicleActive)
  const [confirmId, setConfirmId] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<"active" | "inactive">("active")
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [bulkActionType, setBulkActionType] = React.useState<"activate" | "deactivate" | null>(null)
  const [bulkPending, setBulkPending] = React.useState(false)

  const activeVehicles = React.useMemo(() => vehicles.filter((v) => v.isActive), [vehicles])
  const inactiveVehicles = React.useMemo(() => vehicles.filter((v) => !v.isActive), [vehicles])

  const currentVehicles = tab === "active" ? activeVehicles : inactiveVehicles

  // Reset selection when switching tabs
  React.useEffect(() => { setSelectedIds(new Set()) }, [tab])

  // ── Bulk selection helpers ────────────────────────────────────────────────
  const allIds = React.useMemo(() => new Set(currentVehicles.map((v) => v.id)), [currentVehicles])
  const allSelected = allIds.size > 0 && allIds.size === selectedIds.size

  const selectAllRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedIds.size > 0 && !allSelected
    }
  }, [selectedIds, allSelected])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allIds))
    }
  }

  // Columns with checkbox
  const CHECKBOX_WIDTH = "w-10"
  const COLUMNS_WITH_CHECKBOX = [
    { key: "_sel", label: "Sel.", sortable: false, width: CHECKBOX_WIDTH },
    ...COLUMNS,
  ]

  const renderRow = React.useCallback((row: Record<string, unknown>) => {
    const v = row as unknown as VehicleRow
    return <VehicleDesktopRow vehicle={v} selected={selectedIds.has(v.id)} onSelect={toggleSelect} onEdit={openEdit} onDeactivate={setConfirmId} toggleAction={toggleAction} togglePending={togglePending} />
  }, [openEdit, toggleAction, togglePending, selectedIds])

  const renderMobileCard = React.useCallback((row: Record<string, unknown>) => {
    const v = row as unknown as VehicleRow
    return <VehicleMobileCard vehicle={v} selected={selectedIds.has(v.id)} onSelect={toggleSelect} onEdit={openEdit} onDeactivate={setConfirmId} toggleAction={toggleAction} togglePending={togglePending} />
  }, [openEdit, toggleAction, togglePending, selectedIds])

  return (
    <>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "active" | "inactive")}
      >
        <div className="flex items-center justify-between mb-3">
          <TabsList>
            <TabsTrigger value="active">
              Activos
              <span className="ml-1.5 text-xs text-[var(--color-text-subtle)]">{activeVehicles.length}</span>
            </TabsTrigger>
            <TabsTrigger value="inactive">
              Inactivos
              <span className="ml-1.5 text-xs text-[var(--color-text-subtle)]">{inactiveVehicles.length}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
              aria-label="Seleccionar o deseleccionar todos"
            />
            {allSelected
              ? `${selectedIds.size} seleccionados`
              : selectedIds.size > 0
                ? `${selectedIds.size} seleccionados`
                : "Seleccionar todo"}
          </label>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] px-4 py-2 mb-3">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {selectedIds.size} vehículo{selectedIds.size === 1 ? "" : "s"} seleccionado{selectedIds.size === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              {tab === "inactive" && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setBulkActionType("activate")}
                >
                  Reactivar seleccionados
                </Button>
              )}
              {tab === "active" && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setBulkActionType("deactivate")}
                >
                  Desactivar seleccionados
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                Limpiar selección
              </Button>
            </div>
          </div>
        )}

        <TabsContent value="active">
          <DataTable
            columns={COLUMNS_WITH_CHECKBOX}
            rows={activeVehicles as unknown as Record<string, unknown>[]}
            searchKeys={CONTRACT.searchKeys}
            tableClassName="table-fixed min-w-0"
            pageSize={25}
            emptyTitle="Sin vehículos activos"
            emptyDescription="No hay vehículos activos en el catálogo."
            renderRow={renderRow}
            renderMobileCard={renderMobileCard}
          />
        </TabsContent>

        <TabsContent value="inactive">
          <DataTable
            columns={COLUMNS_WITH_CHECKBOX}
            rows={inactiveVehicles as unknown as Record<string, unknown>[]}
            searchKeys={CONTRACT.searchKeys}
            tableClassName="table-fixed min-w-0"
            pageSize={25}
            emptyTitle="Sin vehículos inactivos"
            emptyDescription="No hay vehículos dados de baja en el catálogo."
            renderRow={renderRow}
            renderMobileCard={renderMobileCard}
          />
        </TabsContent>
      </Tabs>

      {/* Single deactivation confirm dialog */}
      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => { if (!open) setConfirmId(null) }}
        title="¿Desactivar vehículo?"
        description="El vehículo quedará inactivo y no aparecerá en las listas de selección. Esta acción no elimina sus cargas ni registros históricos, y puede revertirse reactivándolo."
        confirmLabel="Desactivar"
        variant="warning"
        loading={togglePending}
        onConfirm={() => {
          if (!confirmId) return
          const fd = new FormData()
          fd.set("id", confirmId)
          fd.set("activate", "false")
          toggleAction(fd)
          setConfirmId(null)
        }}
      />

      {/* Bulk action confirm dialog */}
      <ConfirmDialog
        open={bulkActionType !== null}
        onOpenChange={(open) => { if (!open) setBulkActionType(null) }}
        title={bulkActionType === "activate" ? "¿Reactivar vehículos seleccionados?" : "¿Desactivar vehículos seleccionados?"}
        description={`Se ${bulkActionType === "activate" ? "reactivarán" : "desactivarán"} ${selectedIds.size} vehículo${selectedIds.size === 1 ? "" : "s"}. Esta acción no elimina cargas ni registros históricos y puede revertirse individualmente.`}
        confirmLabel={bulkActionType === "activate" ? "Reactivar" : "Desactivar"}
        variant={bulkActionType === "activate" ? "default" : "warning"}
        loading={bulkPending}
        onConfirm={async () => {
          setBulkPending(true)
          const fd = new FormData()
          fd.set("ids", Array.from(selectedIds).join(","))
          fd.set("activate", String(bulkActionType === "activate"))
          const res = await bulkToggleFuelVehicleActiveAction({ ok: true, message: "" }, fd)
          setBulkPending(false)
          setBulkActionType(null)
          setSelectedIds(new Set())
          if (res.ok) toast.success(res.message ?? "Operación exitosa")
          else toast.error(res.message ?? "Error al realizar la operación")
        }}
      />

      <VehicleForm
        key={editVehicle?.id ?? "nuevo"}
        open={formOpen}
        onClose={closeSheet}
        worksites={worksites}
        users={users}
        equipmentTypes={equipmentTypes}
        suppliers={suppliers}
        products={products}
        editVehicle={editVehicle}
      />
    </>
  )
}
