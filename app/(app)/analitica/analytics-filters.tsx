"use client"

import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { Funnel, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AnalyticsFilters } from "@/lib/services/analytics"

interface Option {
  id: string
  name: string
}

export function AnalyticsFiltersBar({
  filters,
  worksites,
  suppliers,
  vehicles,
}: {
  filters: Required<Pick<AnalyticsFilters, "fromDate" | "toDate">> & Omit<AnalyticsFilters, "fromDate" | "toDate">
  worksites: Option[]
  suppliers: Option[]
  vehicles: Array<Option & { plate?: string }>
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [fromDate, setFromDate] = React.useState(filters.fromDate)
  const [toDate, setToDate] = React.useState(filters.toDate)
  const [worksiteId, setWorksiteId] = React.useState(filters.worksiteId ?? "")
  const [supplierId, setSupplierId] = React.useState(filters.supplierId ?? "")
  const [vehicleId, setVehicleId] = React.useState(filters.vehicleId ?? "")

  function apply() {
    const params = new URLSearchParams(searchParams.toString())
    sync(params, "from", fromDate)
    sync(params, "to", toDate)
    sync(params, "faena", worksiteId)
    sync(params, "proveedor", supplierId)
    sync(params, "vehiculo", vehicleId)
    router.replace(`/analitica?${params.toString()}`, { scroll: false })
  }

  function clear() {
    router.replace("/analitica", { scroll: false })
  }

  return (
    <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]" aria-label="Filtros de analítica">
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-subtle)]" htmlFor="analytics-from">Desde</label>
          <DatePicker id="analytics-from" value={fromDate} onChange={setFromDate} placeholder="Desde" />
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-subtle)]" htmlFor="analytics-to">Hasta</label>
          <DatePicker id="analytics-to" value={toDate} onChange={setToDate} placeholder="Hasta" />
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-subtle)]" htmlFor="analytics-worksite">Faena</label>
          <Select value={worksiteId || "_all"} onValueChange={(value) => setWorksiteId(value === "_all" ? "" : value)}>
            <SelectTrigger id="analytics-worksite" aria-label="Filtrar por faena">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Todas</SelectItem>
              {worksites.map((worksite) => (
                <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-subtle)]" htmlFor="analytics-supplier">Proveedor OC</label>
          <Select value={supplierId || "_all"} onValueChange={(value) => setSupplierId(value === "_all" ? "" : value)}>
            <SelectTrigger id="analytics-supplier" aria-label="Filtrar por proveedor de orden de compra">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Todos</SelectItem>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-subtle)]" htmlFor="analytics-vehicle">Vehículo</label>
          <Select value={vehicleId || "_all"} onValueChange={(value) => setVehicleId(value === "_all" ? "" : value)}>
            <SelectTrigger id="analytics-vehicle" aria-label="Filtrar por vehículo">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Todos</SelectItem>
              {vehicles.map((vehicle) => (
                <SelectItem key={vehicle.id} value={vehicle.id}>{vehicle.plate ?? vehicle.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 lg:justify-end">
          <Button type="button" size="sm" onClick={apply}>
            <Funnel className="h-4 w-4" />
            Filtrar
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={clear} aria-label="Limpiar filtros">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  )
}

function sync(params: URLSearchParams, key: string, value: string | undefined) {
  if (value) params.set(key, value)
  else params.delete(key)
}
