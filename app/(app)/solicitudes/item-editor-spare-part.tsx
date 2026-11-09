"use client"

import * as React from "react"
import { Package } from "@phosphor-icons/react"
import { Field } from "@/components/ui/field"
import { searchSparePartsForRequestAction } from "./actions"
import { ProductPicker } from "./product-picker"
import { sparePartFacts, sparePartPickerOptions } from "./spare-part-options"
import type { ItemRow, SparePartOption, VehicleOption } from "./request-form.types"

interface Props {
  item: ItemRow
  /** Repuestos que el formulario ya conoce (los de la solicitud y los elegidos): la ficha del elegido. */
  spareParts: SparePartOption[]
  /** Equipos de flota: con el del ítem elegido, los repuestos que ya se compraron para él suben primero. */
  vehicles: VehicleOption[]
  onUpdate: (patch: Partial<ItemRow>) => void
  onSelectProduct: (productId: string) => void
  /** Repuesto elegido del buscador, con sus datos (viene del servidor, no de `spareParts`). */
  onSelectSparePart?: (part: SparePartOption) => void
  onClearProduct: () => void
}

/** Espera entre teclas antes de preguntarle al servidor. */
const SEARCH_DEBOUNCE_MS = 250

interface SearchResult {
  /** Búsqueda que respondió: texto y equipo. */
  key: string
  parts: SparePartOption[]
  error: string | null
}

/**
 * Las opciones del buscador vienen del servidor mientras se escribe: el catálogo
 * puede tener miles de repuestos y no viaja entero. Sin texto, la lista inicial
 * es lo comprado para el equipo del ítem o para uno de su modelo; sin texto ni
 * equipo no hay nada que preguntar.
 */
function useSparePartSearch(text: string, vehicleId: string, enabled: boolean) {
  const [debounced, setDebounced] = React.useState(text.trim())
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  const [result, setResult] = React.useState<SearchResult | null>(null)
  const key = `${debounced}|${vehicleId}`
  const idle = !enabled || (debounced === "" && vehicleId === "")
  React.useEffect(() => {
    if (idle) return
    let cancelled = false
    void searchSparePartsForRequestAction({ query: debounced, vehicleId: vehicleId || null })
      .then((data) => {
        if (cancelled) return
        setResult(data.ok
          ? { key, parts: data.parts, error: null }
          : { key, parts: [], error: data.message })
      })
      .catch(() => {
        if (!cancelled) setResult({ key, parts: [], error: "No se pudo buscar en el catálogo." })
      })
    return () => { cancelled = true }
  }, [idle, key, debounced, vehicleId])

  if (idle) return { parts: [] as SparePartOption[], error: null, loading: false }
  // Mientras llega la respuesta nueva se siguen viendo las anteriores.
  return { parts: result?.parts ?? [], error: result?.error ?? null, loading: result?.key !== key }
}

/**
 * Descripción de un ítem de repuestos: un buscador sobre el catálogo que a la
 * vez es el campo de texto libre. Quien pide algo que aún no está catalogado
 * simplemente lo escribe —Compras lo cataloga al armar la OC—; si está, lo elige
 * y el ítem queda atado al repuesto (nombre, SKU, N° de parte y marca de
 * lectura, y el último precio como estimado).
 */
export function ItemEditorSparePart({ item, spareParts, vehicles, onUpdate, onSelectProduct, onSelectSparePart, onClearProduct }: Props) {
  const part = item.productId ? spareParts.find((candidate) => candidate.id === item.productId) : undefined
  const search = useSparePartSearch(item.productNameFree, item.vehicleId, !item.productId)
  const options = React.useMemo(
    () => sparePartPickerOptions(search.parts, item.vehicleId, vehicles),
    [search.parts, item.vehicleId, vehicles],
  )
  function selectFromSearch(productId: string) {
    const chosen = search.parts.find((candidate) => candidate.id === productId)
    if (chosen && onSelectSparePart) onSelectSparePart(chosen)
    else onSelectProduct(productId)
  }
  const fieldId = `desc-${item._key}`

  // Elegir un repuesto desmonta el buscador y «Cambiar» lo vuelve a montar: sin
  // mover el foco, quien navega con teclado quedaría en el cuerpo de la página.
  // Sólo en el cambio, no al abrir un borrador que ya trae su repuesto.
  const cardRef = React.useRef<HTMLDivElement>(null)
  const previousProductId = React.useRef(item.productId)
  React.useEffect(() => {
    const before = previousProductId.current
    previousProductId.current = item.productId
    if (!before && item.productId) cardRef.current?.focus()
    else if (before && !item.productId) document.getElementById(fieldId)?.focus()
  }, [item.productId, fieldId])

  if (item.productId) {
    const name = part?.name ?? item.productName
    const facts = part ? sparePartFacts(part) : []
    return (
      <div
        ref={cardRef}
        tabIndex={-1}
        role="group"
        aria-label="Repuesto elegido"
        className="rounded-(--radius) border border-(--color-border) bg-(--color-surface-2) px-3 py-2 focus-visible:outline-2 focus-visible:outline-(--color-primary)"
      >
        <div className="flex items-center gap-2">
          <Package size={14} aria-hidden className="shrink-0 text-(--color-text-subtle)" />
          <span className="min-w-0 flex-1 text-sm font-medium text-(--color-text)">
            {name}
            {part?.isInactive && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-(--color-warning-tint) border border-(--color-warning-line) px-1.5 py-px align-middle text-2xs font-medium text-(--color-warning-ink)" title="Este repuesto fue desactivado del catálogo">
                Inactivo
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onClearProduct}
            className="inline-flex min-h-6 items-center px-1 text-(--color-text-subtle) hover:text-(--color-danger) text-xs transition-colors duration-(--duration-fast)"
          >
            Cambiar
          </button>
        </div>
        {facts.length > 0 && (
          <dl aria-label="Datos del repuesto" className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-[22px] text-xs">
            {facts.map((fact) => (
              <div key={fact.label} className="flex min-w-0 gap-1.5">
                <dt className="shrink-0 text-(--color-text-subtle)">{fact.label}:</dt>
                <dd className="min-w-0 break-words font-mono text-(--color-text)">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    )
  }

  return (
    <Field
      label="Descripción"
      required
      htmlFor={fieldId}
      helper="Elige un repuesto del catálogo o descríbelo con tus palabras. Si no está catalogado, Compras lo cataloga al comprar."
    >
      <ProductPicker
        id={fieldId}
        label="Descripción"
        products={options}
        // El servidor ya filtró por nombre, SKU, N° de parte y marca.
        prefiltered
        busy={search.loading}
        placeholder="Describe el ítem requerido..."
        freeText={{
          value: item.productNameFree,
          onChange: (text) => onUpdate({ productNameFree: text, productId: null }),
        }}
        onSelectProduct={selectFromSearch}
      />
      {search.error && (
        <p role="status" className="mt-1 text-xs text-(--color-text-muted)">
          {search.error} Puedes describirlo con tus palabras.
        </p>
      )}
    </Field>
  )
}
