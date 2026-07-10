"use client"

import { CaretUp, CaretDown } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import type { ItemRow } from "./request-form.types"
import { getEditableItemAttributes } from "./item-editor-attributes.helpers"

interface Props {
  item: ItemRow
  readOnly: boolean
  onUpdate: (patch: Partial<ItemRow>) => void
  onUpdateAttr: (i: number, v: string) => void
}

export function ItemEditorAttributes({ item, readOnly, onUpdate, onUpdateAttr }: Props) {
  const editableAttributes = getEditableItemAttributes(item.attributes)
  if (editableAttributes.length === 0) return null

  return (
    <div className="ml-8 space-y-3">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-(--color-text-subtle) hover:text-(--color-text) transition-colors duration-(--duration-fast)"
        onClick={() => onUpdate({ showAttrs: !item.showAttrs })}
      >
        {item.showAttrs ? <CaretUp size={12} /> : <CaretDown size={12} />}
        {item.showAttrs ? "Ocultar" : "Completar"} detalles
        <span className="ml-1 text-(--color-danger)">
          {editableAttributes.some(({ attribute }) => attribute.isRequired) && "(requeridos)"}
        </span>
      </button>

      {item.showAttrs && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {editableAttributes.map(({ attribute: attr, index }) => (
            <Field
              key={attr.attributeId ?? `${attr.attributeName}-${index}`}
              label={attr.attributeName}
              required={attr.isRequired}
              htmlFor={`attr-${item._key}-${index}`}
            >
              {attr.type === "select" && attr.options.length > 0 ? (
                <Select
                  value={attr.value}
                  onValueChange={(v) => onUpdateAttr(index, v)}
                  disabled={readOnly}
                >
                  <SelectTrigger id={`attr-${item._key}-${index}`} className="h-8 text-sm">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {attr.options.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`attr-${item._key}-${index}`}
                  className="h-8 text-sm"
                  placeholder={`${attr.attributeName}...`}
                  value={attr.value}
                  onChange={(e) => onUpdateAttr(index, e.target.value)}
                  disabled={readOnly}
                />
              )}
            </Field>
          ))}
        </div>
      )}
    </div>
  )
}
