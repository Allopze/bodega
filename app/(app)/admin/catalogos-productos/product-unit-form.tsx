"use client"

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
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import { saveProductUnitAction } from "./actions"

export interface ProductUnitRow {
  id: string
  code: string
  label: string
  description: string
  sortOrder: number
  isActive: boolean
}

interface ProductUnitFormProps {
  open: boolean
  onClose: () => void
  editUnit?: ProductUnitRow | null
}

export function ProductUnitForm({ open, onClose, editUnit }: ProductUnitFormProps) {
  const isEdit = !!editUnit

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await saveProductUnitAction(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Unidad guardada")
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
          {isEdit && <input type="hidden" name="id" value={editUnit!.id} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar unidad" : "Nueva unidad"}</SheetTitle>
              <SheetDescription>Código único, etiqueta visible y descripción opcional.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Código" htmlFor="unit-code" required error={state.fieldErrors?.code?.[0]}>
                  <Input
                    id="unit-code"
                    name="code"
                    defaultValue={editUnit?.code ?? ""}
                    error={!!state.fieldErrors?.code}
                    placeholder="kg"
                  />
                </Field>
                <Field label="Etiqueta" htmlFor="unit-label" required error={state.fieldErrors?.label?.[0]}>
                  <Input
                    id="unit-label"
                    name="label"
                    defaultValue={editUnit?.label ?? ""}
                    error={!!state.fieldErrors?.label}
                    placeholder="Kilogramo"
                  />
                </Field>
              </div>
              <Field label="Descripción" htmlFor="unit-desc" error={state.fieldErrors?.description?.[0]}>
                <Input
                  id="unit-desc"
                  name="description"
                  defaultValue={editUnit?.description ?? ""}
                  error={!!state.fieldErrors?.description}
                />
              </Field>
              <Field label="Orden" htmlFor="unit-order" error={state.fieldErrors?.sortOrder?.[0]} helper="Entero ascendente.">
                <Input
                  id="unit-order"
                  name="sortOrder"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={String(editUnit?.sortOrder ?? 0)}
                  error={!!state.fieldErrors?.sortOrder}
                  className="w-24"
                />
              </Field>
              <Checkbox
                id="unit-active"
                name="isActive"
                value="on"
                defaultChecked={editUnit?.isActive ?? true}
                label="Unidad activa"
              />
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear unidad"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
