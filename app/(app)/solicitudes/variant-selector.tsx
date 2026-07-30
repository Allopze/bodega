"use client"

import { Field } from "@/components/ui/field"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import type { ProductOption } from "./request-form.types"
import { getSizeVariantPicker } from "./variant-selector.helpers"

interface Props {
  variants: ProductOption[]
  selectedVariantId: string
  readOnly: boolean
  onSelect: (variantId: string) => void
  id: string
}

export function VariantSelector({ variants, selectedVariantId, readOnly, onSelect, id }: Props) {
  const picker = getSizeVariantPicker(variants)
  if (!picker) return null

  return (
    <Field label={picker.attributeName} required htmlFor={id}>
      <Select value={selectedVariantId} onValueChange={onSelect} disabled={readOnly}>
        <SelectTrigger id={id} className="h-8 text-sm">
          <SelectValue placeholder={`Seleccionar ${picker.attributeName.toLocaleLowerCase("es-CL")}...`} />
        </SelectTrigger>
        <SelectContent>
          {picker.choices.map((choice) => (
            <SelectItem key={choice.id} value={choice.id}>{choice.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
