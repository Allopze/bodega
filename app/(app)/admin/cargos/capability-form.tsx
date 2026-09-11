"use client"

import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createWorkerCapabilityAction, updateWorkerCapabilityAction } from "./actions"
import type { WorkerCapabilityCatalogRow } from "./types"

export function CapabilityForm({
  open,
  onClose,
  editCapability,
}: {
  open: boolean
  onClose: () => void
  editCapability?: WorkerCapabilityCatalogRow | null
}) {
  const isEdit = Boolean(editCapability)
  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editCapability?.id}
      title={isEdit ? "Editar capacidad" : "Nueva capacidad"}
      description={isEdit
        ? `${editCapability!.positionCount} cargo(s) y ${editCapability!.overrideCount} excepción(es) usan esta capacidad.`
        : "Define una capacidad operativa reutilizable por cargos y prevención."}
      create={createWorkerCapabilityAction}
      update={updateWorkerCapabilityAction}
      submitLabel={isEdit ? "Guardar cambios" : "Crear capacidad"}
      successMessage={isEdit ? "Capacidad actualizada" : "Capacidad creada"}
    >
      {(state) => (
        <FieldGroup>
          <Field label="Código" htmlFor="capability-code" required error={state.fieldErrors?.code?.[0]} helper="Minúsculas y guion bajo, por ejemplo drives_vehicle.">
            <Input id="capability-code" name="code" defaultValue={editCapability?.code ?? ""} placeholder="drives_vehicle" autoComplete="off" error={Boolean(state.fieldErrors?.code)} className="font-mono" />
          </Field>
          <Field label="Nombre" htmlFor="capability-name" required error={state.fieldErrors?.name?.[0]}>
            <Input id="capability-name" name="name" defaultValue={editCapability?.name ?? ""} placeholder="Conduce vehículos" autoComplete="off" error={Boolean(state.fieldErrors?.name)} />
          </Field>
          <Field label="Descripción" htmlFor="capability-description">
            <Textarea id="capability-description" name="description" defaultValue={editCapability?.description ?? ""} rows={3} placeholder="Cuándo corresponde asignar esta capacidad." />
          </Field>
          <Checkbox id="capability-active" name="isActive" value="on" defaultChecked={editCapability?.isActive ?? true} label="Capacidad activa" />
        </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
