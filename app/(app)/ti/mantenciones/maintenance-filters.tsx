"use client"

import { usePathname, useRouter } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { IT_MAINTENANCE_TYPES } from "@/lib/validation/ti"
import { IT_MAINTENANCE_TYPE_META } from "@/lib/services/ti/constants"
import { formatDate, todayInChile } from "@/lib/utils"

const ALL = "_all"

/**
 * Filtros de servidor de Mantenciones: tipo, faena y período (`desde`/`hasta`).
 * Son estado de la vista, no navegación: `router.replace` + `scroll: false`.
 * La búsqueda de texto no está acá: la hace el buscador de la barra superior
 * sobre la tabla (DataTable). Cada filtro activo es un chip removible (A2).
 */
export function MaintenanceFilters({
  current, worksites,
}: {
  current: { tipo: string; faena: string; desde: string; hasta: string }
  worksites: { id: string; name: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()

  function setParam(key: keyof typeof current, value: string | null) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(current)) if (v) params.set(k, v)
    if (value && value !== ALL) params.set(key, value)
    else params.delete(key)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const chips: ActiveFilterChip[] = []
  if (current.tipo) chips.push({ key: "tipo", label: "Tipo", value: current.tipo, displayValue: IT_MAINTENANCE_TYPE_META[current.tipo] ?? current.tipo })
  if (current.faena) chips.push({ key: "faena", label: "Faena", value: current.faena, displayValue: worksites.find((w) => w.id === current.faena)?.name ?? "Faena" })
  if (current.desde) chips.push({ key: "desde", label: "Desde", value: current.desde, displayValue: formatDate(current.desde) })
  if (current.hasta) chips.push({ key: "hasta", label: "Hasta", value: current.hasta, displayValue: formatDate(current.hasta) })

  const trigger = "h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[9rem]"
  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setParam(key as keyof typeof current, null)}
      onClearAll={() => router.replace(pathname, { scroll: false })}
    >
      <Select value={current.tipo || ALL} onValueChange={(v) => setParam("tipo", v)}>
        <SelectTrigger className={trigger} aria-label="Filtrar por tipo de mantención">
          <SelectValue placeholder="Todos los tipos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los tipos</SelectItem>
          {IT_MAINTENANCE_TYPES.map((t) => <SelectItem key={t} value={t}>{IT_MAINTENANCE_TYPE_META[t] ?? t}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={current.faena || ALL} onValueChange={(v) => setParam("faena", v)}>
        <SelectTrigger className={trigger} aria-label="Filtrar por faena">
          <SelectValue placeholder="Todas las faenas" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todas las faenas</SelectItem>
          {worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <DatePicker
        value={current.desde}
        onChange={(v) => setParam("desde", v)}
        max={current.hasta || todayInChile()}
        placeholder="Desde"
        ariaLabel="Mantenciones desde"
        className="sm:w-40"
      />
      <DatePicker
        value={current.hasta}
        onChange={(v) => setParam("hasta", v)}
        min={current.desde || undefined}
        max={todayInChile()}
        placeholder="Hasta"
        ariaLabel="Mantenciones hasta"
        className="sm:w-40"
      />
    </FilterToolbar>
  )
}
