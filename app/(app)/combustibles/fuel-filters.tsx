"use client"

import { DateRangePicker } from "@/components/ui/date-range-picker"
import { WorksiteSelect } from "@/components/ui/worksite-select"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

interface FuelFiltersProps {
  vehicles: Array<{ id: string; plate: string }>
  suppliers: Array<{ id: string; name: string }>
  worksites: Array<{ id: string; name: string }>
  products: Array<{ id: string; name: string }>
  currentFilters: {
    month?: string
    serviceType?: string
    vehicleId?: string
    worksiteId?: string
    supplierId?: string
    product?: string
    productId?: string
    status?: string
    startDate?: string
    endDate?: string
  }
}

export function FuelFilters({ vehicles, suppliers, worksites, products, currentFilters }: FuelFiltersProps) {
  const { setFilter, setFilters, clearFilters } = useUrlFilters()

  function setProductFilter(value: string) {
    if (value.startsWith("legacy:")) setFilters({ producto: value.slice("legacy:".length), productoId: undefined })
    else if (value !== "all") setFilters({ producto: undefined, productoId: value })
    else setFilters({ producto: undefined, productoId: undefined })
  }

  const activeChips: ActiveFilterChip[] = []
  if (currentFilters.startDate || currentFilters.endDate) {
    activeChips.push({
      key: "dateRange",
      label: "Período",
      value: `${currentFilters.startDate ?? ""} - ${currentFilters.endDate ?? ""}`,
      displayValue: `${currentFilters.startDate ?? "..."} al ${currentFilters.endDate ?? "..."}`,
    })
  }
  if (currentFilters.worksiteId) {
    const ws = worksites.find((w) => w.id === currentFilters.worksiteId)
    if (ws) activeChips.push({ key: "faena", label: "Faena", value: ws.id, displayValue: ws.name })
  }
  if (currentFilters.vehicleId) {
    const v = vehicles.find((veh) => veh.id === currentFilters.vehicleId)
    if (v) activeChips.push({ key: "vehicle", label: "Vehículo", value: v.id, displayValue: v.plate })
  }
  if (currentFilters.status) {
    activeChips.push({ key: "status", label: "Estado", value: currentFilters.status, displayValue: currentFilters.status })
  }

  function handleRemoveChip(key: string) {
    if (key === "dateRange") {
      setFilters({ startDate: undefined, endDate: undefined })
    } else {
      setFilter(key, "")
    }
  }

  const secondaryActiveCount =
    (currentFilters.serviceType ? 1 : 0) +
    (currentFilters.supplierId ? 1 : 0) +
    (currentFilters.productId || currentFilters.product ? 1 : 0)

  return (
    <FilterToolbar
      activeChips={activeChips}
      onRemoveChip={handleRemoveChip}
      onClearAll={clearFilters}
      hasActiveFilters={activeChips.length > 0 || secondaryActiveCount > 0}
      activeCount={secondaryActiveCount}
      overflowFilters={
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Servicio</Label>
            <Select defaultValue={currentFilters.serviceType ?? "all"} onValueChange={(v) => setFilter("service", v === "all" ? "" : v)}>
              <SelectTrigger aria-label="Todos"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="TCT">TCT</SelectItem>
                <SelectItem value="TAE">TAE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Proveedor</Label>
            <Select defaultValue={currentFilters.supplierId ?? "all"} onValueChange={(v) => setFilter("proveedor", v === "all" ? "" : v)}>
              <SelectTrigger aria-label="Todos"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los proveedores</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Producto</Label>
            <Select
              defaultValue={currentFilters.productId ?? (currentFilters.product ? `legacy:${currentFilters.product}` : "all")}
              onValueChange={setProductFilter}
            >
              <SelectTrigger aria-label="Todos"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los productos</SelectItem>
                {currentFilters.product && !currentFilters.productId && (
                  <SelectItem value={`legacy:${currentFilters.product}`}>{currentFilters.product} (legacy)</SelectItem>
                )}
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      }
    >
      <DateRangePicker
        fromValue={currentFilters.startDate ?? ""}
        toValue={currentFilters.endDate ?? ""}
        onFromChange={(iso) => setFilter("startDate", iso)}
        onToChange={(iso) => setFilter("endDate", iso)}
        pickerClassName="w-36 h-8 text-xs"
      />

      <WorksiteSelect
        worksites={worksites}
        value={currentFilters.worksiteId ?? ""}
        onChange={(v) => setFilter("faena", v)}
        triggerClassName="w-44 h-8 text-xs"
      />

      <Select defaultValue={currentFilters.vehicleId ?? "all"} onValueChange={(v) => setFilter("vehicle", v === "all" ? "" : v)}>
        <SelectTrigger aria-label="Vehículo" className="w-40 h-8 text-xs"><SelectValue placeholder="Vehículo" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los vehículos</SelectItem>
          {vehicles.map((v) => (
            <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select defaultValue={currentFilters.status ?? "all"} onValueChange={(v) => setFilter("status", v === "all" ? "" : v)}>
        <SelectTrigger aria-label="Estado" className="w-36 h-8 text-xs"><SelectValue placeholder="Estado" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          <SelectItem value="draft">Borrador</SelectItem>
          <SelectItem value="registered">Registrado</SelectItem>
          <SelectItem value="reconciled">Conciliado</SelectItem>
          <SelectItem value="cancelled">Anulado</SelectItem>
        </SelectContent>
      </Select>
    </FilterToolbar>
  )
}
