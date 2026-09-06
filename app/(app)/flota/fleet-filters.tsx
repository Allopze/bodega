"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Field } from "@/components/ui/field"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatFuelVehicleStatus } from "@/lib/combustibles/validation"

interface FleetFiltersProps {
  operationalStatuses: string[]
  responsibleUsers: Array<{ id: string; name: string }>
  current: {
    estado?: string
    responsable?: string
    vencimiento?: string
    q?: string
  }
  warningDays: number
}

export function FleetFilters({ operationalStatuses, responsibleUsers, current, warningDays }: FleetFiltersProps) {
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
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  function clearFilters() {
    router.replace("/flota", { scroll: false })
  }

  const activeChips: ActiveFilterChip[] = []
  if (current.estado) {
    activeChips.push({ key: "estado", label: "Estado", value: current.estado, displayValue: formatFuelVehicleStatus(current.estado) })
  }
  if (current.responsable) {
    const resp = responsibleUsers.find((r) => r.id === current.responsable)
    if (resp) activeChips.push({ key: "responsable", label: "Responsable", value: resp.id, displayValue: resp.name })
  }
  if (current.vencimiento) {
    const vencLabel = current.vencimiento === "vencidos"
      ? "Documentos vencidos"
      : current.vencimiento === "proximos"
        ? `Próximos a vencer (${warningDays} días)`
        : "Al día"
    activeChips.push({ key: "vencimiento", label: "Vencimiento", value: current.vencimiento, displayValue: vencLabel })
  }
  if (current.q) {
    activeChips.push({ key: "q", label: "Búsqueda", value: current.q, displayValue: current.q })
  }

  return (
    <FilterToolbar
      activeChips={activeChips}
      onRemoveChip={(key) => setFilter(key, "")}
      onClearAll={clearFilters}
      hasActiveFilters={activeChips.length > 0}
    >
      <form action="/flota" method="get" className="w-full sm:w-64">
        {current.estado && <input type="hidden" name="estado" value={current.estado} />}
        {current.responsable && <input type="hidden" name="responsable" value={current.responsable} />}
        {current.vencimiento && <input type="hidden" name="vencimiento" value={current.vencimiento} />}
        <Field label="Buscar" htmlFor="fleet-search">
          <Input
            id="fleet-search"
            name="q"
            type="search"
            defaultValue={current.q ?? ""}
            placeholder="Patente, marca, modelo, faena..."
          />
        </Field>
      </form>

      <Select
        defaultValue={current.estado ?? "all"}
        onValueChange={(v) => setFilter("estado", v === "all" ? "" : v)}
      >
        <SelectTrigger className="w-full text-xs sm:w-44" aria-label="Estado operacional"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          {operationalStatuses.map((s) => (
            <SelectItem key={s} value={s}>{formatFuelVehicleStatus(s)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        defaultValue={current.responsable ?? "all"}
        onValueChange={(v) => setFilter("responsable", v === "all" ? "" : v)}
      >
        <SelectTrigger className="w-full text-xs sm:w-48" aria-label="Responsable"><SelectValue placeholder="Todos los responsables" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los responsables</SelectItem>
          {responsibleUsers.map((u) => (
            <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        defaultValue={current.vencimiento ?? "all"}
        onValueChange={(v) => setFilter("vencimiento", v === "all" ? "" : v)}
      >
        <SelectTrigger className="w-full text-xs sm:w-52" aria-label="Vencimiento documental"><SelectValue placeholder="Filtro de vencimiento" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Sin filtro de vencimiento</SelectItem>
          <SelectItem value="vencidos">Documentos vencidos</SelectItem>
          <SelectItem value="proximos">Próximos a vencer ({warningDays} días)</SelectItem>
          <SelectItem value="al-dia">Al día</SelectItem>
        </SelectContent>
      </Select>
    </FilterToolbar>
  )
}
