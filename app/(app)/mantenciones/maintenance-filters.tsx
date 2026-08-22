"use client"

import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface MaintenanceFiltersProps {
  vehicles: Array<{ id: string; plate: string }>
  worksites: Array<{ id: string; name: string }>
  statusLabels: Record<string, { label: string }>
  current: {
    vehicle?: string
    faena?: string
    status?: string
    q?: string
  }
}

export function MaintenanceFilters({ vehicles, worksites, statusLabels, current }: MaintenanceFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("page")
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-2 xl:grid-cols-5">
      <form action="/mantenciones" method="get">
        {current.vehicle && <input type="hidden" name="vehicle" value={current.vehicle} />}
        {current.faena && <input type="hidden" name="faena" value={current.faena} />}
        {current.status && <input type="hidden" name="status" value={current.status} />}
        <Field label="Buscar" htmlFor="maintenance-search">
          <Input
            id="maintenance-search"
            name="q"
            type="search"
            defaultValue={current.q ?? ""}
            placeholder="Patente, código, documento..."
          />
        </Field>
      </form>

      <Select
        defaultValue={current.vehicle ?? "all"}
        onValueChange={(v) => setFilter("vehicle", v === "all" ? "" : v)}
      >
        <SelectTrigger aria-label="Vehículo"><SelectValue placeholder="Todos los vehículos" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los vehículos</SelectItem>
          {vehicles.map((v) => (
            <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        defaultValue={current.faena ?? "all"}
        onValueChange={(v) => setFilter("faena", v === "all" ? "" : v)}
      >
        <SelectTrigger aria-label="Faena"><SelectValue placeholder="Todas las faenas" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las faenas</SelectItem>
          {worksites.map((w) => (
            <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        defaultValue={current.status ?? "all"}
        onValueChange={(v) => setFilter("status", v === "all" ? "" : v)}
      >
        <SelectTrigger aria-label="Estado"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          {Object.entries(statusLabels).map(([value, meta]) => (
            <SelectItem key={value} value={value}>{meta.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex justify-end gap-2">
        <Button asChild variant="ghost">
          <Link href="/mantenciones">Limpiar</Link>
        </Button>
      </div>
    </div>
  )
}
