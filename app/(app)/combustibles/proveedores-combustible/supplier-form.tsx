"use client"

import { useState } from "react"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createFuelSupplierAction, updateFuelSupplierAction } from "../actions"

export type FuelSupplierRow = {
  id: string
  supplierId: string | null
  name: string
  rut: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  notes: string | null
  isActive: boolean
}

export interface GeneralSupplierOption {
  id: string
  name: string
  rut: string | null
  isActive: boolean
}

export function FuelSupplierForm({
  open,
  onClose,
  editSupplier,
  generalSuppliers,
}: {
  open: boolean
  onClose: () => void
  editSupplier?: FuelSupplierRow | null
  generalSuppliers: GeneralSupplierOption[]
}) {
  const isEdit = !!editSupplier
  const [selectedSupplierId, setSelectedSupplierId] = useState(editSupplier?.supplierId ?? "")

  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editSupplier?.id}
      title={isEdit ? "Editar proveedor de combustible" : "Nuevo proveedor de combustible"}
      description="La identidad comercial se comparte con el maestro general de proveedores."
      create={createFuelSupplierAction}
      update={updateFuelSupplierAction}
      submitLabel={isEdit ? "Guardar cambios" : "Crear proveedor"}
      successMessage={isEdit ? "Proveedor actualizado" : "Proveedor creado"}
      hiddenFields={<input type="hidden" name="supplierId" value={selectedSupplierId} />}
    >
      {(state) => (
        <FieldGroup className="gap-4">
          <Field label="Proveedor general" htmlFor="fuel-supplier-general" helper="Selecciona una identidad existente o deja vacío para crearla." error={state.fieldErrors?.supplierId?.[0]}>
            <Select value={selectedSupplierId || "__new__"} onValueChange={(value) => setSelectedSupplierId(value === "__new__" ? "" : value)}>
              <SelectTrigger id="fuel-supplier-general"><SelectValue placeholder="Crear o resolver por RUT" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">Crear o resolver por RUT</SelectItem>
                {generalSuppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name}{supplier.rut ? ` · ${supplier.rut}` : ""}{!supplier.isActive ? " · Inactivo" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Razón social" htmlFor="fuel-supplier-name" required error={state.fieldErrors?.name?.[0]}>
            <Input id="fuel-supplier-name" name="name" defaultValue={editSupplier?.name ?? ""} placeholder="COPEC, ARAMCO..." error={!!state.fieldErrors?.name} />
          </Field>
          <Field label="RUT" htmlFor="fuel-supplier-rut" helper="Se usa para resolver identidades duplicadas." error={state.fieldErrors?.rut?.[0]}>
            <Input id="fuel-supplier-rut" name="rut" defaultValue={editSupplier?.rut ?? ""} placeholder="12.345.678-9" error={!!state.fieldErrors?.rut} />
          </Field>
          <Field label="Contacto" htmlFor="fuel-supplier-contact">
            <Input id="fuel-supplier-contact" name="contactName" defaultValue={editSupplier?.contactName ?? ""} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Teléfono" htmlFor="fuel-supplier-phone">
              <Input id="fuel-supplier-phone" name="contactPhone" defaultValue={editSupplier?.contactPhone ?? ""} />
            </Field>
            <Field label="Email" htmlFor="fuel-supplier-email" error={state.fieldErrors?.contactEmail?.[0]}>
              <Input id="fuel-supplier-email" name="contactEmail" type="email" defaultValue={editSupplier?.contactEmail ?? ""} error={!!state.fieldErrors?.contactEmail} />
            </Field>
          </div>
          <Field label="Notas" htmlFor="fuel-supplier-notes">
            <Textarea id="fuel-supplier-notes" name="notes" defaultValue={editSupplier?.notes ?? ""} rows={3} />
          </Field>
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
