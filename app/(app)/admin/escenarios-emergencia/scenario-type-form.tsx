"use client"

import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { createEmergencyScenarioTypeAction, updateEmergencyScenarioTypeAction } from "./actions"

export interface EmergencyScenarioTypeRow {
  code: string
  label: string
  obligation: string
  isSystem: boolean
  isActive: boolean
  sortOrder: number
  scenarioCount: number
  drillCount: number
}

export function EmergencyScenarioTypeForm({
  open,
  onClose,
  editRow,
}: {
  open: boolean
  onClose: () => void
  editRow: EmergencyScenarioTypeRow | null
}) {
  const isEdit = Boolean(editRow)
  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editRow?.code}
      title={isEdit ? "Editar tipo de escenario" : "Nuevo tipo de escenario"}
      description="El tipo quedará disponible para declarar escenarios en los planes de emergencia."
      create={createEmergencyScenarioTypeAction}
      update={updateEmergencyScenarioTypeAction}
      submitLabel={isEdit ? "Guardar cambios" : "Crear tipo"}
      successMessage={isEdit ? "Tipo actualizado" : "Tipo creado"}
    >
      {(state) => (
        <FieldGroup className="gap-4">
          <Field label="Nombre" htmlFor="emergency-scenario-type-label" required error={state.fieldErrors?.label?.[0]}>
            <Input
              id="emergency-scenario-type-label"
              name="label"
              defaultValue={editRow?.label ?? ""}
              placeholder="Ej.: Corte de camino"
              maxLength={120}
              error={Boolean(state.fieldErrors?.label)}
            />
          </Field>
          <Field label="Orden" htmlFor="emergency-scenario-type-order" error={state.fieldErrors?.sortOrder?.[0]}>
            <Input
              id="emergency-scenario-type-order"
              name="sortOrder"
              type="number"
              min="0"
              max="10000"
              defaultValue={editRow?.sortOrder ?? 1000}
              className="w-32"
              error={Boolean(state.fieldErrors?.sortOrder)}
            />
          </Field>
          <p className="text-xs text-[var(--color-text-muted)]">
            Los tipos base y su clasificación preventiva están protegidos. Los tipos propios se pueden desactivar, pero no borrar.
          </p>
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
