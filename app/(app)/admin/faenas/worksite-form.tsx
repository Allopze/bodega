"use client"

import { useActionState, useEffect } from "react"
import { toast } from "@/lib/toast"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { toCode } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { createWorksite, updateWorksite } from "./actions"
import * as React from "react"

interface WorksiteForEdit {
  id:       string
  name:     string
  code:     string
  address:  string | null
  region:   string | null
  isActive: boolean
}

interface WorksiteFormProps {
  open:          boolean
  onClose:       () => void
  editWorksite?: WorksiteForEdit | null
}

export function WorksiteForm({ open, onClose, editWorksite }: WorksiteFormProps) {
  const isEdit = !!editWorksite
  const action = isEdit ? updateWorksite : createWorksite
  const [state, formAction] = useActionState<ActionState, FormData>(action, INITIAL_STATE)
  const [code, changeCode] = React.useReducer((_current: string, next: string) => next, editWorksite?.code ?? "")

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? (isEdit ? "Faena actualizada" : "Faena creada"))
      onClose()
    } else if (state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    changeCode(editWorksite?.code ?? "")
  }, [editWorksite?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          {isEdit && <input type="hidden" name="id" value={editWorksite.id} />}

          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar faena" : "Nueva faena"}</SheetTitle>
              <SheetDescription>
                {isEdit ? `Modificar ${editWorksite.name}` : "Registra una nueva faena"}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <Field label="Nombre" htmlFor="ws-name" required error={state.fieldErrors?.name?.[0]}>
                <Input
                  id="ws-name" name="name"
                  defaultValue={editWorksite?.name ?? ""}
                  placeholder="Faena Norte"
                  error={!!state.fieldErrors?.name}
                  onChange={(e) => { if (!isEdit) changeCode(toCode(e.target.value)) }}
                />
              </Field>

              <Field label="Código" htmlFor="ws-code" required helper="Código único. Se auto-genera del nombre." error={state.fieldErrors?.code?.[0]}>
                <Input
                  id="ws-code" name="code"
                  value={code}
                  onChange={(e) => changeCode(e.target.value.toUpperCase())}
                  placeholder="FAENA-NORTE"
                  error={!!state.fieldErrors?.code}
                  className="font-mono"
                />
              </Field>

              <Field label="Región" htmlFor="ws-region" error={state.fieldErrors?.region?.[0]}>
                <Input id="ws-region" name="region" defaultValue={editWorksite?.region ?? ""} placeholder="Antofagasta" />
              </Field>

              <Field label="Dirección" htmlFor="ws-address" error={state.fieldErrors?.address?.[0]}>
                <Input id="ws-address" name="address" defaultValue={editWorksite?.address ?? ""} placeholder="Ruta B-35 km 42..." />
              </Field>

              <Checkbox id="ws-isActive" name="isActive" value="on" defaultChecked={editWorksite?.isActive ?? true} label="Faena activa" />
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear faena"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
