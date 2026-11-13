"use client"

import * as React from "react"
import { Field } from "@/components/ui/field"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatFuelVehicleStatus } from "@/lib/combustibles/validation"
import { FLEET_STOPPED_FILTER, FLEET_STOPPED_FILTER_LABEL } from "@/lib/fleet-overview-filters"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

interface FleetFiltersProps {
  operationalStatuses: string[]
  responsibleUsers: Array<{ id: string; name: string }>
  current: {
    estado?: string
    responsable?: string
    vencimiento?: string
    revision?: string
    q?: string
  }
  warningDays: number
}

/** El estado puede ser un estado operativo o el alias `detenidos` (enlazado desde el Panel operacional). */
function formatFleetStatusFilter(value: string) {
  return value === FLEET_STOPPED_FILTER ? FLEET_STOPPED_FILTER_LABEL : formatFuelVehicleStatus(value)
}

/**
 * El buscador escribe en la URL cuando la persona deja de teclear (`router.replace`
 * con `scroll: false`, sin recargar la página). Si la URL cambia desde otro lado
 * —un chip quitado, «Limpiar filtros»—, el campo se vuelve a alinear con ella.
 */
function SearchInput({ current }: { current: string }) {
  const { setFilter } = useUrlFilters()
  const [value, setValue] = React.useState(current)
  const [lastSynced, setLastSynced] = React.useState(current)
  if (lastSynced !== current) {
    setLastSynced(current)
    setValue(current)
  }
  React.useEffect(() => {
    if (value.trim() === current) return
    const timer = window.setTimeout(() => setFilter("q", value.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [value, current, setFilter])
  return (
    <Field label="Buscar" htmlFor="fleet-search" className="w-full sm:w-64">
      <Input
        id="fleet-search"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Patente, marca, modelo, faena..."
      />
    </Field>
  )
}

export function FleetFilters({ operationalStatuses, responsibleUsers, current, warningDays }: FleetFiltersProps) {
  const { setFilter, clearFilters } = useUrlFilters()

  const activeChips: ActiveFilterChip[] = []
  if (current.estado) {
    activeChips.push({ key: "estado", label: "Estado", value: current.estado, displayValue: formatFleetStatusFilter(current.estado) })
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
  if (current.revision === "estado") {
    activeChips.push({
      key: "revision",
      label: "Revisión",
      value: "estado",
      displayValue: "Estado distinto entre ficha e intervalo",
    })
  }
  if (current.q) {
    activeChips.push({ key: "q", label: "Búsqueda", value: current.q, displayValue: current.q })
  }

  return (
    <FilterToolbar
      activeChips={activeChips}
      onRemoveChip={(key) => setFilter(key, "")}
      onClearAll={() => clearFilters()}
      hasActiveFilters={activeChips.length > 0}
    >
      <SearchInput current={current.q ?? ""} />

      <Select
        value={current.estado ?? "all"}
        onValueChange={(v) => setFilter("estado", v === "all" ? "" : v)}
      >
        <SelectTrigger className="w-full text-xs sm:w-56" aria-label="Estado operacional"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          <SelectItem value={FLEET_STOPPED_FILTER}>{FLEET_STOPPED_FILTER_LABEL}</SelectItem>
          {operationalStatuses.map((s) => (
            <SelectItem key={s} value={s}>{formatFuelVehicleStatus(s)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={current.responsable ?? "all"}
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
        value={current.vencimiento ?? "all"}
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
