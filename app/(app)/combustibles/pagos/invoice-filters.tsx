"use client"

import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Label } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { WorksiteSelect } from "@/components/ui/worksite-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { FUEL_LOAD_STATUS_LABELS } from "@/lib/combustibles/labels"
import { INVOICE_FILTER_KEYS, SERVICE_TYPE_LABELS, type InvoiceListParams } from "./invoice-params"

interface InvoiceFiltersProps {
  equipment: ComboboxOption[]
  suppliers: Array<{ id: string; name: string }>
  worksites: Array<{ id: string; name: string }>
  products: Array<{ id: string; name: string }>
  current: InvoiceListParams
}

/** La página vuelve a la 1 al cambiar cualquier filtro, incluida la clave que traían las URL antiguas. */
const RESET_PAGE_KEYS = ["pagina", "page"]
/** Parámetros de antes del rediseño: se limpian al filtrar para que no queden dos valores del mismo filtro. */
const LEGACY_KEYS = { equipo: "vehicle", estado: "status", servicio: "service" } as const

/**
 * Filtros de «Pagos › Facturas». El período vive en la cabecera. Aquí: el
 * buscador y tres filtros de uso diario (faena, equipo, estado) a la vista, y
 * servicio, proveedor y producto tras «Más filtros (N)». Cada filtro activo
 * tiene su chip removible.
 */
export function InvoiceFilters({ equipment, suppliers, worksites, products, current }: InvoiceFiltersProps) {
  useWorksiteFilterPresence(worksites.length > 1)
  const { setFilter, setFilters } = useUrlFilters({ resetPageKeys: RESET_PAGE_KEYS })

  /** Escribe el parámetro nuevo y borra su nombre antiguo, si la URL todavía lo traía. */
  function setNamed(key: keyof typeof LEGACY_KEYS | "faena" | "proveedor", value: string) {
    const legacy = (LEGACY_KEYS as Record<string, string>)[key]
    setFilters({ [key]: value || null, ...(legacy ? { [legacy]: null } : {}) })
  }

  function setProduct(value: string) {
    if (value.startsWith("legacy:")) setFilters({ producto: value.slice("legacy:".length), productoId: null })
    else setFilters({ producto: null, productoId: value || null })
  }

  const supplier = suppliers.find((s) => s.id === current.proveedor)
  const product = products.find((p) => p.id === current.productoId)
  const productValue = current.productoId || (current.producto ? `legacy:${current.producto}` : "")

  const chips: ActiveFilterChip[] = []
  const worksite = worksites.find((w) => w.id === current.faena)
  if (current.faena && worksite) chips.push({ key: "faena", label: "Faena", value: current.faena, displayValue: worksite.name })
  const vehicle = equipment.find((e) => e.value === current.equipo)
  if (current.equipo && vehicle) chips.push({ key: "equipo", label: "Equipo", value: current.equipo, displayValue: vehicle.label })
  if (current.estado) chips.push({ key: "estado", label: "Estado", value: current.estado, displayValue: FUEL_LOAD_STATUS_LABELS[current.estado]?.label ?? current.estado })
  if (current.servicio) chips.push({ key: "servicio", label: "Tarjeta", value: current.servicio, displayValue: SERVICE_TYPE_LABELS[current.servicio] ?? current.servicio })
  if (current.proveedor && supplier) chips.push({ key: "proveedor", label: "Proveedor", value: current.proveedor, displayValue: supplier.name })
  if (productValue) chips.push({ key: "producto", label: "Producto", value: productValue, displayValue: product?.name ?? current.producto })

  const secondaryActive = [current.servicio, current.proveedor, productValue].filter(Boolean).length

  function removeChip(key: string) {
    if (key === "producto") setFilters({ producto: null, productoId: null })
    else if (key === "equipo" || key === "estado" || key === "servicio" || key === "faena" || key === "proveedor") setNamed(key, "")
  }

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={removeChip}
      onClearAll={() => setFilters({ ...Object.fromEntries([...INVOICE_FILTER_KEYS, ...Object.values(LEGACY_KEYS)].map((key) => [key, null])), q: null })}
      hasActiveFilters={chips.length > 0 || current.q !== ""}
      activeCount={secondaryActive}
      overflowTitle="Más filtros de facturas"
      overflowDescription="Tipo de tarjeta, proveedor y producto."
      overflowFilters={
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs" id="inv-servicio">Tipo de tarjeta</Label>
            <OptionSelect
              value={current.servicio}
              onValueChange={(v) => setNamed("servicio", v)}
              emptyLabel="Todas"
              options={Object.entries(SERVICE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              aria-labelledby="inv-servicio"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs" id="inv-proveedor">Proveedor</Label>
            <OptionSelect
              value={current.proveedor}
              onValueChange={(v) => setNamed("proveedor", v)}
              emptyLabel="Todos los proveedores"
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              aria-labelledby="inv-proveedor"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs" id="inv-producto">Producto</Label>
            <OptionSelect
              value={productValue}
              onValueChange={setProduct}
              emptyLabel="Todos los productos"
              options={[
                ...(current.producto && !current.productoId ? [{ value: `legacy:${current.producto}`, label: `${current.producto} (histórico)` }] : []),
                ...products.map((p) => ({ value: p.id, label: p.name })),
              ]}
              aria-labelledby="inv-producto"
            />
          </div>
        </>
      }
    >
      <FilterSearchInput
        param="q"
        placeholder="Buscar factura, equipo o proveedor"
        ariaLabel="Buscar factura, equipo o proveedor"
        pageKeys={RESET_PAGE_KEYS}
      />
      {worksites.length > 1 && (
        <WorksiteSelect
          worksites={worksites}
          value={current.faena}
          onChange={(v) => setFilter("faena", v)}
          triggerClassName="h-11 w-full text-xs sm:h-8 sm:w-44"
        />
      )}
      <div className="w-full sm:w-56">
        <Combobox
          options={equipment}
          value={current.equipo}
          onChange={(v) => setNamed("equipo", v)}
          placeholder="Cualquier equipo"
          clearLabel="Cualquier equipo"
          aria-label="Filtrar por equipo"
        />
      </div>
      <OptionSelect
        value={current.estado}
        onValueChange={(v) => setNamed("estado", v)}
        emptyLabel="Cualquier estado"
        placeholder="Cualquier estado"
        options={Object.entries(FUEL_LOAD_STATUS_LABELS).map(([value, meta]) => ({ value, label: meta.label }))}
        aria-label="Filtrar por estado"
        className="h-11 w-full text-xs sm:h-8 sm:w-40"
      />
    </FilterToolbar>
  )
}
