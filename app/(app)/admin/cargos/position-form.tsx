"use client"

import * as React from "react"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Checkbox } from "@/components/ui/checkbox"
import { ChoiceChips, type ChoiceChipOption } from "@/components/ui/choice-chips"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  DRIVER_LICENSE_CLASSES,
  DRIVER_LICENSE_CLASS_GROUPS,
  DRIVER_LICENSE_CLASS_INFO,
} from "@/lib/validation/driver-licenses"
import { createWorkerPositionAction, updateWorkerPositionAction } from "./actions"
import type { WorkerCapabilityCatalogRow, WorkerPositionCatalogRow } from "./types"

const LICENSE_CLASS_OPTIONS: ChoiceChipOption[] = DRIVER_LICENSE_CLASSES.map((code) => {
  const info = DRIVER_LICENSE_CLASS_INFO[code]
  return { value: code, label: info.short, description: info.name, group: info.group }
})

/**
 * Selector de las clases de licencia que exige el cargo.
 *
 * Es un componente aparte —y no un `useState` de `PositionForm`— porque la hoja
 * de Radix desmonta su contenido al cerrarse: el estado vive tanto como el
 * formulario abierto y «Nuevo cargo» no hereda la selección del anterior.
 *
 * Recibe `aria-*` porque `Field` los inyecta en su único hijo para enlazar el
 * rótulo y la ayuda con el grupo.
 */
function RequiredLicenseClassesField({
  initial,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: {
  initial: readonly string[]
  "aria-labelledby"?: string
  "aria-describedby"?: string
}) {
  const [value, setValue] = React.useState<string[]>(() => [...initial])
  return (
    <>
      {/* Marca de que este formulario administra el campo: sin ella, no marcar
          ninguna clase no llegaría al servidor y no habría cómo vaciarlas. */}
      <input type="hidden" name="requiredLicenseClasses" value="" />
      <ChoiceChips
        name="requiredLicenseClasses"
        options={LICENSE_CLASS_OPTIONS}
        groups={DRIVER_LICENSE_CLASS_GROUPS}
        value={value}
        onChange={setValue}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      />
    </>
  )
}

export function PositionForm({
  open,
  onClose,
  editPosition,
  capabilities,
}: {
  open: boolean
  onClose: () => void
  editPosition?: WorkerPositionCatalogRow | null
  capabilities: WorkerCapabilityCatalogRow[]
}) {
  const isEdit = Boolean(editPosition)
  const selectedCapabilityIds = new Set(editPosition?.capabilities.map((capability) => capability.id) ?? [])
  const title = editPosition?.needsReview
    ? "Revisar cargo"
    : isEdit ? "Editar cargo" : "Nuevo cargo"

  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editPosition?.id}
      title={title}
      description={isEdit
        ? `${editPosition!.workerCount} trabajador(es) usan actualmente este cargo.`
        : "Define una identidad única y las capacidades heredadas por sus trabajadores."}
      create={createWorkerPositionAction}
      update={updateWorkerPositionAction}
      submitLabel={editPosition?.needsReview ? "Guardar revisión" : isEdit ? "Guardar cambios" : "Crear cargo"}
      successMessage={isEdit ? "Cargo actualizado" : "Cargo creado"}
    >
      {(state) => (
        <FieldGroup>
          <Field label="Código" htmlFor="position-code" required error={state.fieldErrors?.code?.[0]} helper="Identificador estable, por ejemplo CONDUCTOR.">
            <Input
              id="position-code"
              name="code"
              defaultValue={editPosition?.code ?? ""}
              placeholder="CONDUCTOR"
              autoComplete="off"
              error={Boolean(state.fieldErrors?.code)}
              disabled={editPosition?.isSystem}
              // eslint-disable-next-line local/ui-type-scale -- normaliza el dato (código tipeado), no es un rótulo
              className="font-mono uppercase"
            />
          </Field>

          <Field label="Nombre del cargo" htmlFor="position-name" required error={state.fieldErrors?.name?.[0]}>
            <Input
              id="position-name"
              name="name"
              defaultValue={editPosition?.name ?? ""}
              placeholder="Conductor"
              autoComplete="off"
              error={Boolean(state.fieldErrors?.name)}
              disabled={editPosition?.isSystem}
            />
          </Field>

          <fieldset className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
            <legend className="px-1 text-sm font-medium text-[var(--color-text)]">Capacidades heredadas</legend>
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">
              Se aplican a todos los trabajadores del cargo, salvo una excepción individual auditada.
            </p>
            <div className="space-y-2">
              {capabilities.filter((capability) => capability.isActive || selectedCapabilityIds.has(capability.id)).map((capability) => (
                <Checkbox
                  key={capability.id}
                  id={`position-capability-${capability.id}`}
                  name="capabilityIds"
                  value={capability.id}
                  defaultChecked={selectedCapabilityIds.has(capability.id)}
                  label={(
                    <span>
                      <span className="font-medium">{capability.name}</span>
                      <span className="ml-1 font-mono text-xs text-[var(--color-text-subtle)]">{capability.code}</span>
                      {capability.description && <span className="block text-xs text-[var(--color-text-muted)]">{capability.description}</span>}
                    </span>
                  )}
                />
              ))}
              {capabilities.length === 0 && (
                <p className="text-sm text-[var(--color-text-muted)]">No hay capacidades disponibles.</p>
              )}
            </div>
          </fieldset>

          <Field
            label="Licencia de conducir"
            helper="Basta con que tenga una de las marcadas. Déjalo vacío si el cargo no exige una clase en particular."
          >
            <RequiredLicenseClassesField initial={editPosition?.requiredLicenseClasses ?? []} />
          </Field>

          <Checkbox
            id="position-needs-review"
            name="needsReview"
            value="on"
            defaultChecked={editPosition?.needsReview ?? false}
            label="Cargo pendiente de revisión"
          />
          <Checkbox
            id="position-active"
            name="isActive"
            value="on"
            defaultChecked={editPosition?.isActive ?? true}
            label="Cargo activo"
            disabled={editPosition?.isSystem}
          />
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
