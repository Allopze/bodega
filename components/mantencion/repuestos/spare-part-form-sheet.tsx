"use client"

import * as React from "react"
import { createSparePartAction, updateSparePartAction } from "@/app/(app)/mantencion/repuestos/actions"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import type { ActionState } from "@/lib/form-state"

/** Lo que el formulario necesita de un repuesto para editarlo (la ficha y la lista lo arman). */
export interface SparePartFormValues {
  id: string
  sku: string
  name: string
  partNumber: string | null
  partBrand: string | null
  unitOfMeasure: string
  referencePrice: number | null
  notes: string | null
}

export interface SparePartUnitOption {
  code: string
  label: string
}

/** Unidad con la que parte un repuesto nuevo: «unidad» (el default de `products`) si el catálogo la tiene activa; si no, la primera. */
export function defaultUnitCode(units: readonly SparePartUnitOption[]): string {
  return (units.find((unit) => unit.code === "unidad") ?? units[0])?.code ?? ""
}

/**
 * Campos del formulario, controlados a propósito: React 19 vacía los campos no controlados de un
 * `<form action>` al terminar la acción, y con un error de validación la persona perdería lo escrito.
 * Vive en su propio componente para que su estado nazca y muera con el Sheet (se desmonta al cerrar).
 */
function SparePartFields({ state, part, units }: { state: ActionState; part: SparePartFormValues | null; units: readonly SparePartUnitOption[] }) {
  const [name, setName] = React.useState(part?.name ?? "")
  const [partNumber, setPartNumber] = React.useState(part?.partNumber ?? "")
  const [partBrand, setPartBrand] = React.useState(part?.partBrand ?? "")
  const [unit, setUnit] = React.useState(part?.unitOfMeasure ?? defaultUnitCode(units))
  const [price, setPrice] = React.useState(part?.referencePrice == null ? "" : String(part.referencePrice))
  const [notes, setNotes] = React.useState(part?.notes ?? "")
  const error = (field: string) => state.fieldErrors?.[field]?.[0]

  return (
    <FieldGroup className="gap-4">
      <Field label="Nombre del repuesto" htmlFor="rp-name" required error={error("name")}>
        <Input
          id="rp-name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          autoComplete="off"
          placeholder="Ej. Filtro de aceite"
          error={!!error("name")}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="N° de parte"
          htmlFor="rp-part-number"
          error={error("partNumber")}
          helper="El código del fabricante. No se repite en el catálogo."
        >
          <Input
            id="rp-part-number"
            name="partNumber"
            value={partNumber}
            onChange={(event) => setPartNumber(event.target.value)}
            maxLength={100}
            autoComplete="off"
            className="font-mono"
            placeholder="Ej. 1R-0750"
            error={!!error("partNumber")}
          />
        </Field>
        <Field label="Marca del repuesto" htmlFor="rp-part-brand" error={error("partBrand")} helper="Quien fabrica la pieza, no el equipo.">
          <Input
            id="rp-part-brand"
            name="partBrand"
            value={partBrand}
            onChange={(event) => setPartBrand(event.target.value)}
            maxLength={100}
            autoComplete="off"
            placeholder="Ej. Caterpillar"
            error={!!error("partBrand")}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Unidad de medida" htmlFor="rp-unit" required error={error("unitOfMeasure")}>
          <OptionSelect
            id="rp-unit"
            name="unitOfMeasure"
            emptyLabel="Elige una unidad"
            options={units.map((option) => ({ value: option.code, label: option.label, textValue: option.label }))}
            value={unit}
            onValueChange={setUnit}
            error={!!error("unitOfMeasure")}
          />
        </Field>
        <Field
          label="Precio de referencia (CLP)"
          htmlFor="rp-price"
          error={error("referencePrice")}
          helper="Orientativo. El precio real sale de las órdenes de compra."
        >
          <Input
            id="rp-price"
            name="referencePrice"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            className="font-mono"
            error={!!error("referencePrice")}
          />
        </Field>
      </div>

      <Field label="Notas" htmlFor="rp-notes" error={error("notes")} helper="Equivalencias, medidas o lo que ayude a elegir bien. Opcional.">
        <Textarea
          id="rp-notes"
          name="notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={2000}
          rows={3}
          error={!!error("notes")}
        />
      </Field>
    </FieldGroup>
  )
}

interface SparePartFormSheetProps {
  open: boolean
  onClose: () => void
  /** Repuesto a editar; sin él, alta. */
  part?: SparePartFormValues | null
  /** Unidades activas del catálogo de unidades. */
  units: readonly SparePartUnitOption[]
}

/**
 * Alta y edición de un repuesto de catálogo, en el Sheet compartido de los catálogos (`CatalogFormSheet`).
 * Quien lo monta se encarga del `key` por repuesto, para que un Sheet cerrado no herede lo escrito en otro.
 */
export function SparePartFormSheet({ open, onClose, part = null, units }: SparePartFormSheetProps) {
  const isEdit = part !== null
  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={part?.id}
      title={isEdit ? "Editar repuesto" : "Nuevo repuesto"}
      description={isEdit
        ? `${part.sku}. Cambia los datos; el historial de compras y de precios se conserva.`
        : "Se le asigna un código RPT al guardar. También se puede crear al armar una orden de compra."}
      create={createSparePartAction}
      update={updateSparePartAction}
      submitLabel={isEdit ? "Guardar cambios" : "Crear repuesto"}
      submittingLabel={isEdit ? "Guardando…" : "Creando…"}
      successMessage={isEdit ? "Repuesto actualizado" : "Repuesto creado"}
    >
      {(state) => <SparePartFields state={state} part={part} units={units} />}
    </CatalogFormSheet>
  )
}
