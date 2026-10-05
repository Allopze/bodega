"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { OptionSelect, type OptionSelectOption } from "@/components/ui/option-select"
import { IT_TICKET_CATEGORY_META, IT_TICKET_PRIORITY_META } from "@/lib/services/ti/constants"
import { IT_TICKET_CATEGORIES, IT_TICKET_PRIORITIES } from "@/lib/validation/ti"
import { DEFAULT_TICKET_ORDER, TICKET_ORDERS, type TicketOrder } from "@/lib/services/ti/ticket-sla"

const ASSIGNEE_OPTIONS: OptionSelectOption[] = [
  { value: "yo", label: "Asignados a mí" },
  { value: "sin_asignar", label: "Sin asignar" },
]
const DUE_OPTIONS: OptionSelectOption[] = [
  { value: "vencido", label: "Vencidos" },
  { value: "por_vencer", label: "Vencen en 24 h" },
]
const ORDER_LABELS: Record<TicketOrder, string> = {
  urgencia: "Más urgentes primero",
  vence: "Vencen antes",
  prioridad: "Mayor prioridad",
  actualizado: "Actualizados recientemente",
  creado: "Creados recientemente",
}
const ORDER_OPTIONS: OptionSelectOption[] = TICKET_ORDERS.map((value) => ({ value, label: ORDER_LABELS[value] }))

const SELECT_CLASS = "h-11 w-full text-xs sm:h-8 sm:w-44"

/**
 * Filtros de la mesa de ayuda. La búsqueda es propia (esta ruta está en
 * `ROUTES_WITH_OWN_SEARCH`): la lista pagina en el servidor y el filtro de la
 * shell solo vería la página cargada.
 *
 * Primarios: búsqueda, responsable, vencimiento, prioridad y orden. Categoría y
 * faena van en «Más filtros», con contador de los activos (A2). El estado no
 * está aquí: lo expresan las pastillas (A5).
 */
export function TicketFilters({
  worksites,
  canManage,
}: {
  worksites: { id: string; name: string }[]
  canManage: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const get = (key: string) => searchParams.get(key) ?? ""
  const q = get("q")
  const assignee = canManage ? get("asignado") : ""
  const due = get("vencimiento")
  const priority = get("prioridad")
  const category = get("categoria")
  const worksite = get("faena")
  const order = (TICKET_ORDERS as readonly string[]).includes(get("orden")) ? get("orden") as TicketOrder : DEFAULT_TICKET_ORDER

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    if (value && !(key === "orden" && value === DEFAULT_TICKET_ORDER)) params.set(key, value)
    else params.delete(key)
    // Cambiar un filtro cambia el conjunto: la página 3 de antes ya no existe.
    params.delete("pagina")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const worksiteOptions: OptionSelectOption[] = worksites.map((w) => ({ value: w.id, label: w.name }))
  const priorityOptions: OptionSelectOption[] = IT_TICKET_PRIORITIES.map((p) => ({ value: p, label: IT_TICKET_PRIORITY_META[p]?.label ?? p }))
  const categoryOptions: OptionSelectOption[] = IT_TICKET_CATEGORIES.map((c) => ({ value: c, label: IT_TICKET_CATEGORY_META[c] ?? c }))

  const chips: ActiveFilterChip[] = []
  const addChip = (key: string, label: string, value: string, options: OptionSelectOption[]) => {
    const match = options.find((o) => o.value === value)
    if (match) chips.push({ key, label, value, displayValue: String(match.label) })
  }
  if (q) chips.push({ key: "q", label: "Búsqueda", value: q, displayValue: q })
  addChip("asignado", "Responsable", assignee, ASSIGNEE_OPTIONS)
  addChip("vencimiento", "Vencimiento", due, DUE_OPTIONS)
  addChip("prioridad", "Prioridad", priority, priorityOptions)
  addChip("categoria", "Categoría", category, categoryOptions)
  addChip("faena", "Faena", worksite, worksiteOptions)

  const overflowActive = [category, worksite].filter(Boolean).length

  function clearAll() {
    // Conserva el estado (pastilla) y el orden: no son filtros de esta barra.
    const params = new URLSearchParams()
    const status = searchParams.get("estado")
    if (status) params.set("estado", status)
    if (order !== DEFAULT_TICKET_ORDER) params.set("orden", order)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <FilterToolbar
      activeChips={chips}
      activeCount={overflowActive}
      onRemoveChip={(key) => setParam(key, "")}
      onClearAll={clearAll}
      overflowFilters={(
        <>
          <OptionSelect
            aria-label="Filtrar por categoría"
            className={SELECT_CLASS}
            emptyLabel="Todas las categorías"
            options={categoryOptions}
            value={category}
            onValueChange={(v) => setParam("categoria", v)}
          />
          {worksites.length > 1 && (
            <OptionSelect
              aria-label="Filtrar por faena"
              className={SELECT_CLASS}
              emptyLabel="Todas las faenas"
              options={worksiteOptions}
              value={worksite}
              onValueChange={(v) => setParam("faena", v)}
            />
          )}
        </>
      )}
    >
      <FilterSearchInput
        param="q"
        pageKeys={["pagina"]}
        placeholder="Buscar ticket, trabajador o equipo..."
        ariaLabel="Buscar tickets"
      />
      {canManage && (
        <OptionSelect
          aria-label="Filtrar por responsable"
          className={SELECT_CLASS}
          emptyLabel="Todos los responsables"
          options={ASSIGNEE_OPTIONS}
          value={assignee}
          onValueChange={(v) => setParam("asignado", v)}
        />
      )}
      <OptionSelect
        aria-label="Filtrar por vencimiento"
        className={SELECT_CLASS}
        emptyLabel="Todos los vencimientos"
        options={DUE_OPTIONS}
        value={due}
        onValueChange={(v) => setParam("vencimiento", v)}
      />
      <OptionSelect
        aria-label="Filtrar por prioridad"
        className={SELECT_CLASS}
        emptyLabel="Toda prioridad"
        options={priorityOptions}
        value={priority}
        onValueChange={(v) => setParam("prioridad", v)}
      />
      <OptionSelect
        aria-label="Ordenar por"
        className={SELECT_CLASS}
        options={ORDER_OPTIONS}
        value={order}
        onValueChange={(v) => setParam("orden", v)}
      />
    </FilterToolbar>
  )
}
