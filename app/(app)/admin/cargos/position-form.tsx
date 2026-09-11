"use client"

import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { createWorkerPositionAction, updateWorkerPositionAction } from "./actions"
import type { WorkerCapabilityCatalogRow, WorkerPositionCatalogRow } from "./types"

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
