"use client"

import { usePathname, useRouter } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IT_TICKET_CATEGORY_META, IT_TICKET_PRIORITY_META } from "@/lib/services/ti/constants"
import { IT_TICKET_CATEGORIES, IT_TICKET_PRIORITIES } from "@/lib/validation/ti"

const ALL = "_all"

/**
 * Prioridad y categoría viajaban en la URL (el tablero enlaza a
 * `?prioridad=critica`) sin control visible: la lista salía filtrada mientras
 * la pastilla "Todos" aparecía activa. Los chips los hacen visibles y
 * removibles, como exige A2.
 */
export function TicketFilters({
  current,
}: {
  current: Record<string, string | string[] | undefined>
}) {
  const router = useRouter()
  const pathname = usePathname()

  const priority = typeof current.prioridad === "string" ? current.prioridad : ""
  const category = typeof current.categoria === "string" ? current.categoria : ""

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(current)) {
      if (typeof v === "string" && v) params.set(k, v)
    }
    if (value && value !== ALL) params.set(key, value)
    else params.delete(key)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const chips: ActiveFilterChip[] = []
  if (priority) {
    chips.push({
      key: "prioridad",
      label: "Prioridad",
      value: priority,
      displayValue: IT_TICKET_PRIORITY_META[priority]?.label ?? priority,
    })
  }
  if (category) {
    chips.push({
      key: "categoria",
      label: "Categoría",
      value: category,
      displayValue: IT_TICKET_CATEGORY_META[category] ?? category,
    })
  }

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setParam(key, null)}
      onClearAll={() => router.replace(pathname, { scroll: false })}
    >
      <Select value={priority || ALL} onValueChange={(v) => setParam("prioridad", v)}>
        <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[9rem]" aria-label="Filtrar por prioridad">
          <SelectValue placeholder="Toda prioridad" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Toda prioridad</SelectItem>
          {IT_TICKET_PRIORITIES.map((p) => (
            <SelectItem key={p} value={p}>{IT_TICKET_PRIORITY_META[p]?.label ?? p}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={category || ALL} onValueChange={(v) => setParam("categoria", v)}>
        <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[9rem]" aria-label="Filtrar por categoría">
          <SelectValue placeholder="Toda categoría" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Toda categoría</SelectItem>
          {IT_TICKET_CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>{IT_TICKET_CATEGORY_META[c] ?? c}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterToolbar>
  )
}
