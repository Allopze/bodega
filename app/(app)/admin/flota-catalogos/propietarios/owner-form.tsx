"use client"

import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FLEET_OWNER_KINDS, FLEET_OWNER_KIND_LABELS, FLEET_OWNER_NAME_MAX_LENGTH } from "@/lib/fleet/fleet-owner-kinds"
import type { FleetOwnerCatalogRow } from "@/lib/services/fleet-owners"
import { createFleetOwnerCatalogAction, updateFleetOwnerCatalogAction } from "./actions"

export type OwnerRow = FleetOwnerCatalogRow

interface OwnerFormProps {
  open: boolean
  onClose: () => void
  editRow?: OwnerRow | null
}

export function OwnerForm({ open, onClose, editRow }: OwnerFormProps) {
  const isEdit = !!editRow

  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editRow?.id}
      title={isEdit ? "Editar empresa propietaria" : "Nueva empresa propietaria"}
      description={isEdit
        ? "Corrige el nombre o el tipo. Los equipos de esta empresa la conservan y no cambian de faena."
        : "Agrega una empresa dueña de equipos. El nombre no puede repetirse, aunque cambien mayúsculas o tildes."}
      create={createFleetOwnerCatalogAction}
      update={updateFleetOwnerCatalogAction}
      submitLabel={isEdit ? "Guardar cambios" : "Crear empresa"}
      successMessage={isEdit ? "Empresa actualizada" : "Empresa creada"}
    >
      {(state) => (
        <FieldGroup className="gap-4">
          <Field label="Nombre" htmlFor="fleet-owner-name" required error={state.fieldErrors?.name?.[0]}>
            <Input
              id="fleet-owner-name"
              name="name"
              defaultValue={editRow?.name ?? ""}
              maxLength={FLEET_OWNER_NAME_MAX_LENGTH}
              error={!!state.fieldErrors?.name}
              placeholder="ASIR"
            />
          </Field>
          <Field
            label="Tipo"
            htmlFor="fleet-owner-kind"
            required
            hint="Propia: Chome. Relacionada: ASIR, Servimar. Financiera: banco o leasing. Tercero: cualquier otra."
            error={state.fieldErrors?.kind?.[0]}
          >
            <Select name="kind" defaultValue={editRow?.kind ?? "tercero"}>
              <SelectTrigger id="fleet-owner-kind" className="h-9 w-full">
                <SelectValue placeholder="Selecciona un tipo" />
              </SelectTrigger>
              <SelectContent>
                {FLEET_OWNER_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>{FLEET_OWNER_KIND_LABELS[kind]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
