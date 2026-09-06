"use client"

import * as React from "react"
import {
  MagnifyingGlass,
  DownloadSimple,
  SlidersHorizontal,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { COMPUTED_STATUS_METAS, type ComputedStatus } from "@/lib/services/trazabilidad-consolidated.types"
import { ConsolidatedFiltersAdvanced } from "./consolidated-filters-advanced"

interface CurrentFilters {
  faena: string
  estado: string
  categoria: string
  solicitante: string
  proveedor: string
  q: string
  desde: string
  hasta: string
  pendientes: boolean
  ocPendiente: boolean
}

interface Props {
  worksites: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string }>
  requesters: Array<{ id: string; name: string }>
  suppliers: Array<{ id: string; name: string }>
  current: CurrentFilters
}

/**
 * El Excel tiene que traer lo que el usuario está mirando.
 *
 * Antes sólo viajaban faena y fechas: con un filtro de estado o una búsqueda
 * aplicados, el archivo descargaba otro universo de filas que el de la tabla.
 */
function buildExportUrl(current: CurrentFilters): string {
  const params = new URLSearchParams()
  if (current.faena) params.set("faena", current.faena)
  if (current.estado) params.set("estado", current.estado)
  if (current.categoria) params.set("categoria", current.categoria)
  if (current.solicitante) params.set("solicitante", current.solicitante)
  if (current.proveedor) params.set("proveedor", current.proveedor)
  if (current.q) params.set("q", current.q)
  if (current.desde) params.set("desde", current.desde)
  if (current.hasta) params.set("hasta", current.hasta)
  if (current.pendientes) params.set("pendientes", "true")
  if (current.ocPendiente) params.set("oc_pendiente", "true")
  const query = params.toString()
  return query
    ? `/api/bodega/trazabilidad/export?${query}`
    : "/api/bodega/trazabilidad/export"
}

export function ConsolidatedFilters({
  worksites,
  categories,
  requesters,
  suppliers,
  current,
}: Props) {
  const { setFilter, setFilters, clearFilters } = useUrlFilters()
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [searchValue, setSearchValue] = React.useState(current.q)

  React.useEffect(() => {
    setSearchValue(current.q)
  }, [current.q])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFilter("q", searchValue.trim())
  }

  /**
   * Chips de los filtros activos. La faena no lleva chip a propósito: su
   * selector está al lado mostrando cuál es, y la X del chip no podía
   * quitarla —la vista siempre necesita una faena y el servicio volvía a
   * poner la de por defecto—, así que era un botón que no hacía nada.
   */
  const chips: ActiveFilterChip[] = []

  if (current.estado) {
    const label = COMPUTED_STATUS_METAS[current.estado as ComputedStatus]?.label ?? current.estado
    chips.push({ key: "estado", label: "Estado", value: current.estado, displayValue: label })
  }
  if (current.categoria) {
    const catName = categories.find((c) => c.id === current.categoria)?.name ?? current.categoria
    chips.push({ key: "categoria", label: "Categoría", value: current.categoria, displayValue: catName })
  }
  if (current.solicitante) {
    const reqName = requesters.find((r) => r.id === current.solicitante)?.name ?? current.solicitante
    chips.push({ key: "solicitante", label: "Solicitante", value: current.solicitante, displayValue: reqName })
  }
  if (current.proveedor) {
    const supName = suppliers.find((s) => s.id === current.proveedor)?.name ?? current.proveedor
    chips.push({ key: "proveedor", label: "Proveedor", value: current.proveedor, displayValue: supName })
  }
  if (current.pendientes) {
    chips.push({ key: "pendientes", label: "Filtro", value: "true", displayValue: "Solo pendientes" })
  }
  // TR-F1: chip del filtro por OC con saldo por recibir (coherente con el KPI
  // "Esperando proveedor").
  if (current.ocPendiente) {
    chips.push({ key: "oc_pendiente", label: "OC", value: "true", displayValue: "OC pendiente de recepción" })
  }
  if (current.q) {
    chips.push({ key: "q", label: "Búsqueda", value: current.q, displayValue: `"${current.q}"` })
  }
  if (current.desde) {
    chips.push({ key: "desde", label: "Desde", value: current.desde, displayValue: current.desde })
  }
  if (current.hasta) {
    chips.push({ key: "hasta", label: "Hasta", value: current.hasta, displayValue: current.hasta })
  }

  return (
    <div className="mb-4">
      <FilterToolbar
        activeChips={chips}
        onRemoveChip={(key) => {
          if (key === "q") setSearchValue("")
          setFilter(key, "")
        }}
        onClearAll={() => {
          setSearchValue("")
          // La faena sobrevive al "limpiar": es el eje de la vista, no un filtro.
          clearFilters(["faena"])
        }}
        hasActiveFilters={chips.length > 0}
        actions={
          <Button asChild variant="secondary" size="sm" className="gap-1.5 shrink-0">
            <a
              href={buildExportUrl(current)}
              download
              aria-label="Exportar a Excel la trazabilidad con los filtros aplicados"
            >
              <DownloadSimple size={14} weight="bold" />
              Exportar Excel
            </a>
          </Button>
        }
      >
        {/* Selector principal de Faena */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="filter-faena-select" className="text-xs font-semibold text-[var(--color-text)] whitespace-nowrap">
            Faena:
          </label>
          <Select
            value={current.faena}
            onValueChange={(val) => setFilter("faena", val)}
          >
            <SelectTrigger id="filter-faena-select" className="w-56 font-semibold" aria-label="Seleccionar faena">
              <SelectValue placeholder="Seleccionar faena" />
            </SelectTrigger>
            <SelectContent>
              {worksites.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Búsqueda textual */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-1.5">
          <div className="relative w-64 sm:w-72">
            <MagnifyingGlass
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)] pointer-events-none"
            />
            <Input
              type="search"
              placeholder="Buscar por código, ítem, OC..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="pl-8 text-xs h-9"
              aria-label="Buscar en trazabilidad"
            />
          </div>
          {searchValue !== current.q && (
            <Button type="submit" size="sm" variant="secondary" className="h-9 text-xs">
              Buscar
            </Button>
          )}
        </form>

        {/* Selector de Estado */}
        <Select
          value={current.estado || "_all"}
          onValueChange={(val) => setFilter("estado", val === "_all" ? "" : val)}
        >
          <SelectTrigger className="w-48 text-xs h-9" aria-label="Filtrar por estado">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Todos los estados</SelectItem>
            {Object.entries(COMPUTED_STATUS_METAS).map(([key, meta]) => (
              <SelectItem key={key} value={key}>
                {meta.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Botón Filtros avanzados (Sheet) */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setSheetOpen(true)}
          className="gap-1.5 h-9 text-xs"
        >
          <SlidersHorizontal size={14} />
          Más filtros
        </Button>
      </FilterToolbar>

      {/* Drawer lateral de filtros avanzados */}
      <ConsolidatedFiltersAdvanced
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        categories={categories}
        requesters={requesters}
        suppliers={suppliers}
        current={current}
        setFilters={setFilters}
      />
    </div>
  )
}
