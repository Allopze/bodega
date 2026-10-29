"use client"

import { Field } from "@/components/ui/field"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import type { ProductOption } from "./request-form.types"
import { formatProductVariant } from "@/lib/products/variant-grouping"
import { getVariantAxes, resolveVariantForChoice, SIZE_AXIS_KEY } from "./variant-selector.helpers"

interface Props {
  variants: ProductOption[]
  selectedVariantId: string
  readOnly: boolean
  onSelect: (variantId: string) => void
  itemKey: string
}

function axisControlId(axisKey: string, itemKey: string) {
  // `size-` es el prefijo que buscan los specs de solicitudes; los demás ejes
  // no lo comparten para que `[id^="size-"]` siga encontrando una talla por ítem.
  return axisKey === SIZE_AXIS_KEY
    ? `size-${itemKey}`
    : `variant-${axisKey.replace(/[^a-z0-9]+/g, "-")}-${itemKey}`
}

export function VariantSelector({ variants, selectedVariantId, readOnly, onSelect, itemKey }: Props) {
  const axes = getVariantAxes(variants, selectedVariantId)

  if (!axes) {
    if (variants.length < 2) return null
    const id = `size-${itemKey}`
    return (
      <div className="max-w-sm">
        <Field label="Variante" required htmlFor={id}>
          <Select value={selectedVariantId} onValueChange={onSelect} disabled={readOnly}>
            <SelectTrigger id={id} className="h-8 text-sm">
              <SelectValue placeholder="Seleccionar variante..." />
            </SelectTrigger>
            <SelectContent>
              {variants.map((variant) => (
                <SelectItem key={variant.id} value={variant.id}>
                  {`${formatProductVariant(variant.attributes, variant.sku)} · ${variant.sku}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    )
  }

  return (
    <div className={axes.length > 1 ? "grid max-w-xl grid-cols-2 gap-3" : "max-w-sm"}>
      {axes.map((axis) => {
        const id = axisControlId(axis.key, itemKey)
        return (
          <Field key={axis.key} label={axis.attributeName} required htmlFor={id}>
            <Select
              value={axis.selected ?? ""}
              onValueChange={(value) => {
                const variantId = resolveVariantForChoice(variants, selectedVariantId, axis.key, value)
                if (variantId) onSelect(variantId)
              }}
              disabled={readOnly}
            >
              <SelectTrigger id={id} className="h-8 text-sm">
                <SelectValue placeholder={`Seleccionar ${axis.attributeName.toLocaleLowerCase("es-CL")}...`} />
              </SelectTrigger>
              <SelectContent>
                {axis.choices.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )
      })}
    </div>
  )
}
