"use client"

import * as React from "react"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { toCode } from "@/lib/utils"
import { createWorksite, updateWorksite } from "./actions"

interface WorksiteForEdit {
  id:       string
  name:     string
  code:     string
  address:  string | null
  region:   string | null
  isActive: boolean
}

interface WorksiteFormProps {
  open:          boolean
  onClose:       () => void
  editWorksite?: WorksiteForEdit | null
}

export function WorksiteForm({ open, onClose, editWorksite }: WorksiteFormProps) {
  const isEdit = !!editWorksite
  const [code, changeCode] = React.useReducer((_current: string, next: string) => next, editWorksite?.code ?? "")

  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editWorksite?.id}
      title={isEdit ? "Editar faena" : "Nueva faena"}
      description={isEdit ? `Modificar ${editWorksite.name}` : "Registra una nueva faena"}
      create={createWorksite}
      update={updateWorksite}
      submitLabel={isEdit ? "Guardar cambios" : "Crear faena"}
      successMessage={isEdit ? "Faena actualizada" : "Faena creada"}
    >
      {(state) => (
        <FieldGroup className="gap-4">
          <Field label="Nombre" htmlFor="ws-name" required error={state.fieldErrors?.name?.[0]}>
            <Input
              id="ws-name" name="name"
              defaultValue={editWorksite?.name ?? ""}
              placeholder="Faena Norte"
              error={!!state.fieldErrors?.name}
              onChange={(e) => { if (!isEdit) changeCode(toCode(e.target.value)) }}
            />
          </Field>

          <Field label="Código" htmlFor="ws-code" required helper="Código único. Se auto-genera del nombre." error={state.fieldErrors?.code?.[0]}>
            <Input
              id="ws-code" name="code"
              value={code}
              onChange={(e) => changeCode(e.target.value.toUpperCase())}
              placeholder="FAENA-NORTE"
              error={!!state.fieldErrors?.code}
              className="font-mono"
            />
          </Field>

          <Field label="Región" htmlFor="ws-region" error={state.fieldErrors?.region?.[0]}>
            <Input id="ws-region" name="region" defaultValue={editWorksite?.region ?? ""} placeholder="Antofagasta" />
          </Field>

          <Field label="Dirección" htmlFor="ws-address" error={state.fieldErrors?.address?.[0]}>
            <Input id="ws-address" name="address" defaultValue={editWorksite?.address ?? ""} placeholder="Ruta B-35 km 42..." />
          </Field>

          <Checkbox id="ws-isActive" name="isActive" value="on" defaultChecked={editWorksite?.isActive ?? true} label="Faena activa" />
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
