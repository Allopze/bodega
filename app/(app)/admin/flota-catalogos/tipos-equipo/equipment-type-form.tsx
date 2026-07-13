"use client"

import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  FUEL_EQUIPMENT_CATEGORIES,
  FUEL_EQUIPMENT_CATEGORY_LABELS,
  FUEL_METER_TYPES,
  FUEL_METER_TYPE_LABELS,
  FUEL_PERFORMANCE_UNITS,
  FUEL_PERFORMANCE_UNIT_LABELS,
} from "@/lib/combustibles/validation"
import { createFuelEquipmentTypeAction, updateFuelEquipmentTypeAction } from "./actions"

export interface EquipmentTypeRow {
  id: string
  slug: string
  name: string
  category: string
  defaultMeterType: string
  defaultPerformanceUnit: string
  description: string | null
  sortOrder: number
  isActive: boolean
  vehicleCount: number
}
export function EquipmentTypeForm({ open, onClose, editRow }: { open: boolean; onClose: () => void; editRow: EquipmentTypeRow | null }) {
  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={Boolean(editRow)}
      entityId={editRow?.id}
      title={editRow ? "Editar tipo de equipo" : "Nuevo tipo de equipo"}
      description="Define cómo se clasifica y mide el rendimiento de esta familia de equipos."
      create={createFuelEquipmentTypeAction}
      update={updateFuelEquipmentTypeAction}
      submitLabel={editRow ? "Guardar cambios" : "Crear tipo"}
      successMessage={editRow ? "Tipo actualizado" : "Tipo creado"}
    >
      {(state) => <FieldGroup className="gap-4">
        <Field label="Nombre" htmlFor="equipment-type-name" required error={state.fieldErrors?.name?.[0]}>
          <Input id="equipment-type-name" name="name" defaultValue={editRow?.name ?? ""} error={!!state.fieldErrors?.name} />
        </Field>
        <Field label="Familia analítica" htmlFor="equipment-type-category" required error={state.fieldErrors?.category?.[0]}>
          <Select name="category" defaultValue={editRow?.category ?? "other"}>
            <SelectTrigger id="equipment-type-category"><SelectValue /></SelectTrigger>
            <SelectContent>{FUEL_EQUIPMENT_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{FUEL_EQUIPMENT_CATEGORY_LABELS[item]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Medidor predeterminado" htmlFor="equipment-type-meter" required error={state.fieldErrors?.defaultMeterType?.[0]}>
            <Select name="defaultMeterType" defaultValue={editRow?.defaultMeterType ?? "none"}>
              <SelectTrigger id="equipment-type-meter"><SelectValue /></SelectTrigger>
              <SelectContent>{FUEL_METER_TYPES.map((item) => <SelectItem key={item} value={item}>{FUEL_METER_TYPE_LABELS[item]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Rendimiento predeterminado" htmlFor="equipment-type-performance" required error={state.fieldErrors?.defaultPerformanceUnit?.[0]}>
            <Select name="defaultPerformanceUnit" defaultValue={editRow?.defaultPerformanceUnit ?? "not_applicable"}>
              <SelectTrigger id="equipment-type-performance"><SelectValue /></SelectTrigger>
              <SelectContent>{FUEL_PERFORMANCE_UNITS.map((item) => <SelectItem key={item} value={item}>{FUEL_PERFORMANCE_UNIT_LABELS[item]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Orden" htmlFor="equipment-type-order">
          <Input id="equipment-type-order" name="sortOrder" type="number" min="0" max="10000" defaultValue={editRow?.sortOrder ?? 0} />
        </Field>
        <Field label="Descripción" htmlFor="equipment-type-description">
          <Textarea id="equipment-type-description" name="description" rows={3} defaultValue={editRow?.description ?? ""} />
        </Field>
      </FieldGroup>}
    </CatalogFormSheet>
  )
}
