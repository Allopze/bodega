"use client"

import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import type { ItemRow, SupplierOption } from "./request-form.types"

interface Props {
  item: ItemRow
  suppliers: SupplierOption[]
  readOnly: boolean
  onUpdate: (patch: Partial<ItemRow>) => void
}

export function ItemEditorSupplier({ item, suppliers, readOnly, onUpdate }: Props) {
  const hasSuppliers = suppliers.length > 0
  const showSupplierSelect = !item.supplierHint || !!item.suggestedSupplierId

  return (
    <div className="ml-8 grid grid-cols-1 gap-3">
      <Field label="Proveedor sugerido" htmlFor={`sup-${item._key}`}>
        {readOnly ? (
          <p className="text-sm text-(--color-text)">
            {item.suggestedSupplierId
              ? (suppliers.find((s) => s.id === item.suggestedSupplierId)?.name ?? "—")
              : (item.supplierHint || "—")}
          </p>
        ) : hasSuppliers && showSupplierSelect ? (
          <Select
            value={item.suggestedSupplierId || "__free__"}
            onValueChange={(v) => {
              if (v === "__free__") {
                onUpdate({ suggestedSupplierId: "", supplierHint: "" })
              } else {
                onUpdate({ suggestedSupplierId: v, supplierHint: "" })
              }
            }}
          >
            <SelectTrigger id={`sup-${item._key}`} className="h-8 text-sm">
              <SelectValue placeholder="Seleccionar proveedor..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__free__">Escribir nombre...</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={`sup-${item._key}`}
            className="h-8 text-sm"
            placeholder="ej: treck, apro..."
            value={item.supplierHint}
            onChange={(e) => onUpdate({ supplierHint: e.target.value, suggestedSupplierId: "" })}
            disabled={readOnly}
          />
        )}
      </Field>
    </div>
  )
}
