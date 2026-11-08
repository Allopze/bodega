"use client"

import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import * as React from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IT_ASSET_STATUS_META } from "@/lib/services/ti/constants"

const ALL = "_all"

interface AssetFiltersProps {
  types: { id: string; name: string; category: string }[]
  workers: { id: string; name: string; lastName: string }[]
  worksites: { id: string; name: string }[]
  suppliers: { id: string; name: string }[]
  current: Record<string, string | string[] | undefined>
}

const WARRANTY_OPTIONS = [
  { value: "active", label: "Garantía vigente" },
  { value: "expiring_30", label: "Vence en 30 días" },
  { value: "expiring_60", label: "Vence en 60 días" },
  { value: "expiring_90", label: "Vence en 90 días" },
  { value: "expired", label: "Garantía vencida" },
  { value: "none", label: "Sin garantía" },
]

const AGE_OPTIONS = [
  { value: "3", label: "Hasta 3 años" },
  { value: "5", label: "Hasta 5 años" },
  { value: "10", label: "Hasta 10 años" },
]

/** "Qué conviene reemplazar": el filtro que faltaba para el parque antiguo. */
const MIN_AGE_OPTIONS = [
  { value: "3", label: "3 años o más" },
  { value: "5", label: "5 años o más" },
  { value: "8", label: "8 años o más" },
]

/** El inventario pagina en el servidor: el orden viaja en la URL, no en la tabla. */
const ORDER_OPTIONS = [
  { value: "codigo", label: "Código A-Z" },
  { value: "codigo_desc", label: "Código Z-A" },
  { value: "activo", label: "Marca y modelo" },
  { value: "faena", label: "Faena" },
  { value: "estado", label: "Estado" },
  { value: "asignado", label: "Asignado a" },
  { value: "tipo", label: "Tipo" },
  { value: "garantia", label: "Garantía más próxima" },
  { value: "mantenciones", label: "Más mantenciones" },
  { value: "costo", label: "Mayor costo" },
  { value: "reciente", label: "Más recientes" },
]

function workerLabel(w: { name: string; lastName: string }) {
  return `${w.name} ${w.lastName}`.trim()
}

