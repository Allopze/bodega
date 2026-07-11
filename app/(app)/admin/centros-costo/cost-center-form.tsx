"use client"

import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { createCostCenterAction, updateCostCenterAction } from "./actions"

export interface CostCenterRow {
  id: string
  code: string
  name: string
  worksiteId: string
  worksiteName: string
  description: string
  isActive: boolean
  updatedAt: string
}

export interface WorksiteOption {
  id: string
  name: string
  code: string
}

interface CostCenterFormProps {
  open: boolean
  onClose: () => void
  editCostCenter?: CostCenterRow | null
  worksites: WorksiteOption[]
}

export function CostCenterForm({ open, onClose, editCostCenter, worksites }: CostCenterFormProps) {
  const isEdit = !!editCostCenter

  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editCostCenter?.id}
      title={isEdit ? "Editar centro de costo" : "Nuevo centro de costo"}
      description={isEdit ? "Actualiza el código, nombre o faena asociada." : "Completa los datos del nuevo centro de costo."}
      create={createCostCenterAction}
      update={updateCostCenterAction}
      submitLabel={isEdit ? "Guardar cambios" : "Crear centro"}
      successMessage={isEdit ? "Centro actualizado" : "Centro creado"}
    >
      {(state) => (
            <FieldGroup className="gap-4">
              <Field label="Código" htmlFor="cc-code" required error={state.fieldErrors?.code?.[0]}>
                <Input
                  id="cc-code"
                  name="code"
                  defaultValue={editCostCenter?.code ?? ""}
                  error={!!state.fieldErrors?.code}
                  placeholder="CC-OPER-001"
                />
              </Field>
              <Field label="Nombre" htmlFor="cc-name" required error={state.fieldErrors?.name?.[0]}>
                <Input
                  id="cc-name"
                  name="name"
                  defaultValue={editCostCenter?.name ?? ""}
                  error={!!state.fieldErrors?.name}
                />
              </Field>
              <Field label="Faena (opcional)" htmlFor="cc-worksite" error={state.fieldErrors?.worksiteId?.[0]}>
                <select
                  id="cc-worksite"
                  name="worksiteId"
                  defaultValue={editCostCenter?.worksiteId ?? ""}
                  className="h-9 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                >
                  <option value="">Sin faena asociada</option>
                  {worksites.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                  ))}
                </select>
              </Field>
              <Field label="Descripción (opcional)" htmlFor="cc-desc" error={state.fieldErrors?.description?.[0]}>
                <Input
                  id="cc-desc"
                  name="description"
                  defaultValue={editCostCenter?.description ?? ""}
                  error={!!state.fieldErrors?.description}
                />
              </Field>
              <Checkbox
                id="cc-active"
                name="isActive"
                value="on"
                defaultChecked={editCostCenter?.isActive ?? true}
                label="Centro activo"
              />
            </FieldGroup>
      )}
    </CatalogFormSheet>
  )
}
