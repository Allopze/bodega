"use client"

import * as React from "react"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { toCode } from "@/lib/utils"
import { ADMIN_CONTRATO_DEFAULT_LABEL, ADMIN_CONTRATO_LABEL_OPTIONS } from "@/lib/prevention/admin-contrato-label"
import { createWorksite, updateWorksite } from "./actions"

interface WorksiteForEdit {
  id:       string
  name:     string
  code:     string
  address:  string | null
  region:   string | null
  adminContratoLabel: string | null
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

          <Field
            label="Cargo del administrador de contrato"
            htmlFor="ws-admin-contrato-label"
            error={state.fieldErrors?.adminContratoLabel?.[0]}
            helper="Cómo nombra este contrato al cargo. Vacío = «Administrador de contrato»."
          >
            <Input
              id="ws-admin-contrato-label"
              name="adminContratoLabel"
              defaultValue={editWorksite?.adminContratoLabel ?? ""}
              list="ws-admin-contrato-label-options"
              placeholder={ADMIN_CONTRATO_DEFAULT_LABEL}
            />
            {/* ponytail: datalist nativo — sugiere los dos títulos en uso sin
                cerrar la puerta a un contrato que use otro nombre. */}
            <datalist id="ws-admin-contrato-label-options">
              {ADMIN_CONTRATO_LABEL_OPTIONS.map((option) => <option key={option} value={option} />)}
            </datalist>
          </Field>

          {!isEdit ? (
            <Checkbox id="ws-isActive" name="isActive" value="on" defaultChecked label="Faena activa" />
          ) : null}
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
