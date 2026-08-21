"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { OptionSelect } from "@/components/ui/option-select"
import { DatePicker } from "@/components/ui/date-picker"
import { formatDate } from "@/lib/utils"
import { MOVEMENT_TYPE_LABELS } from "./movement-labels"
import { ALL_WORKSITES } from "./faena-scope"
import type { BodegaView } from "./bodega-view-tabs"

export interface BodegaFiltersProps {
  view: BodegaView
  worksites: Array<{ id: string; name: string }>
  products?: Array<{ id: string; name: string }>
  /** Bodega propia del usuario: la faena en que arranca la pantalla. */
  ownWorksiteId?: string
  current: {
    q?: string
    /** Faena efectiva ya resuelta: `""` significa todas las visibles. */
    faena?: string
    stock?: string
    tipo?: string
    producto?: string
    desde?: string
    hasta?: string
  }
}

const STOCK_STATE_OPTIONS = [
  { value: "low", label: "Bajo el mínimo" },
  { value: "warn", label: "Por agotarse" },
]

const TYPE_OPTIONS = Object.entries(MOVEMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))

/** Parámetros que sólo tienen sentido en una vista: "Limpiar" y el cambio de
 *  vista los borran para que ninguna pantalla quede filtrada por un control que
 *  no está en ella. */
const VIEW_PARAMS = ["stock", "tipo", "producto", "desde", "hasta", "page", "kardex_page"]

/**
 * Filtros de Bodega, sincronizados con la URL y aplicados en el servidor.
 *
 * Antes el filtrado era en memoria sobre lo ya cargado: en el kardex, que está
 * paginado en el servidor, buscar sólo miraba la página en pantalla.
 */
export function BodegaFilters({ view, worksites, products = [], ownWorksiteId = "", current }: BodegaFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete("page")
    params.delete("kardex_page")
    const qs = params.toString()
    router.replace(qs ? `/bodega?${qs}` : "/bodega", { scroll: false })
  }

  function clearAll() {
    const params = new URLSearchParams()
    const vista = searchParams.get("vista")
    if (vista) params.set("vista", vista)
    const qs = params.toString()
    router.replace(qs ? `/bodega?${qs}` : "/bodega", { scroll: false })
  }

  const chips: ActiveFilterChip[] = []
  if (current.q) {
    chips.push({ key: "q", label: "Búsqueda", value: current.q, displayValue: current.q })
  }
  // El chip de faena anuncia haberse salido de la bodega propia, y quitarlo
  // vuelve a ella. Estando en la bodega propia no hay nada que anunciar: el
  // selector ya dice cuál se está mirando.
  const faena = current.faena ?? ""
  if (faena !== ownWorksiteId) {
    const worksite = worksites.find((item) => item.id === faena)
    if (worksite) chips.push({ key: "faena", label: "Faena", value: worksite.id, displayValue: worksite.name })
    else if (!faena && ownWorksiteId) {
      chips.push({ key: "faena", label: "Faena", value: ALL_WORKSITES, displayValue: "Todas las faenas" })
    }
  }
  if (view === "stock" && current.stock) {
    const option = STOCK_STATE_OPTIONS.find((item) => item.value === current.stock)
    if (option) chips.push({ key: "stock", label: "Estado", value: current.stock, displayValue: option.label })
  }
  if (view === "kardex") {
    if (current.tipo) {
      chips.push({
        key: "tipo",
        label: "Tipo",
        value: current.tipo,
        displayValue: MOVEMENT_TYPE_LABELS[current.tipo] ?? current.tipo,
      })
    }
    if (current.producto) {
      const product = products.find((item) => item.id === current.producto)
      chips.push({
        key: "producto",
        label: "Producto",
        value: current.producto,
        displayValue: product?.name ?? current.producto,
      })
    }
    if (current.desde) {
      chips.push({ key: "desde", label: "Desde", value: current.desde, displayValue: formatDate(current.desde) })
    }
    if (current.hasta) {
      chips.push({ key: "hasta", label: "Hasta", value: current.hasta, displayValue: formatDate(current.hasta) })
    }
  }

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setFilter(key, "")}
      onClearAll={clearAll}
      hasActiveFilters={chips.length > 0}
    >
      <FilterSearchInput
        param="q"
        pageKeys={VIEW_PARAMS.filter((key) => key === "page" || key === "kardex_page")}
        placeholder={view === "kardex" ? "Buscar movimiento..." : "Buscar producto o SKU..."}
        ariaLabel="Buscar en bodega"
      />

      <OptionSelect
        aria-label="Filtrar por faena"
        className="h-11 w-full text-xs sm:h-8 sm:w-52"
        emptyLabel="Todas las faenas"
        options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))}
        value={faena}
        // "Todas" viaja explícito en la URL: sin el centinela, borrar el
        // parámetro devolvería a la bodega propia y no habría cómo ver el resto.
        onValueChange={(value) => setFilter("faena", value || (ownWorksiteId ? ALL_WORKSITES : ""))}
      />

      {view === "stock" && (
        <OptionSelect
          aria-label="Filtrar por estado de stock"
          className="h-11 w-full text-xs sm:h-8 sm:w-44"
          emptyLabel="Todo el stock"
          options={STOCK_STATE_OPTIONS}
          value={current.stock ?? ""}
          onValueChange={(value) => setFilter("stock", value)}
        />
      )}

      {view === "kardex" && (
        <>
          <OptionSelect
            aria-label="Filtrar por tipo de movimiento"
            className="h-11 w-full text-xs sm:h-8 sm:w-48"
            emptyLabel="Todos los tipos"
            options={TYPE_OPTIONS}
            value={current.tipo ?? ""}
            onValueChange={(value) => setFilter("tipo", value)}
          />
          {products.length > 0 && (
            <OptionSelect
              aria-label="Filtrar por producto"
              className="h-11 w-full text-xs sm:h-8 sm:w-52"
              emptyLabel="Todos los productos"
              options={products.map((product) => ({ value: product.id, label: product.name }))}
              value={current.producto ?? ""}
              onValueChange={(value) => setFilter("producto", value)}
            />
          )}
          <DatePicker
            ariaLabel="Movimientos desde"
            placeholder="Desde"
            className="h-11 w-full text-xs sm:h-8 sm:w-36"
            value={current.desde ?? ""}
            onChange={(iso) => setFilter("desde", iso)}
          />
          <DatePicker
            ariaLabel="Movimientos hasta"
            placeholder="Hasta"
            className="h-11 w-full text-xs sm:h-8 sm:w-36"
            value={current.hasta ?? ""}
            onChange={(iso) => setFilter("hasta", iso)}
          />
        </>
      )}
    </FilterToolbar>
  )
}
