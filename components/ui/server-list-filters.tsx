"use client"

import * as React from "react"
import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react"
import { usePathname } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { SavedViews } from "@/components/ui/saved-views"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { hasServerListFilters, SERVER_LIST_FILTER_PARAMS } from "./server-list-filter-params"

export interface ServerListFilterOption {
  value: string
  label: string
}

/* La lista de parámetros y su predicado viven fuera de este archivo porque
 * también los usa código de servidor, y todo export de un módulo `"use client"`
 * llega al servidor como referencia de cliente, no como el valor
 * (ver `server-list-filter-params.ts`). Se reexportan para no mover los
 * imports del lado cliente, que son la mayoría. */
export { SERVER_LIST_FILTER_PARAMS, hasServerListFilters } from "./server-list-filter-params"

interface ServerListFiltersProps {
  searchPlaceholder?: string
  statusOptions?: ServerListFilterOption[]
  urgencyOptions?: ServerListFilterOption[]
  worksiteOptions?: ServerListFilterOption[]
  supplierOptions?: ServerListFilterOption[]
  exportTipo?: string
  actions?: React.ReactNode
}

const ALL = "_all"

const selectOptions = [
  { key: "estado", label: "estado", allLabel: "Todos los estados", ariaLabel: "Filtrar por estado", prop: "statusOptions" },
  { key: "urgencia", label: "urgencia", allLabel: "Toda urgencia", ariaLabel: "Filtrar por urgencia", prop: "urgencyOptions" },
  { key: "faena", label: "faena", allLabel: "Todas las faenas", ariaLabel: "Filtrar por faena", prop: "worksiteOptions" },
  { key: "proveedor", label: "proveedor", allLabel: "Todos los proveedores", ariaLabel: "Filtrar por proveedor", prop: "supplierOptions" },
] as const

function optionFor(props: ServerListFiltersProps, key: typeof selectOptions[number]["prop"]): ServerListFilterOption[] | undefined {
  return props[key]
}

function buildChip(key: string, label: string, value: string, displayValue: string): ActiveFilterChip {
  return { key, label, value, displayValue }
}

const ServerListFiltersInner = React.memo(function ServerListFiltersInner({
  searchPlaceholder = "Buscar por código...",
  statusOptions,
  urgencyOptions,
  worksiteOptions,
  supplierOptions,
  exportTipo,
  actions,
}: ServerListFiltersProps) {
  const pathname = usePathname()
  const { searchParams, setFilter, setFilters } = useUrlFilters({
    debounceMs: 350,
    resetPageKeys: ["page", "pendientes"],
  })
  const currentQ = searchParams.get("q") ?? ""
  const [q, setQ] = React.useState(currentQ)
  const [lastSyncedQ, setLastSyncedQ] = React.useState(currentQ)

  if (lastSyncedQ !== currentQ) {
    setLastSyncedQ(currentQ)
    setQ(currentQ)
  }

  React.useEffect(() => {
    if (q === currentQ) return
    const id = setTimeout(() => setFilter("q", q.trim()), 350)
    return () => clearTimeout(id)
  }, [q, currentQ, setFilter])

  const activeChips = React.useMemo(() => {
    const factura = searchParams.get("factura")
    const solicitud = searchParams.get("solicitud")
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")
    const chips: ActiveFilterChip[] = []
    if (factura) chips.push(buildChip("factura", "Factura", factura, factura === "pendiente" ? "Sin factura" : factura))
    if (solicitud) chips.push(buildChip("solicitud", "Solicitud", solicitud, "Sólo una solicitud"))
    if (desde || hasta) chips.push(buildChip("periodo", "Período", `${desde ?? ""}|${hasta ?? ""}`, `${desde || "…"} → ${hasta || "…"}`))
    return chips
  }, [searchParams])

  const clearAll = React.useCallback(() => {
    setFilters(Object.fromEntries(SERVER_LIST_FILTER_PARAMS.map((key) => [key, null])))
  }, [setFilters])

  const removeChip = React.useCallback((key: string) => {
    if (key === "periodo") {
      setFilters({ desde: null, hasta: null })
    } else {
      setFilter(key, null)
    }
  }, [setFilter, setFilters])

  const exportHref = React.useMemo(() => {
    if (!exportTipo) return undefined
    const params = new URLSearchParams({ tipo: exportTipo })
    const qValue = searchParams.get("q")
    const estado = searchParams.get("estado")
    const faena = searchParams.get("faena")
    const proveedor = searchParams.get("proveedor")
    if (qValue) params.set("q", qValue)
    if (estado) params.set("status", estado)
    if (faena) params.set("faena", faena)
    if (proveedor) params.set("proveedor", proveedor)
    return `/api/reportes/export?${params.toString()}`
  }, [exportTipo, searchParams])

  const toolbarActions = (
    <>
      <SavedViews scopeKey={pathname} />
      {exportHref && (
        <a
          href={exportHref}
          download
          className="inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-text)] shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--color-border-control-hover)] hover:bg-[var(--color-surface-2)] sm:h-8"
        >
          <DownloadSimple size={13} aria-hidden />
          Exportar Excel
        </a>
      )}
      {actions}
    </>
  )

  const hasActiveFilters = hasServerListFilters(searchParams)

  return (
    <FilterToolbar
      hasActiveFilters={hasActiveFilters}
      activeChips={activeChips}
      onRemoveChip={removeChip}
      onClearAll={clearAll}
      actions={toolbarActions}
    >
      <div className="relative flex w-full items-center sm:w-auto">
        <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 shrink-0 text-[var(--color-text-subtle)]" aria-hidden />
        <Input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Buscar"
          className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-64"
        />
      </div>

      {selectOptions.map(({ key, allLabel, ariaLabel, prop }) => {
        const options = optionFor({ statusOptions, urgencyOptions, worksiteOptions, supplierOptions }, prop)
        if (!options?.length) return null
        const current = searchParams.get(key) ?? ""
        return (
          <Select key={key} value={current || ALL} onValueChange={(value) => setFilter(key, value)}>
            <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[10rem]" aria-label={ariaLabel}>
              <SelectValue placeholder={allLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{allLabel}</SelectItem>
              {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )
      })}

      {hasActiveFilters && (
        <span className="sr-only" aria-live="polite">
          Hay filtros activos
        </span>
      )}
    </FilterToolbar>
  )
})

export const ServerListFilters = ServerListFiltersInner
