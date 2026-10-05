"use client"

import { usePathname, useRouter } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IT_RETIREMENT_REASONS } from "@/lib/validation/ti"
import { IT_RETIREMENT_REASON_META } from "@/lib/services/ti/constants"

const ALL = "_all"

/** Filtros de servidor de Bajas: motivo y faena. Texto: buscador de la barra superior. */
export function RetirementFilters({
  current, worksites,
}: {
  current: { motivo: string; faena: string }
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
  if (current.motivo) chips.push({ key: "motivo", label: "Motivo", value: current.motivo, displayValue: IT_RETIREMENT_REASON_META[current.motivo] ?? current.motivo })
  if (current.faena) chips.push({ key: "faena", label: "Faena", value: current.faena, displayValue: worksites.find((w) => w.id === current.faena)?.name ?? "Faena" })

  const trigger = "h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[9rem]"
  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setParam(key as keyof typeof current, null)}
      onClearAll={() => router.replace(pathname, { scroll: false })}
    >
      <Select value={current.motivo || ALL} onValueChange={(v) => setParam("motivo", v)}>
        <SelectTrigger className={trigger} aria-label="Filtrar por motivo de baja">
          <SelectValue placeholder="Todos los motivos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los motivos</SelectItem>
          {IT_RETIREMENT_REASONS.map((r) => <SelectItem key={r} value={r}>{IT_RETIREMENT_REASON_META[r] ?? r}</SelectItem>)}
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
    </FilterToolbar>
  )
}