function SelectFilter({ value, onValue, allLabel, ariaLabel, options }: {
  value: string
  onValue: (v: string) => void
  allLabel: string
  ariaLabel: string
  options: { value: string; label: string }[]
}) {
  return (
    <Select value={value || ALL} onValueChange={onValue}>
      <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[9rem]" aria-label={ariaLabel}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

export function AssetFilters({ types, workers, worksites, suppliers, current }: AssetFiltersProps) {
  useWorksiteFilterPresence()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string | null) {
    // URL viva, no el `current` del render del servidor: si el usuario escribe
    // en el buscador y cambia un select antes del rebote de 350 ms, `current`
    // todavía no tiene `q` y lo borraría.
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== ALL) params.set(key, value)
    else params.delete(key)
    // Cambiar un filtro cambia el conjunto: la página anterior ya no existe.
    params.delete("pagina")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // Limpiar filtros no debe borrar la vista de la tabla (columnas y orden).
  function clearFilters() {
    const params = new URLSearchParams()
    for (const key of ["ti-activos_cols", "ti-activos_sort", "ti-activos_dir", "orden"]) {
      const value = searchParams.get(key)
      if (value) params.set(key, value)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const overflowKeys = ["trabajador", "proveedor", "garantia", "antiguedad", "antiguedad_min"] as const
  const activeCount = overflowKeys.filter((key) => typeof current[key] === "string" && current[key]).length

  // Los filtros primarios viven inline en `sm+`; en móvil se pliegan en el
  // mismo Sheet de «Más filtros» para que la tabla no quede bajo cinco filas
  // de controles (regla A2: el muro se pliega, no se apila).
  const primaryFilters = (
    <>
      <SelectFilter
        value={String(current.tipo ?? "")}
        onValue={(v) => setParam("tipo", v)}
        allLabel="Todos los tipos"
        ariaLabel="Filtrar por tipo"
        options={types.map((t) => ({ value: t.id, label: t.name }))}
      />
      <SelectFilter
        value={String(current.estado ?? "")}
        onValue={(v) => setParam("estado", v)}
        allLabel="Todos los estados"
        ariaLabel="Filtrar por estado"
        options={Object.entries(IT_ASSET_STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))}
      />
      <SelectFilter
        value={String(current.faena ?? "")}
        onValue={(v) => setParam("faena", v)}
        allLabel="Todas las faenas"
        ariaLabel="Filtrar por faena"
        options={worksites.map((w) => ({ value: w.id, label: w.name }))}
      />
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-[var(--color-text-muted)]">Ordenar</span>
        <SelectFilter
          value={String(current.orden ?? "")}
          onValue={(v) => setParam("orden", v === "codigo" ? null : v)}
          allLabel="Código A-Z"
          ariaLabel="Ordenar el inventario"
          options={ORDER_OPTIONS}
        />
      </div>
    </>
  )

  const overflowFilters = (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex flex-col gap-3 sm:hidden">
        {primaryFilters}
      </div>
      <SelectFilter
        value={String(current.trabajador ?? "")}
        onValue={(v) => setParam("trabajador", v)}
        allLabel="Todos los trabajadores"
        ariaLabel="Filtrar por trabajador"
        options={workers.map((w) => ({ value: w.id, label: workerLabel(w) }))}
      />
      <SelectFilter
        value={String(current.proveedor ?? "")}
        onValue={(v) => setParam("proveedor", v)}
        allLabel="Todos los proveedores"
        ariaLabel="Filtrar por proveedor"
        options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
      />
      <SelectFilter
        value={String(current.garantia ?? "")}
        onValue={(v) => setParam("garantia", v)}
        allLabel="Toda garantía"
        ariaLabel="Filtrar por garantía"
        options={WARRANTY_OPTIONS}
      />
      <SelectFilter
        value={String(current.antiguedad ?? "")}
        onValue={(v) => setParam("antiguedad", v)}
        allLabel="Toda antigüedad"
        ariaLabel="Filtrar por antigüedad máxima"
        options={AGE_OPTIONS}
      />
      <SelectFilter
        value={String(current.antiguedad_min ?? "")}
        onValue={(v) => setParam("antiguedad_min", v)}
        allLabel="Cualquier antigüedad mínima"
        ariaLabel="Filtrar por antigüedad mínima"
        options={MIN_AGE_OPTIONS}
      />
    </div>
  )

  // Chips removibles de TODOS los filtros activos (A2). Antes solo cubrían los
  // cinco plegados: con tipo/estado/faena aplicados no se veía ninguno y el
  // badge de «Más filtros» decía 0 porque cuenta solo ese panel.
  const chips: ActiveFilterChip[] = [
    typeof current.q === "string" && current.q
      ? { key: "q", label: "Búsqueda", value: current.q, displayValue: current.q } : null,
    current.reparacion === "demorada"
      ? { key: "reparacion", label: "Reparación", value: "demorada", displayValue: "Demorada (+14 días)" } : null,
    typeof current.orden === "string" && current.orden && current.orden !== "codigo"
      ? { key: "orden", label: "Orden", value: current.orden, displayValue: ORDER_OPTIONS.find((o) => o.value === current.orden)?.label ?? current.orden } : null,
    typeof current.tipo === "string" && current.tipo
      ? { key: "tipo", label: "Tipo", value: current.tipo, displayValue: types.find((t) => t.id === current.tipo)?.name ?? "—" } : null,
    typeof current.estado === "string" && current.estado
      ? { key: "estado", label: "Estado", value: current.estado, displayValue: IT_ASSET_STATUS_META[current.estado]?.label ?? current.estado } : null,
    typeof current.faena === "string" && current.faena
      ? { key: "faena", label: "Faena", value: current.faena, displayValue: worksites.find((w) => w.id === current.faena)?.name ?? "—" } : null,
    typeof current.trabajador === "string" && current.trabajador
      ? { key: "trabajador", label: "Trabajador", value: current.trabajador, displayValue: workerLabel(workers.find((w) => w.id === current.trabajador) ?? { name: "—", lastName: "" }) } : null,
    typeof current.proveedor === "string" && current.proveedor
      ? { key: "proveedor", label: "Proveedor", value: current.proveedor, displayValue: suppliers.find((s) => s.id === current.proveedor)?.name ?? "—" } : null,
    typeof current.garantia === "string" && current.garantia
      ? { key: "garantia", label: "Garantía", value: current.garantia, displayValue: WARRANTY_OPTIONS.find((o) => o.value === current.garantia)?.label ?? "Garantía" } : null,
    typeof current.antiguedad === "string" && current.antiguedad
      ? { key: "antiguedad", label: "Antigüedad máxima", value: current.antiguedad, displayValue: AGE_OPTIONS.find((o) => o.value === current.antiguedad)?.label ?? `Hasta ${current.antiguedad} años` } : null,
    typeof current.antiguedad_min === "string" && current.antiguedad_min
      ? { key: "antiguedad_min", label: "Antigüedad mínima", value: current.antiguedad_min, displayValue: MIN_AGE_OPTIONS.find((o) => o.value === current.antiguedad_min)?.label ?? `${current.antiguedad_min} años o más` } : null,
  ].filter((c): c is ActiveFilterChip => c !== null)

  return (
    <FilterToolbar
      overflowFilters={overflowFilters}
      activeChips={chips}
      onRemoveChip={(key) => setParam(key, null)}
      activeCount={activeCount}
      onClearAll={clearFilters}
    >
      <FilterSearchInput
        param="q"
        pageKeys={["pagina"]}
        placeholder="Buscar código, marca, serie o persona..."
        ariaLabel="Buscar activos"
      />
      {/* En móvil estos filtros viven en el Sheet de «Más filtros». */}
      <div className="hidden flex-wrap items-center gap-2.5 sm:flex">
        {primaryFilters}
      </div>
    </FilterToolbar>
  )
}
