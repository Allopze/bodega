"use client"

import * as React from "react"
import { Package } from "@phosphor-icons/react"
import { Field } from "@/components/ui/field"
import { ProductPicker } from "./product-picker"
import { sparePartFacts, sparePartPickerOptions } from "./spare-part-options"
import type { ItemRow, SparePartOption, VehicleOption } from "./request-form.types"

interface Props {
  item: ItemRow
  /** Catálogo de repuestos; vacío si la persona no puede pedirlos o aún no hay ninguno. */
  spareParts: SparePartOption[]
  /** Equipos de flota: con el del ítem elegido, los repuestos que ya se compraron para él suben primero. */
  vehicles: VehicleOption[]
  onUpdate: (patch: Partial<ItemRow>) => void
  onSelectProduct: (productId: string) => void
  onClearProduct: () => void
}

/**
 * Descripción de un ítem de repuestos: un buscador sobre el catálogo que a la
 * vez es el campo de texto libre. Quien pide algo que aún no está catalogado
 * simplemente lo escribe —Compras lo cataloga al armar la OC—; si está, lo elige
 * y el ítem queda atado al repuesto (nombre, SKU, N° de parte y marca de
 * lectura, y el último precio como estimado).
 */
export function ItemEditorSparePart({ item, spareParts, vehicles, onUpdate, onSelectProduct, onClearProduct }: Props) {
  const part = item.productId ? spareParts.find((candidate) => candidate.id === item.productId) : undefined
  const options = React.useMemo(
    () => sparePartPickerOptions(spareParts, item.vehicleId, vehicles),
    [spareParts, item.vehicleId, vehicles],
  )
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
        placeholder="Describe el ítem requerido..."
        freeText={{
          value: item.productNameFree,
          onChange: (text) => onUpdate({ productNameFree: text, productId: null }),
        }}
        onSelectProduct={onSelectProduct}
      />
    </Field>
  )
}
