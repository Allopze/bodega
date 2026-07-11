"use client"

import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toTitleCase } from "@/lib/utils"
import { createSupplier, updateSupplier } from "./actions"

interface SupplierForEdit {
  id:           string
  name:         string
  rut:          string | null
  businessActivity: string | null
  contactName:  string | null
  email:        string | null
  phone:        string | null
  address:      string | null
  commune:      string | null
  city:         string | null
  paymentTerms: string | null
  notes:        string | null
  isActive:     boolean
}

interface SupplierFormProps {
  open:          boolean
  onClose:       () => void
  editSupplier?: SupplierForEdit | null
}

export function SupplierForm({ open, onClose, editSupplier }: SupplierFormProps) {
  const isEdit = !!editSupplier

  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editSupplier?.id}
      title={isEdit ? "Editar proveedor" : "Nuevo proveedor"}
      description={isEdit ? `Modificar ${toTitleCase(editSupplier.name)}` : "Registra un nuevo proveedor"}
      create={createSupplier}
      update={updateSupplier}
      submitLabel={isEdit ? "Guardar cambios" : "Crear proveedor"}
      successMessage={isEdit ? "Proveedor actualizado" : "Proveedor creado"}
    >
      {(state) => (
        <FieldGroup className="gap-4">
              <Field label="Razón social" htmlFor="sup-name" required error={state.fieldErrors?.name?.[0]}>
                <Input id="sup-name" name="name" autoComplete="off" defaultValue={editSupplier?.name ?? ""} placeholder="Ferretería Industrial Cáceres Ltda." error={!!state.fieldErrors?.name} />
              </Field>

              <Field label="RUT" htmlFor="sup-rut" helper="Formato: 12345678-9" error={state.fieldErrors?.rut?.[0]}>
                <Input id="sup-rut" name="rut" autoComplete="off" defaultValue={editSupplier?.rut ?? ""} placeholder="12345678-9" error={!!state.fieldErrors?.rut} className="font-mono" />
              </Field>

              <Field label="Giro" htmlFor="sup-business-activity" error={state.fieldErrors?.businessActivity?.[0]}>
                <Input id="sup-business-activity" name="businessActivity" defaultValue={editSupplier?.businessActivity ?? ""} placeholder="Venta de equipos de protección personal" error={!!state.fieldErrors?.businessActivity} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Contacto" htmlFor="sup-contact">
                  <Input id="sup-contact" name="contactName" defaultValue={editSupplier?.contactName ?? ""} placeholder="Nombre contacto" />
                </Field>
                <Field label="Teléfono" htmlFor="sup-phone">
                  <Input id="sup-phone" name="phone" autoComplete="off" defaultValue={editSupplier?.phone ?? ""} placeholder="+56 9 1234 5678" />
                </Field>
              </div>

              <Field label="Correo" htmlFor="sup-email" error={state.fieldErrors?.email?.[0]}>
                <Input id="sup-email" name="email" type="email" autoComplete="off" defaultValue={editSupplier?.email ?? ""} placeholder="contacto@proveedor.cl" error={!!state.fieldErrors?.email} />
              </Field>

              <Field label="Dirección" htmlFor="sup-address">
                <Input id="sup-address" name="address" autoComplete="off" defaultValue={editSupplier?.address ?? ""} placeholder="Av. Industrial 1234, Santiago" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Comuna" htmlFor="sup-commune" error={state.fieldErrors?.commune?.[0]}>
                  <Input id="sup-commune" name="commune" autoComplete="off" defaultValue={editSupplier?.commune ?? ""} placeholder="San Joaquín" error={!!state.fieldErrors?.commune} />
                </Field>
                <Field label="Ciudad" htmlFor="sup-city" error={state.fieldErrors?.city?.[0]}>
                  <Input id="sup-city" name="city" autoComplete="off" defaultValue={editSupplier?.city ?? ""} placeholder="Santiago" error={!!state.fieldErrors?.city} />
                </Field>
              </div>

              <Field label="Condiciones de pago" htmlFor="sup-payment" helper='Ej: "30 días", "contado", "60 días factura"'>
                <Input id="sup-payment" name="paymentTerms" defaultValue={editSupplier?.paymentTerms ?? ""} placeholder="30 días" />
              </Field>

              <Field label="Notas" htmlFor="sup-notes">
                <Textarea id="sup-notes" name="notes" defaultValue={editSupplier?.notes ?? ""} placeholder="Observaciones adicionales..." rows={3} />
              </Field>

              <Checkbox id="sup-isActive" name="isActive" value="on" defaultChecked={editSupplier?.isActive ?? true} label="Proveedor activo" />
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
