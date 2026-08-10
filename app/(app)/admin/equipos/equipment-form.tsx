"use client"

import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { OptionSelect } from "@/components/ui/option-select"
import { createServiceEquipment, updateServiceEquipment } from "./actions"
import { KNOWN_EQUIPMENT_KINDS } from "./catalog-contract"

// `type` y no `interface` a propósito: `DataTable` es genérico sobre
// `Record<string, unknown>` y TypeScript no acepta una `interface` contra esa
// restricción (no tiene índice implícito). Ya nos costó una vez.
export type EquipmentForEdit = {
  id:           string
  code:         string
  name:         string
  kind:         string
  brand:        string | null
  model:        string | null
  serialNumber: string | null
  worksiteId:   string
  notes:        string | null
  isActive:     boolean
}

export function EquipmentForm({
  open, onClose, editEquipment, worksites,
}: {
  open:           boolean
  onClose:        () => void
  editEquipment?: EquipmentForEdit | null
  worksites:      { id: string; name: string }[]
}) {
  const isEdit = !!editEquipment

  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editEquipment?.id}
      title={isEdit ? "Editar equipo" : "Nuevo equipo"}
      description={isEdit ? `Modificar ${editEquipment.code}` : "Registra un instrumento (monogás, alcotest, …)"}
      create={createServiceEquipment}
      update={updateServiceEquipment}
      submitLabel={isEdit ? "Guardar cambios" : "Crear equipo"}
      successMessage={isEdit ? "Equipo actualizado" : "Equipo creado"}
    >
      {(state) => (
        <FieldGroup className="gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Código interno" htmlFor="eq-code" required error={state.fieldErrors?.code?.[0]}>
              <Input id="eq-code" name="code" autoComplete="off" className="font-mono"
                defaultValue={editEquipment?.code ?? ""} placeholder="MG-014"
                error={!!state.fieldErrors?.code} />
            </Field>
            {/* Texto libre con sugerencias y no un select cerrado: sumar una
                familia de equipos es un dato nuevo, no una migración. */}
            <Field label="Tipo" htmlFor="eq-kind" required
              helper="Sin espacios ni tildes (monogas, alcotest)."
              error={state.fieldErrors?.kind?.[0]}>
              <Input id="eq-kind" name="kind" autoComplete="off" list="equipment-kind-options"
                defaultValue={editEquipment?.kind ?? ""} placeholder="monogas"
                error={!!state.fieldErrors?.kind} />
              <datalist id="equipment-kind-options">
                {KNOWN_EQUIPMENT_KINDS.map((kind) => <option key={kind} value={kind} />)}
              </datalist>
            </Field>
          </div>

          <Field label="Nombre" htmlFor="eq-name" required error={state.fieldErrors?.name?.[0]}>
            <Input id="eq-name" name="name" autoComplete="off"
              defaultValue={editEquipment?.name ?? ""} placeholder="Detector monogás H2S"
              error={!!state.fieldErrors?.name} />
          </Field>

          <Field label="Faena" htmlFor="eq-worksite" required error={state.fieldErrors?.worksiteId?.[0]}>
            <OptionSelect
              id="eq-worksite"
              name="worksiteId"
              defaultValue={editEquipment?.worksiteId ?? ""}
              placeholder="Selecciona una faena"
              options={worksites.map((w) => ({ value: w.id, label: w.name }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Marca" htmlFor="eq-brand">
              <Input id="eq-brand" name="brand" defaultValue={editEquipment?.brand ?? ""} placeholder="Dräger" />
            </Field>
            <Field label="Modelo" htmlFor="eq-model">
              <Input id="eq-model" name="model" defaultValue={editEquipment?.model ?? ""} placeholder="Pac 6500" />
            </Field>
          </div>

          <Field label="N° de serie" htmlFor="eq-serial">
            <Input id="eq-serial" name="serialNumber" className="font-mono"
              defaultValue={editEquipment?.serialNumber ?? ""} placeholder="ARJN-0192" />
          </Field>

          <Field label="Notas" htmlFor="eq-notes">
            <Textarea id="eq-notes" name="notes" rows={3}
              defaultValue={editEquipment?.notes ?? ""} placeholder="Observaciones adicionales..." />
          </Field>

          <Checkbox id="eq-isActive" name="isActive" value="on"
            defaultChecked={editEquipment?.isActive ?? true} label="Equipo activo" />
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
