"use client"

import * as React from "react"
import { DataTable } from "@/components/ui/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { toggleFuelVehicleActiveAction, bulkToggleFuelVehicleActiveAction } from "../actions"
import { VehicleForm } from "./vehicle-form"
import { VehicleDesktopRow, VehicleMobileCard, type VehicleRow } from "./vehicle-catalog-items"
import { COLUMNS, CONTRACT } from "./catalog-contract"
import { pluralize } from "@/lib/utils"

const MIN_REASON_LENGTH = 5

async function toggleVehicleActive(_prev: unknown, formData: FormData) {
  const id = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  const reason = String(formData.get("reason") ?? "")
  return toggleFuelVehicleActiveAction(id, activate, reason)
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
  // Activar y desactivar exigen motivo (CO-025/CO-028): un único diálogo
  // simétrico para ambas direcciones, no sólo para la baja.
  const [toggleTarget, setToggleTarget] = React.useState<{ id: string; activate: boolean } | null>(null)
  const [toggleReason, setToggleReason] = React.useState("")
  const [tab, setTab] = React.useState<"active" | "inactive">("active")
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [bulkActionType, setBulkActionType] = React.useState<"activate" | "deactivate" | null>(null)
  const [bulkReason, setBulkReason] = React.useState("")
  const [bulkPending, setBulkPending] = React.useState(false)

  const activeVehicles = React.useMemo(() => vehicles.filter((v) => v.isActive), [vehicles])
  const inactiveVehicles = React.useMemo(() => vehicles.filter((v) => !v.isActive), [vehicles])

  // Reset selection when switching tabs
  React.useEffect(() => { setSelectedIds(new Set()) }, [tab])

  // ── Bulk selection helpers ────────────────────────────────────────────────
  // "Seleccionar todo" debe operar sobre lo que el usuario ve en la tabla
  // (filtrado por búsqueda + página actual), no sobre el tab completo — antes
  // marcaba vehículos ocultos por el buscador o en otras páginas.
  const [visibleActiveIds, setVisibleActiveIds] = React.useState<Set<string>>(new Set())
  const [visibleInactiveIds, setVisibleInactiveIds] = React.useState<Set<string>>(new Set())
  const onVisibleActiveRowsChange = React.useCallback(
    (rows: VehicleRow[]) => setVisibleActiveIds(new Set(rows.map((r) => r.id))), [])
  const onVisibleInactiveRowsChange = React.useCallback(
    (rows: VehicleRow[]) => setVisibleInactiveIds(new Set(rows.map((r) => r.id))), [])
  const allIds = tab === "active" ? visibleActiveIds : visibleInactiveIds
  const allSelected = allIds.size > 0 && allIds.size === selectedIds.size
    && Array.from(allIds).every((id) => selectedIds.has(id))

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
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) allIds.forEach((id) => next.delete(id))
      else allIds.forEach((id) => next.add(id))
      return next
    })
  }

  // Columns with checkbox
  const CHECKBOX_WIDTH = "w-10"
  const COLUMNS_WITH_CHECKBOX = [
    { key: "_sel", label: "Sel.", sortable: false, width: CHECKBOX_WIDTH },
    ...COLUMNS,
  ]

  const onToggleRequest = React.useCallback((id: string, activate: boolean) => {
    setToggleReason("")
    setToggleTarget({ id, activate })
  }, [])

  const renderRow = React.useCallback((v: VehicleRow) => {
    return <VehicleDesktopRow vehicle={v} selected={selectedIds.has(v.id)} onSelect={toggleSelect} onEdit={openEdit} onToggleRequest={onToggleRequest} toggleAction={toggleAction} togglePending={togglePending} />
  }, [openEdit, onToggleRequest, toggleAction, togglePending, selectedIds])

  const renderMobileCard = React.useCallback((v: VehicleRow) => {
    return <VehicleMobileCard vehicle={v} selected={selectedIds.has(v.id)} onSelect={toggleSelect} onEdit={openEdit} onToggleRequest={onToggleRequest} toggleAction={toggleAction} togglePending={togglePending} />
  }, [openEdit, onToggleRequest, toggleAction, togglePending, selectedIds])

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
          <Checkbox
            ref={selectAllRef}
            checked={allSelected}
            onChange={toggleSelectAll}
            label={<span className="text-xs text-[var(--color-text-subtle)]">
              {selectedIds.size > 0 ? `${selectedIds.size} seleccionados` : "Seleccionar todo"}
            </span>}
          />
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] px-4 py-2 mb-3">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {pluralize(selectedIds.size, "vehículo")} {pluralize(selectedIds.size, "seleccionado", "seleccionados")}
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
            caption="Vehículos activos"
            columns={COLUMNS_WITH_CHECKBOX}
            rows={activeVehicles}
            searchKeys={CONTRACT.searchKeys as (keyof VehicleRow)[]}
            tableClassName="table-fixed min-w-0"
            pageSize={25}
            emptyTitle="Sin vehículos activos"
            emptyDescription="No hay vehículos activos en el catálogo."
            renderRow={renderRow}
            renderMobileCard={renderMobileCard}
            onVisibleRowsChange={onVisibleActiveRowsChange}
          />
        </TabsContent>

        <TabsContent value="inactive">
          <DataTable
            caption="Vehículos inactivos"
            columns={COLUMNS_WITH_CHECKBOX}
            rows={inactiveVehicles}
            searchKeys={CONTRACT.searchKeys as (keyof VehicleRow)[]}
            tableClassName="table-fixed min-w-0"
            pageSize={25}
            emptyTitle="Sin vehículos inactivos"
            emptyDescription="No hay vehículos dados de baja en el catálogo."
            renderRow={renderRow}
            renderMobileCard={renderMobileCard}
            onVisibleRowsChange={onVisibleInactiveRowsChange}
          />
        </TabsContent>
      </Tabs>

      {/* Activar/desactivar exige motivo (CO-025/CO-028): mismo diálogo para ambas direcciones. */}
      <Dialog open={toggleTarget !== null} onOpenChange={(open) => { if (!open) setToggleTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{toggleTarget?.activate ? "¿Reactivar vehículo?" : "¿Desactivar vehículo?"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-text-muted)]">
            {toggleTarget?.activate
              ? "El vehículo volverá a aparecer en las listas de selección."
              : "El vehículo quedará inactivo y no aparecerá en las listas de selección. Esta acción no elimina sus cargas ni registros históricos, y puede revertirse reactivándolo."}
          </p>
          <div>
            <Label htmlFor="vehicle-toggle-reason" required>Motivo</Label>
            <Textarea
              id="vehicle-toggle-reason"
              value={toggleReason}
              onChange={(event) => setToggleReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Registra el antecedente operacional de este cambio"
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setToggleTarget(null)} disabled={togglePending}>Volver</Button>
            <Button
              variant={toggleTarget?.activate ? "primary" : "signal"}
              disabled={togglePending || toggleReason.trim().length < MIN_REASON_LENGTH}
              onClick={() => {
                if (!toggleTarget) return
                const fd = new FormData()
                fd.set("id", toggleTarget.id)
                fd.set("activate", String(toggleTarget.activate))
                fd.set("reason", toggleReason)
                toggleAction(fd)
                setToggleTarget(null)
              }}
            >
              {togglePending ? "Guardando..." : (toggleTarget?.activate ? "Reactivar" : "Desactivar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk action dialog — mismo motivo obligatorio que el individual. */}
      <Dialog open={bulkActionType !== null} onOpenChange={(open) => { if (!open) setBulkActionType(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{bulkActionType === "activate" ? "¿Reactivar vehículos seleccionados?" : "¿Desactivar vehículos seleccionados?"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-text-muted)]">
            {`Se ${bulkActionType === "activate" ? "reactivarán" : "desactivarán"} ${pluralize(selectedIds.size, "vehículo")}. Esta acción no elimina cargas ni registros históricos y puede revertirse individualmente.`}
          </p>
          <div>
            <Label htmlFor="vehicle-bulk-toggle-reason" required>Motivo</Label>
            <Textarea
              id="vehicle-bulk-toggle-reason"
              value={bulkReason}
              onChange={(event) => setBulkReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Registra el antecedente operacional de este cambio"
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setBulkActionType(null)} disabled={bulkPending}>Volver</Button>
            <Button
              variant={bulkActionType === "activate" ? "primary" : "signal"}
              disabled={bulkPending || bulkReason.trim().length < MIN_REASON_LENGTH}
              onClick={async () => {
                setBulkPending(true)
                const fd = new FormData()
                fd.set("ids", Array.from(selectedIds).join(","))
                fd.set("activate", String(bulkActionType === "activate"))
                fd.set("reason", bulkReason)
                const res = await bulkToggleFuelVehicleActiveAction({ ok: true, message: "" }, fd)
                setBulkPending(false)
                setBulkActionType(null)
                setSelectedIds(new Set())
                setBulkReason("")
                if (res.ok) toast.success(res.message ?? "Operación exitosa")
                else toast.error(res.message ?? "Error al realizar la operación")
              }}
            >
              {bulkPending ? "Guardando..." : (bulkActionType === "activate" ? "Reactivar" : "Desactivar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
