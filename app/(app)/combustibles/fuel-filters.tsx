"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

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
  const router = useRouter()
  const searchParams = useSearchParams()

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.delete("page")
    router.push(`?${params.toString()}`)
  }

  function clearFilters() {
    router.push("/combustibles/facturas")
  }

  function setProductFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("producto")
    params.delete("productoId")
    if (value.startsWith("legacy:")) params.set("producto", value.slice("legacy:".length))
    else if (value !== "all") params.set("productoId", value)
    params.delete("page")
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap gap-3 mb-6 p-4 bg-[var(--color-surface-2)] rounded-lg">
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Mes</Label>
        <Input type="month" className="w-44" defaultValue={currentFilters.month ?? ""} onChange={(e) => setFilter("month", e.target.value)} />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Desde</Label>
        <DatePicker className="w-40" defaultValue={currentFilters.startDate ?? ""} onChange={(iso) => setFilter("startDate", iso)} />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Hasta</Label>
        <DatePicker className="w-40" defaultValue={currentFilters.endDate ?? ""} onChange={(iso) => setFilter("endDate", iso)} />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Servicio</Label>
        <Select defaultValue={currentFilters.serviceType ?? "all"} onValueChange={(v) => setFilter("service", v === "all" ? "" : v)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="TCT">TCT</SelectItem>
            <SelectItem value="TAE">TAE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Vehículo</Label>
        <Select defaultValue={currentFilters.vehicleId ?? "all"} onValueChange={(v) => setFilter("vehicle", v === "all" ? "" : v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Faena</Label>
        <Select defaultValue={currentFilters.worksiteId ?? "all"} onValueChange={(v) => setFilter("faena", v === "all" ? "" : v)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {worksites.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Proveedor</Label>
        <Select defaultValue={currentFilters.supplierId ?? "all"} onValueChange={(v) => setFilter("proveedor", v === "all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Producto</Label>
        <Select defaultValue={currentFilters.productId ?? (currentFilters.product ? `legacy:${currentFilters.product}` : "all")} onValueChange={setProductFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {currentFilters.product && !currentFilters.productId && <SelectItem value={`legacy:${currentFilters.product}`}>{currentFilters.product} (legacy)</SelectItem>}
            {products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Estado</Label>
        <Select defaultValue={currentFilters.status ?? "all"} onValueChange={(v) => setFilter("status", v === "all" ? "" : v)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="draft">Borrador</SelectItem>
            <SelectItem value="registered">Registrado</SelectItem>
            <SelectItem value="reconciled">Conciliado</SelectItem>
            <SelectItem value="cancelled">Anulado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-end">
        <Button variant="ghost" size="sm" onClick={clearFilters}>Limpiar</Button>
      </div>
    </div>
  )
}
