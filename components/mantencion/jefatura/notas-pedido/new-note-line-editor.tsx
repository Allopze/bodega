"use client"

import * as React from "react"
import { X } from "@phosphor-icons/react"
import type { SparePartOption } from "@/app/(app)/solicitudes/request-form.types"
import { Button } from "@/components/ui/button"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { PRODUCT_UNITS } from "@/lib/products/units"
import { NEW_NOTE_DESCRIPTION_MAX, type DraftLine } from "./new-note-draft"
import { NewNotePartPicker, partOfOption } from "./new-note-part-picker"

/**
 * Una línea de la nota: qué repuesto, cuántos y en qué unidad, y a qué se le cobra (equipo o centro de costo) y a quién
 * conviene comprárselo, ambos opcionales. Controlada: la pantalla guarda las líneas y el borrador.
 */
export function NewNoteLineEditor({ index, line, chargeOptions, supplierOptions, canRemove, errors, onChange, onRemove }: {
  index: number
  line: DraftLine
  /** Equipos y centros de costo de la faena de la nota (`v:<id>` / `c:<id>`). */
  chargeOptions: ComboboxOption[]
  supplierOptions: ComboboxOption[]
  canRemove: boolean
  /** Error de un campo de esta línea (`description`, `quantity`, `unit`, `charge`, `supplierId`), del cliente o del servidor. */
  errors: (field: string) => string | undefined
  onChange: (patch: Partial<DraftLine>) => void
  onRemove: () => void
}) {
  const base = `np-line-${line.key}`
  const unitOptions = React.useMemo(() => {
    const units = PRODUCT_UNITS.map((unit) => ({ value: unit.code, label: unit.label }))
    // Una unidad que ya no está en la lista (borrador viejo) se sigue mostrando para no cambiarla en silencio.
    return units.some((unit) => unit.value === line.unit) ? units : [{ value: line.unit, label: line.unit }, ...units]
  }, [line.unit])

  function pick(part: SparePartOption) {
    onChange({ part: partOfOption(part), description: part.name, partNumber: part.partNumber ?? "", unit: part.unitOfMeasure })
  }

  return (
    <li className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-(--color-text)">Repuesto {index + 1}</h3>
        {canRemove && (
          <Button type="button" variant="ghost" size="sm" aria-label={`Quitar el repuesto ${index + 1}`} onClick={onRemove}>
            <X size={14} className="mr-1" aria-hidden /> Quitar
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <NewNotePartPicker
          id={`${base}-description`}
          description={line.description}
          part={line.part}
          error={errors("description")}
          onText={(text) => onChange({ description: text.slice(0, NEW_NOTE_DESCRIPTION_MAX), part: null })}
          onPick={pick}
          onClear={() => onChange({ part: null, partNumber: "" })}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Cantidad" required htmlFor={`${base}-quantity`} error={errors("quantity")}>
            <Input id={`${base}-quantity`} inputMode="decimal" autoComplete="off" value={line.quantity} onChange={(event) => onChange({ quantity: event.target.value })} />
          </Field>
          <Field label="Unidad" htmlFor={`${base}-unit`} error={errors("unit")}>
            <OptionSelect id={`${base}-unit`} options={unitOptions} value={line.unit} onValueChange={(unit) => onChange({ unit })} />
          </Field>
          {!line.part && (
            <Field label="N° de parte (opcional)" htmlFor={`${base}-part-number`} className="col-span-2 sm:col-span-1">
              <Input id={`${base}-part-number`} autoComplete="off" maxLength={80} value={line.partNumber} onChange={(event) => onChange({ partNumber: event.target.value })} />
            </Field>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cargo a (opcional)" htmlFor={`${base}-charge`} error={errors("charge")} helper="El equipo o el centro de costo al que se imputa.">
            <Combobox
              id={`${base}-charge`}
              options={chargeOptions}
              value={line.charge}
              onChange={(charge) => onChange({ charge })}
              clearLabel="Sin cargo"
              placeholder="Busca un equipo o centro de costo"
            />
          </Field>
          <Field label="Proveedor sugerido (opcional)" htmlFor={`${base}-supplier`} error={errors("supplierId")}>
            <Combobox
              id={`${base}-supplier`}
              options={supplierOptions}
              value={line.supplierId}
              onChange={(supplierId) => onChange({ supplierId })}
              clearLabel="Sin proveedor"
              placeholder="Busca un proveedor"
            />
          </Field>
        </div>
      </div>
    </li>
  )
}
