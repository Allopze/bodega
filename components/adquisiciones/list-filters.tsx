"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { DownloadSimple, MagnifyingGlass, X } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

export interface FilterOption {
  value: string
  label: string
}

interface ListFiltersProps {
  /** Placeholder for the free-text search input. */
  searchPlaceholder?: string
  /** When provided, renders the status (estado) select. */
  statusOptions?: FilterOption[]
  /** When provided, renders the urgency (urgencia) select. */
  urgencyOptions?: FilterOption[]
  /** When provided, renders the worksite (faena) select. */
  worksiteOptions?: FilterOption[]
  /** When provided, renders the supplier (proveedor) select. */
  supplierOptions?: FilterOption[]
  /** When provided, renders an "Exportar Excel" button that respects the
   *  active filters. Value is the export `tipo` (e.g. "solicitudes"). */
  exportTipo?: string
  /** Right-aligned slot for primary actions (e.g. "Nueva"). */
  actions?: React.ReactNode
}

const ALL = "_all"
const DEBOUNCE_MS = 350

function createSelectHandler(setParam: (key: string, value: string) => void, key: string) {
  return (value: string) => setParam(key, value === ALL ? "" : value)
}

/**
 * URL-synced filter bar for the Adquisiciones list screens. Writes `q`,
 * `estado` and `faena` to the URL (resetting `page`) so the server query
 * applies the filters. The free-text input is debounced; selects update
 * immediately.
 */
const ListFiltersInner = React.memo(function ListFiltersInner({
  searchPlaceholder = "Buscar por código...",
  statusOptions,
  urgencyOptions,
  worksiteOptions,
  supplierOptions,
  exportTipo,
  actions,
}: ListFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentQ = searchParams.get("q") ?? ""
  const currentEstado = searchParams.get("estado") ?? ""
  const currentUrgencia = searchParams.get("urgencia") ?? ""
  const currentFaena = searchParams.get("faena") ?? ""
  const currentProveedor = searchParams.get("proveedor") ?? ""

  const [q, setQ] = React.useState(currentQ)

  // Keep local input in sync if the URL changes externally (e.g. "Limpiar").
  // Adjusting during render (rather than in an effect) means React re-runs this
  // component before committing, so the stale query never reaches the screen.
  const [lastSyncedQ, setLastSyncedQ] = React.useState(currentQ)
  if (lastSyncedQ !== currentQ) {
    setLastSyncedQ(currentQ)
    setQ(currentQ)
  }

  const setParam = React.useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()))
      if (value) params.set(key, value)
      else params.delete(key)
      params.delete("page") // any filter change returns to the first page
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  // Debounce the free-text query into the URL.
  React.useEffect(() => {
    if (q === currentQ) return
    const id = setTimeout(() => setParam("q", q.trim()), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [q, currentQ, setParam])

  const handleEstadoChange = React.useMemo(() => createSelectHandler(setParam, "estado"), [setParam])
  const handleUrgenciaChange = React.useMemo(() => createSelectHandler(setParam, "urgencia"), [setParam])
  const handleFaenaChange = React.useMemo(() => createSelectHandler(setParam, "faena"), [setParam])
  const handleProveedorChange = React.useMemo(() => createSelectHandler(setParam, "proveedor"), [setParam])

  const hasActiveFilters = Boolean(currentQ || currentEstado || currentUrgencia || currentFaena || currentProveedor)

  // Export URL respects the active filters (estado→status, q/faena/proveedor passthrough).
  const exportHref = React.useMemo(() => {
    if (!exportTipo) return null
    const params = new URLSearchParams({ tipo: exportTipo })
    if (currentQ) params.set("q", currentQ)
    if (currentEstado) params.set("status", currentEstado)
    if (currentFaena) params.set("faena", currentFaena)
    if (currentProveedor) params.set("proveedor", currentProveedor)
    return `/api/reportes/export?${params.toString()}`
  }, [exportTipo, currentQ, currentEstado, currentFaena, currentProveedor])

  function clearAll() {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    params.delete("q")
    params.delete("estado")
    params.delete("urgencia")
    params.delete("faena")
    params.delete("proveedor")
    params.delete("page")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center">
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute left-2.5 shrink-0 text-[var(--color-text-subtle)]"
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Buscar"
            className="h-8 w-48 pl-8 text-xs sm:w-64"
          />
        </div>

        {statusOptions && statusOptions.length > 0 && (
          <Select
            value={currentEstado || ALL}
            onValueChange={handleEstadoChange}
          >
            <SelectTrigger className="h-8 w-auto min-w-[10rem] text-xs" aria-label="Filtrar por estado">
              <SelectValue placeholder="Todos los estados" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los estados</SelectItem>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {urgencyOptions && urgencyOptions.length > 0 && (
          <Select
            value={currentUrgencia || ALL}
            onValueChange={handleUrgenciaChange}
          >
            <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs" aria-label="Filtrar por urgencia">
              <SelectValue placeholder="Toda urgencia" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Toda urgencia</SelectItem>
              {urgencyOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {worksiteOptions && worksiteOptions.length > 0 && (
          <Select
            value={currentFaena || ALL}
            onValueChange={handleFaenaChange}
          >
            <SelectTrigger className="h-8 w-auto min-w-[10rem] text-xs" aria-label="Filtrar por faena">
              <SelectValue placeholder="Todas las faenas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las faenas</SelectItem>
              {worksiteOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {supplierOptions && supplierOptions.length > 0 && (
          <Select
            value={currentProveedor || ALL}
            onValueChange={handleProveedorChange}
          >
            <SelectTrigger className="h-8 w-auto min-w-[10rem] text-xs" aria-label="Filtrar por proveedor">
              <SelectValue placeholder="Todos los proveedores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los proveedores</SelectItem>
              {supplierOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-8 items-center gap-1 rounded-[var(--radius)] px-2 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-colors"
          >
            <X size={12} weight="bold" />
            Limpiar
          </button>
        )}
      </div>

      {(exportHref || actions) && (
        <div className="flex flex-wrap items-center gap-2">
          {exportHref && (
            <a
              href={exportHref}
              download
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
            >
              <DownloadSimple size={13} />
              Exportar Excel
            </a>
          )}
          {actions}
        </div>
      )}
    </div>
  )
})

export const ListFilters = ListFiltersInner
