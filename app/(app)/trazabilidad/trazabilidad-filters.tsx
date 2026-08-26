"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

interface TrazabilidadFiltersProps {
  worksites: Array<{ id: string; name: string }>
  current: {
    faena?: string
    estado?: string
  }
}

const FILTER_ESTADOS = [
  { value: "alert", label: "Alerta: aprobado sin OC" },
  { value: "pending", label: "Pendiente de compra" },
  { value: "draft", label: "Borrador" },
  { value: "requested", label: "Solicitado" },
  { value: "approved", label: "Aprobado" },
  { value: "pending_purchase", label: "Pendiente compra" },
  { value: "in_purchase_order", label: "En OC" },
  { value: "purchased", label: "Comprado" },
  { value: "partially_received", label: "Recibido parcial" },
  { value: "received", label: "Recibido" },
  { value: "rejected", label: "Rechazado" },
]

export function TrazabilidadFilters({ worksites, current }: TrazabilidadFiltersProps) {
  const { setFilter, clearFilters } = useUrlFilters()

  const chips: ActiveFilterChip[] = []
  if (current.faena) {
    chips.push({
      key: "faena",
      label: "Faena",
      value: current.faena,
      displayValue: worksites.find((w) => w.id === current.faena)?.name ?? current.faena,
    })
  }
  if (current.estado) {
    chips.push({
      key: "estado",
      label: "Estado",
      value: current.estado,
      displayValue: FILTER_ESTADOS.find((e) => e.value === current.estado)?.label ?? current.estado,
    })
  }

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setFilter(key, "")}
      onClearAll={() => clearFilters()}
      hasActiveFilters={chips.length > 0}
    >
      <Select
        defaultValue={current.faena ?? "all"}
        onValueChange={(v) => setFilter("faena", v === "all" ? "" : v)}
      >
        <SelectTrigger className="w-56" aria-label="Filtrar por faena"><SelectValue placeholder="Todas las faenas" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las faenas</SelectItem>
          {worksites.map((w) => (
            <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        defaultValue={current.estado ?? "all"}
        onValueChange={(v) => setFilter("estado", v === "all" ? "" : v)}
      >
        <SelectTrigger className="w-56" aria-label="Filtrar por estado"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          {FILTER_ESTADOS.map((e) => (
            <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterToolbar>
  )
}
