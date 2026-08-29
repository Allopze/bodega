"use client"

import { useActionState } from "react"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import { updateEppFamilyAction } from "./actions"

export interface EppFamilyEditRow {
  id: string
  canonicalName: string
  brand: string | null
  model: string | null
  certification: string | null
  lifespanMonths: number | null
}

interface Props {
  open: boolean
  onClose: () => void
  family: EppFamilyEditRow | null
}

export function EppFamilyForm({ open, onClose, family }: Props) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await updateEppFamilyAction(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Familia actualizada")
        onClose()
      } else if (result.message && !result.fieldErrors) {
        toast.error(result.message)
      }
      return result
    },
    INITIAL_STATE,
  )

  if (!family) return null

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <input type="hidden" name="id" value={family.id} />
          <SheetHeader>
            <div>
              <SheetTitle>{family.canonicalName}</SheetTitle>
              <SheetDescription>Marca, modelo, certificación y vida útil de la familia.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Marca"
                  htmlFor="fam-brand"
                  error={state.fieldErrors?.brand?.[0]}
                  helper="Junto con el modelo identifica la familia para el importador."
                >
                  <Input
                    id="fam-brand"
                    name="brand"
                    defaultValue={family.brand ?? ""}
                    error={!!state.fieldErrors?.brand}
                    placeholder="3M"
                  />
                </Field>
                <Field label="Modelo" htmlFor="fam-model" error={state.fieldErrors?.model?.[0]}>
                  <Input
                    id="fam-model"
                    name="model"
                    defaultValue={family.model ?? ""}
                    error={!!state.fieldErrors?.model}
                    placeholder="H-700"
                  />
                </Field>
              </div>

              <Field label="Certificación" htmlFor="fam-cert" error={state.fieldErrors?.certification?.[0]}>
                <Input
                  id="fam-cert"
                  name="certification"
                  defaultValue={family.certification ?? ""}
                  error={!!state.fieldErrors?.certification}
                  placeholder="NCh 461"
                />
              </Field>

              <Field
                label="Vida útil (meses)"
                htmlFor="fam-lifespan"
                error={state.fieldErrors?.lifespanMonths?.[0]}
                helper="Vacío = no vence. Con un valor, Prevención marca como vencido el EPP entregado hace más de ese tiempo."
              >
                <Input
                  id="fam-lifespan"
                  name="lifespanMonths"
                  type="number"
                  min={1}
                  max={600}
                  step={1}
                  defaultValue={family.lifespanMonths != null ? String(family.lifespanMonths) : ""}
                  error={!!state.fieldErrors?.lifespanMonths}
                  className="w-28"
                />
              </Field>
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label="Guardar cambios" loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
