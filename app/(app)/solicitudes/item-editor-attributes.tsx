"use client"

import * as React from "react"
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

function AttrInput({
  attr,
  index,
  htmlFor,
  onUpdateAttr,
  readOnly,
}: {
  attr: { attribute: { attributeName: string; type: string; value: string; options: string[] }; isRequired: boolean }
  index: number
  htmlFor: string
  onUpdateAttr: (i: number, v: string) => void
  readOnly: boolean
}) {
  return attr.attribute.type === "select" && attr.attribute.options.length > 0 ? (
    <Select
      value={attr.attribute.value}
      onValueChange={(v) => onUpdateAttr(index, v)}
      disabled={readOnly}
    >
      <SelectTrigger id={htmlFor} className="h-8 text-sm">
        <SelectValue placeholder="Seleccionar..." />
      </SelectTrigger>
      <SelectContent>
        {attr.attribute.options.map((opt) => (
          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : (
    <Input
      id={htmlFor}
      className="h-8 text-sm"
      placeholder={`${attr.attribute.attributeName}...`}
      value={attr.attribute.value}
      onChange={(e) => onUpdateAttr(index, e.target.value)}
      disabled={readOnly}
    />
  )
}

export function ItemEditorAttributes({ item, readOnly, onUpdate, onUpdateAttr }: Props) {
  const editableAttributes = getEditableItemAttributes(item.attributes)
  if (editableAttributes.length === 0) return null

  const requiredAttrs = editableAttributes.filter(
    ({ attribute }) => attribute.isRequired,
  )
  const optionalAttrs = editableAttributes.filter(
    ({ attribute }) => !attribute.isRequired,
  )
  const showToggle = optionalAttrs.length > 0

  return (
    <div className="ml-8 space-y-3">
      {requiredAttrs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {requiredAttrs.map(({ attribute: attr, index }) => (
            <Field
              key={attr.attributeId ?? `${attr.attributeName}-${index}`}
              label={attr.attributeName}
              required
              htmlFor={`attr-req-${item._key}-${index}`}
            >
              <AttrInput
                attr={{ attribute: attr, isRequired: true }}
                index={index}
                htmlFor={`attr-req-${item._key}-${index}`}
                onUpdateAttr={onUpdateAttr}
                readOnly={readOnly}
              />
            </Field>
          ))}
        </div>
      )}

      {showToggle && (
        <>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-(--color-text-subtle) hover:text-(--color-text) transition-colors duration-(--duration-fast)"
            onClick={() => onUpdate({ showAttrs: !item.showAttrs })}
          >
            {item.showAttrs ? <CaretUp size={12} /> : <CaretDown size={12} />}
            {item.showAttrs ? "Ocultar" : "Completar"} detalles adicionales
          </button>

          {item.showAttrs && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {optionalAttrs.map(({ attribute: attr, index }) => (
                <Field
                  key={attr.attributeId ?? `${attr.attributeName}-${index}`}
                  label={attr.attributeName}
                  required={attr.isRequired}
                  htmlFor={`attr-opt-${item._key}-${index}`}
                >
                  <AttrInput
                    attr={{ attribute: attr, isRequired: attr.isRequired }}
                    index={index}
                    htmlFor={`attr-opt-${item._key}-${index}`}
                    onUpdateAttr={onUpdateAttr}
                    readOnly={readOnly}
                  />
                </Field>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
