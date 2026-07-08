"use client"

import * as React from "react"
import { useActionState } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { toast } from "@/lib/toast"
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
  const action = isEdit ? updateCostCenterAction : createCostCenterAction

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? (isEdit ? "Centro actualizado" : "Centro creado"))
        onClose()
      } else if (result.message && !result.fieldErrors) {
        toast.error(result.message)
      }
      return result
    },
    INITIAL_STATE,
  )

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          {isEdit && <input type="hidden" name="id" value={editCostCenter!.id} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar centro de costo" : "Nuevo centro de costo"}</SheetTitle>
              <SheetDescription>
                {isEdit
                  ? "Actualiza el código, nombre o faena asociada."
                  : "Completa los datos del nuevo centro de costo."}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
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
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear centro"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
