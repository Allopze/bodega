"use client"

import * as React from "react"
import { Package } from "@phosphor-icons/react"
import { searchNoteSparePartsAction } from "@/app/(app)/mantencion/notas-pedido/nueva/actions"
import { ProductPicker } from "@/app/(app)/solicitudes/product-picker"
import type { SparePartOption } from "@/app/(app)/solicitudes/request-form.types"
import { sparePartFacts, sparePartMatchesText, sparePartPickerOptions } from "@/app/(app)/solicitudes/spare-part-options"
import { Field } from "@/components/ui/field"
import type { NoteLinePart } from "./new-note-draft"

/** Espera entre teclas antes de preguntarle al servidor. */
const SEARCH_DEBOUNCE_MS = 250
const NO_VEHICLES: readonly never[] = []

interface SearchResult {
  /** El texto que respondió. */
  key: string
  parts: SparePartOption[]
  error: string | null
}

/**
 * El catálogo de repuestos puede tener miles de filas: no viaja entero, se pregunta al servidor mientras se escribe. Sin texto
 * no hay nada que preguntar (la lista de «lo de siempre» de las solicitudes depende de un equipo, que aquí no hay).
 */
function useCatalogSearch(text: string, enabled: boolean) {
  const [debounced, setDebounced] = React.useState(text.trim())
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  const [result, setResult] = React.useState<SearchResult | null>(null)
  const idle = !enabled || debounced === ""
  React.useEffect(() => {
    if (idle) return
    let cancelled = false
    searchNoteSparePartsAction({ query: debounced })
      .then((data) => {
        if (!cancelled) setResult({ key: debounced, parts: data.ok ? data.parts : [], error: data.ok ? null : data.message })
      })
      .catch(() => {
        // Sin señal también se puede pedir: lo escrito sigue valiendo como texto libre.
        if (!cancelled) setResult({ key: debounced, parts: [], error: "No se pudo buscar en el catálogo." })
      })
    return () => { cancelled = true }
  }, [idle, debounced])

  if (idle) return { parts: [] as SparePartOption[], error: null, loading: false }
  const loading = result?.key !== debounced || text.trim() !== debounced
  const parts = result?.parts ?? []
  // Mientras llega la respuesta nueva se ven las anteriores, pero sólo las que calzan con lo escrito ahora: si no, se podría
  // elegir un repuesto de una búsqueda ya abandonada.
  return { parts: loading ? parts.filter((part) => sparePartMatchesText(part, text)) : parts, error: result?.error ?? null, loading }
}

export function partOfOption(part: SparePartOption): NoteLinePart {
  return { id: part.id, sku: part.sku, name: part.name, partNumber: part.partNumber, partBrand: part.partBrand, unitOfMeasure: part.unitOfMeasure }
}

/**
 * «Repuesto» de una línea: un buscador sobre el catálogo que a la vez es el campo de texto libre. Quien pide algo que aún no
 * está catalogado lo escribe y Compras lo cataloga al comprar; si está, lo elige y la línea queda atada al repuesto.
 */
export function NewNotePartPicker({ id, description, part, error, onText, onPick, onClear }: {
  id: string
  description: string
  part: NoteLinePart | null
  error?: string
  onText: (text: string) => void
  onPick: (part: SparePartOption) => void
  onClear: () => void
}) {
  const search = useCatalogSearch(description, !part)
  const options = React.useMemo(() => sparePartPickerOptions(search.parts, "", NO_VEHICLES), [search.parts])

  // Elegir un repuesto desmonta el buscador y «Cambiar» lo vuelve a montar: sin mover el foco, quien navega con teclado
  // quedaría en el cuerpo de la página. Sólo en el cambio, no al restaurar un borrador que ya trae su repuesto.
  const cardRef = React.useRef<HTMLDivElement>(null)
  const previousPartId = React.useRef(part?.id)
  React.useEffect(() => {
    const before = previousPartId.current
    previousPartId.current = part?.id
    if (!before && part) cardRef.current?.focus()
    else if (before && !part) document.getElementById(id)?.focus()
  }, [part, id])

  if (part) {
    const facts = sparePartFacts(part)
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
          <span className="min-w-0 flex-1 break-words text-sm font-medium text-(--color-text)">{part.name}</span>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex min-h-6 items-center px-1 text-xs text-(--color-text-subtle) transition-colors duration-(--duration-fast) hover:text-(--color-danger)"
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
      label="Repuesto"
      required
      htmlFor={id}
      error={error}
      helper="Búscalo en el catálogo o escríbelo con tus palabras. Si no está catalogado, Compras lo resuelve."
    >
      <ProductPicker
        id={id}
        label="Repuesto"
        products={options}
        // El servidor ya filtró por nombre, SKU, N° de parte y marca.
        prefiltered
        busy={search.loading}
        placeholder="Describe el repuesto..."
        freeText={{ value: description, onChange: onText }}
        onSelectProduct={(productId) => {
          const chosen = search.parts.find((candidate) => candidate.id === productId)
          if (chosen) onPick(chosen)
        }}
      />
      {search.error && (
        <p role="status" className="mt-1 text-xs text-(--color-text-muted)">
          {search.error} Puedes describirlo con tus palabras.
        </p>
      )}
    </Field>
  )
}
